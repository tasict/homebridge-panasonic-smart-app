import PanasonicPlatformLogger from './logger';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  LOGIN_TOKEN_REFRESH_INTERVAL,
  STORED_TOKEN_MAX_REUSE_AGE,
} from './settings';
import {
  SmartAppDevice,
  SmartAppDeviceInfo,
  PanasonicPlatformConfig,
  SmartAppCommandList,
  LocalDeviceOverride,
  LocalDeviceMetadata,
} from './types';

import {
  USER_AGENT,
  BASE_URL,
  APP_TOKEN,
  REQUEST_TIMEOUT,
  SECONDS_BETWEEN_REQUEST,
  MAX_PENDING_POLL_REQUESTS,
  RATE_LIMIT_PAUSE_SECONDS,
  EXCEPTION_DEVICE_OFFLINE,
  EXCEPTION_DEVICE_NOT_RESPONDING,
  EXCEPTION_INVALID_REFRESH_TOKEN,
  EXCEPTION_TOKEN_EXPIRED,
  EXCEPTION_CPTOKEN_EXPIRED,
  LOCAL_PORT,
  LOCAL_SSDP_TIMEOUT,
  LOCAL_PORT_SCAN_TIMEOUT,
  LOCAL_PORT_SCAN_CONCURRENCY,
  LOCAL_REDISCOVER_INTERVAL,
  LOCAL_REDISCOVER_COOLDOWN,
} from './const';

import {
  PanasonicRefreshTokenNotFound,
  TransientApiError,
} from './exceptions';

import { TaiSeiaClient, TaiSeiaCommandRejected, statusKey } from './taiseia';
import { ssdpSearch, scanForOpenPort, localSubnetHosts } from './local-discovery';
import { TokenStore } from './token-store';

interface QueuedRequest {
  config: AxiosRequestConfig;
  resolve: (response: AxiosResponse) => void;
  reject: (error: unknown) => void;
}

/**
 * This class exposes login, device status fetching, and device status update functions.
 */
export default class SmartAppApi {
  private _refresh_token: string;
  private _cp_token: string;
  private _devices: SmartAppDevice[];
  private _devicesInfo: Record<string, SmartAppDeviceInfo>;

  private _commands: Record<string, SmartAppCommandList>;
  private _loginRefreshInterval: NodeJS.Timeout | undefined;

  // Outbound requests are sent one at a time with a fixed gap between them
  // (SECONDS_BETWEEN_REQUEST) to avoid the API rate limit. User commands go
  // through the priority queue so a backlog of status polls can never delay
  // them; the poll queue is bounded and drops excess polls instead of growing.
  private _commandQueue: QueuedRequest[] = [];
  private _pollQueue: QueuedRequest[] = [];
  private _queueRunning = false;
  private _pausedUntil = 0;
  private _lastRequestAt = 0;
  private _disposed = false;
  private _isReloggingIn = false;

  // Local (LAN / TaiSEIA) communication. When a device is reachable locally,
  // reads and commands go over the LAN first and only fall back to the cloud
  // on failure or an unsupported command. Clients are keyed by GWID (= MAC).
  private _localClients = new Map<string, TaiSeiaClient>();
  // device.xml metadata (module model, firmware) keyed by GWID, for the
  // HomeKit AccessoryInformation service.
  private _localMeta = new Map<string, LocalDeviceMetadata>();
  private readonly _localEnabled: boolean;
  private readonly _localScanSubnet: boolean;
  private readonly _localDevicesOverride: LocalDeviceOverride[];
  private _localRediscoverInterval: NodeJS.Timeout | undefined;
  private _localDiscovering = false;
  private _lastLocalDiscoveryAt = 0;

  // Persists the session token so a restart can reuse it instead of logging in
  // with the email/password again.
  private readonly _tokenStore: TokenStore;

  constructor(
    private readonly config: PanasonicPlatformConfig,
    private readonly log: PanasonicPlatformLogger,
    storagePath = '',
  ) {
    this._cp_token = '';
    this._refresh_token = '';
    this._devices = [];
    this._devicesInfo = {};
    this._commands = {};

    this._localEnabled = config.localControl !== false;
    this._localScanSubnet = config.localScanSubnet !== false;
    this._localDevicesOverride = Array.isArray(config.localDevices)
      ? config.localDevices : [];

    this._tokenStore = new TokenStore(storagePath, log);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Stops the periodic token refresh and drains the request queues
  // (called on Homebridge shutdown).
  dispose() {
    this._disposed = true;

    if (this._loginRefreshInterval !== undefined) {
      clearInterval(this._loginRefreshInterval);
      this._loginRefreshInterval = undefined;
    }

    if (this._localRediscoverInterval !== undefined) {
      clearInterval(this._localRediscoverInterval);
      this._localRediscoverInterval = undefined;
    }
    this._localClients.clear();
    this._localMeta.clear();

    const pending = [...this._commandQueue, ...this._pollQueue];
    this._commandQueue.length = 0;
    this._pollQueue.length = 0;
    for (const item of pending) {
      item.reject(new TransientApiError('API client has been disposed.'));
    }
  }

  /**
   * Enqueues a request. Commands (priority) are served before status polls,
   * and the poll queue is bounded: when the server is slow enough that polls
   * arrive faster than they can be sent, new polls are dropped instead of
   * queueing up without bound.
   */
  private request(
    config: AxiosRequestConfig,
    priority = false,
  ): Promise<AxiosResponse> {
    if (this._disposed) {
      return Promise.reject(new TransientApiError('API client has been disposed.'));
    }

    if (!priority && this._pollQueue.length >= MAX_PENDING_POLL_REQUESTS) {
      return Promise.reject(new TransientApiError(
        'Request queue is full - dropping status poll. '
        + 'The Smart App server is probably slow or unreachable.'));
    }

    return new Promise<AxiosResponse>((resolve, reject) => {
      (priority ? this._commandQueue : this._pollQueue).push({ config, resolve, reject });
      this.runQueue();
    });
  }

  /**
   * Sends queued requests one at a time with a fixed gap between them
   * (SECONDS_BETWEEN_REQUEST) and a hard timeout (REQUEST_TIMEOUT). Honours
   * the rate-limit pause set by handleNetworkRequestError on HTTP 429.
   */
  private async runQueue() {
    if (this._queueRunning) {
      return;
    }
    this._queueRunning = true;

    try {
      while (!this._disposed) {
        if (this._commandQueue.length === 0 && this._pollQueue.length === 0) {
          break;
        }

        // Honour the rate-limit pause before picking an item, and sleep in
        // short slices: a priority command arriving during the pause is
        // then still served first, and dispose() is not held up by an
        // already-dequeued request sleeping through the pause.
        const pause = this._pausedUntil - Date.now();
        if (pause > 0) {
          await this.delay(Math.min(pause, 1000));
          continue;
        }

        // Space requests relative to the previous send instead of sleeping
        // after each one, so the queue exits promptly once drained.
        const wait = this._lastRequestAt + SECONDS_BETWEEN_REQUEST * 1000 - Date.now();
        if (wait > 0) {
          await this.delay(wait);
          continue;
        }

        const item = this._commandQueue.shift() ?? this._pollQueue.shift();
        if (item === undefined) {
          break;
        }

        // Requests may sit in the queue across a token refresh or re-login:
        // always send with the current token, not the one captured at
        // enqueue time, or the whole backlog would fail with HTTP 417.
        if (item.config.headers?.cptoken !== undefined) {
          item.config.headers.cptoken = this._cp_token;
        }

        this._lastRequestAt = Date.now();
        try {
          const response = await axios.request({
            timeout: REQUEST_TIMEOUT * 1000,
            ...item.config,
          });
          item.resolve(response);
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this._queueRunning = false;
    }
  }

  /**
   * Re-authenticates in the background when the server reports an expired token.
   * Guarded so overlapping failures only trigger a single login attempt.
   */
  private async reloginIfNeeded() {
    if (this._isReloggingIn) {
      return;
    }
    this._isReloggingIn = true;
    try {
      await this.login();
      this.log.info('Re-login successful after token expiry.');
    } catch {
      this.log.error('Re-login failed after token expiry. Will retry on the next request.');
    } finally {
      this._isReloggingIn = false;
    }
  }

  /**
   * Establishes an authenticated session for startup: reuse a saved token when
   * one exists for the configured account and still works, otherwise log in
   * with the email/password. Resolves once a usable session is ready and
   * rejects only when a full login fails, so the platform's retry still applies.
   */
  async startSession(): Promise<void> {
    const stored = this._tokenStore.load();

    if (stored && stored.email === this.config.email) {
      this._cp_token = stored.cpToken;
      this._refresh_token = stored.refreshToken;

      const age = Date.now() - stored.savedAt;

      // A recently obtained token is still well within its server lifetime, so
      // reuse it directly and skip the RefreshToken1 round-trip. An unexpected
      // invalidation is still caught by the reactive re-login on the first 417.
      if (stored.savedAt > 0 && age >= 0 && age < STORED_TOKEN_MAX_REUSE_AGE) {
        this.armTokenRefresh();
        this.log.info('Reusing the saved Smart App session '
          + `(${Math.round(age / (60 * 60 * 1000))}h old) - no credential login needed.`);
        return;
      }

      // Older (or undated) token: validate and refresh it before use, and fall
      // back to a credential login if it is no longer accepted.
      try {
        await this.refreshStoredToken();
        this.log.info(
          'Refreshed the saved Smart App session - no credential login needed.');
        return;
      } catch {
        this.log.info('The saved Smart App session is no longer valid - '
          + 'logging in with the configured credentials.');
        this._cp_token = '';
        this._refresh_token = '';
        this._tokenStore.clear();
      }
    }

    await this.login();
  }

  /**
   * Validates and refreshes a token loaded from disk via RefreshToken1. Unlike
   * refresh_token(), it does not run the reactive re-login on failure: it just
   * throws so startSession() can fall back to a clean email/password login.
   */
  private async refreshStoredToken(): Promise<void> {
    if (!this._refresh_token) {
      throw new PanasonicRefreshTokenNotFound();
    }

    const response = await this.request({
      method: 'post',
      url: BASE_URL + '/RefreshToken1',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cp_token,
      },
    }, true);

    this._refresh_token = response.data['RefreshToken'];
    this._cp_token = response.data['CPToken'];

    if (!this._cp_token || !this._refresh_token) {
      throw new Error('RefreshToken1 returned an empty token.');
    }

    this.persistToken();
    this.armTokenRefresh();
  }

  /** Writes the current token to disk so a restart can reuse it. */
  private persistToken(): void {
    if (!this._cp_token || !this._refresh_token) {
      return;
    }
    this._tokenStore.save({
      email: this.config.email,
      cpToken: this._cp_token,
      refreshToken: this._refresh_token,
      savedAt: Date.now(),
    });
  }

  /**
   * (Re)arms the periodic token refresh. Shared by login() and the restored
   * session path so a token seeded from disk is still refreshed on schedule.
   * The rejection must be caught inside the interval callback: an unhandled
   * rejection there would crash the whole Homebridge process.
   */
  private armTokenRefresh(): void {
    if (this._disposed) {
      return;
    }
    if (this._loginRefreshInterval !== undefined) {
      clearInterval(this._loginRefreshInterval);
    }
    this._loginRefreshInterval = setInterval(() => {
      this.refresh_token().catch(() => {
        this.log.error('Periodic token refresh failed. '
          + 'Will re-login when the server reports an expired token.');
      });
    }, LOGIN_TOKEN_REFRESH_INTERVAL);
  }

  /**
   * Logs in the user with Smart App and
   * saves the retrieved token on the instance.
  */
  async login() {
    this.log.debug('Smart App: login()');

    // login() bypasses the request queue, so it must honour the global
    // rate-limit pause itself instead of hammering the server during a 429.
    const pause = this._pausedUntil - Date.now();
    if (pause > 0) {
      this.log.debug(`Smart App - login(): waiting ${Math.ceil(pause / 1000)}s `
        + 'for the rate-limit pause before logging in.');
      await this.delay(pause);
    }

    if (this._disposed) {
      throw new TransientApiError('API client has been disposed.');
    }

    if(this._loginRefreshInterval !== undefined){
      clearInterval(this._loginRefreshInterval);
    }

    return axios.request({
      method: 'post',
      url: BASE_URL + '/userlogin1',
      timeout: REQUEST_TIMEOUT * 1000,
      headers: {
        'User-Agent': USER_AGENT,
      },
      data: {
        'MemId': this.config.email,
        'PW': this.config.password,
        'AppToken': APP_TOKEN,
      },
    })
      .then((response) => {
        this.log.debug('Smart App - login(): Success');
        this.log.debug(response.data);

        this._refresh_token = response.data['RefreshToken'];
        this._cp_token = response.data['CPToken'];

        // Persist the fresh token so the next restart can reuse it.
        this.persistToken();

        // A login resolving after dispose() (e.g. a 417-triggered re-login
        // racing Homebridge shutdown) must not re-arm the refresh interval:
        // nothing would ever clear it again.
        if (this._disposed) {
          return;
        }

        // Refresh the token periodically (also re-arms after a re-login).
        this.armTokenRefresh();
      })
      .catch((error: AxiosError) => {
        if (error.response?.status === 429) {
          this._pausedUntil = Date.now() + RATE_LIMIT_PAUSE_SECONDS * 1000;
          this.log.error('Reached API rate limit during login. '
            + `Pausing all requests for ${RATE_LIMIT_PAUSE_SECONDS} seconds.`);
        }
        this.log.error(`Smart App - login(): Error - ${error.message}`);
        this.log.debug(JSON.stringify(error, null, 2));
        throw error;
      });
  }

  async refresh_token() {

    this.log.debug('Attemping to refresh token:' + this._refresh_token);

    if (!this._refresh_token) {
      throw new PanasonicRefreshTokenNotFound();
    }

    return this.request({
      method: 'post',
      url: BASE_URL + '/RefreshToken1',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cp_token,
      },
    }, true)
      .then((response) => {

        this.log.debug('Smart App - refresh_token(): Success');
        this.log.debug(JSON.stringify(response.data));

        this._refresh_token = response.data['RefreshToken'];
        this._cp_token = response.data['CPToken'];

        // Persist the refreshed token (with a new acquisition time).
        this.persistToken();
      })
      .catch((error: AxiosError) => {
        this.log.debug('Smart App - refresh_token(): Error');
        this.handleNetworkRequestError(error);
        return Promise.reject(new Error('Token refresh failed.'));
      });

  }

  async fetchDevices(): Promise<SmartAppDevice[]> {
    this.log.debug('Smart App: fetchDevices()');

    this._devices = [];

    if (!this._cp_token) {
      return Promise.reject(new Error('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.'));
    }

    return this.request({
      method: 'get',
      url: BASE_URL + '/UserGetRegisteredGwList2',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cp_token,
      },
    }, true)
      .then((response) => {

        this.log.debug('Smart App - fetchDevices(): Success');
        this.log.debug(JSON.stringify(response.data));

        for (const device of response.data.GwList) {
          this.log.debug(device.GWID);
          this._devices.push(device);
        }

        for (const command of response.data.CommandList) {
          this.log.debug(command.ModelType);
          this._commands[command.ModelType] = command;
        }

        if (this._devices.length === 0) {
          this.log.info('No devices found. '
            + 'Check whether you have added at least one device to your Smart App account.');
        }



        return this._devices;
      })
      .catch((error: AxiosError) => {
        this.log.debug('Smart App - fetchDevices(): Error');
        this.handleNetworkRequestError(error);
        return Promise.reject(new Error('Fetching the device list failed.'));
      });
  }

  /**
   * Locates the LAN modules for the already-fetched cloud devices and builds a
   * GWID -> {@link TaiSeiaClient} map used to serve reads/commands locally.
   * Discovery is: manual overrides, then SSDP, then (optionally) a subnet scan
   * on port 57223; each candidate host's `/device.xml` MAC is matched to a
   * cloud device's GWID. Never throws and is safe to call repeatedly; a
   * periodic re-run keeps the mapping fresh across DHCP address changes.
   */
  async discoverLocalDevices(): Promise<void> {
    if (!this._localEnabled || this._disposed || this._localDiscovering) {
      return;
    }
    this._localDiscovering = true;
    this._lastLocalDiscoveryAt = Date.now();

    try {
      const devicesByGwid = new Map<string, SmartAppDevice>();
      for (const device of this._devices) {
        devicesByGwid.set(this.normalizeGwid(device.GWID), device);
      }
      if (devicesByGwid.size === 0) {
        return;
      }

      const clients = new Map<string, TaiSeiaClient>();
      const meta = new Map<string, LocalDeviceMetadata>();

      // 1) Manual overrides win and skip network discovery for those devices.
      for (const override of this._localDevicesOverride) {
        const gwid = this.normalizeGwid(override.gwid);
        const device = devicesByGwid.get(gwid);
        if (device && override.host) {
          clients.set(gwid, new TaiSeiaClient(
            override.host, this.log, Number(device.DeviceType)));
        }
      }

      // 2) SSDP, then 3) optional subnet scan, collecting candidate hosts.
      const candidateHosts = new Set<string>();
      (await ssdpSearch(this.log, LOCAL_SSDP_TIMEOUT))
        .forEach(host => candidateHosts.add(host));

      if (this._localScanSubnet) {
        const subnet = localSubnetHosts(this.log);
        if (subnet.length > 0) {
          (await scanForOpenPort(
            subnet, LOCAL_PORT, LOCAL_PORT_SCAN_TIMEOUT, LOCAL_PORT_SCAN_CONCURRENCY))
            .forEach(host => candidateHosts.add(host));
        }
      }

      const overrideHosts = new Set(
        Array.from(clients.values(), client => client.host));

      // 4) Probe each candidate's device.xml for its MAC and match to a GWID.
      await Promise.all(Array.from(candidateHosts, async (host) => {
        if (overrideHosts.has(host)) {
          return;
        }
        try {
          const endpoint = await new TaiSeiaClient(host, this.log, 0)
            .fetchDeviceEndpoint();
          const device = devicesByGwid.get(endpoint.mac);
          if (device) {
            meta.set(endpoint.mac, {
              moduleModel: endpoint.modelName,
              modelNumber: endpoint.modelNumber,
              firmware: endpoint.firmware,
            });
            if (!clients.has(endpoint.mac)) {
              clients.set(endpoint.mac, new TaiSeiaClient(
                host, this.log, Number(device.DeviceType)));
            }
          }
        } catch (error) {
          this.log.debug(`Local discovery: probing ${host} failed - `
            + `${error instanceof Error ? error.message : String(error)}`);
        }
      }));

      this._localClients = clients;
      this._localMeta = meta;

      if (clients.size > 0) {
        const summary = Array.from(clients.entries(), ([gwid, client]) =>
          `${devicesByGwid.get(gwid)?.NickName ?? gwid}@${client.host}`).join(', ');
        this.log.info(`Local control enabled for ${clients.size} device(s): ${summary}.`);
      } else {
        this.log.info('Local control: no devices reachable on the LAN - using the cloud.');
      }

      if (!this._disposed && this._localRediscoverInterval === undefined) {
        this._localRediscoverInterval = setInterval(() => {
          this.discoverLocalDevices().catch(() => {
            // discoverLocalDevices() logs its own failures.
          });
        }, LOCAL_REDISCOVER_INTERVAL);
      }
    } catch (error) {
      this.log.debug('Local discovery failed: '
        + `${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this._localDiscovering = false;
    }
  }

  private normalizeGwid(gwid: string): string {
    return (gwid || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  }

  private localClientFor(device: SmartAppDevice): TaiSeiaClient | undefined {
    if (!this._localEnabled) {
      return undefined;
    }
    return this._localClients.get(this.normalizeGwid(device.GWID));
  }

  /**
   * Returns the device.xml metadata (module model, firmware) for a device, or
   * undefined when it was not (yet) reached locally.
   */
  public getLocalMetadata(device: SmartAppDevice): LocalDeviceMetadata | undefined {
    return this._localMeta.get(this.normalizeGwid(device.GWID));
  }

  /**
   * Reads the device status over the LAN in a single ALL_STATES request and
   * returns it in the same shape as the cloud path, caching it under the GWID.
   * Throws on transport failure or refusal so the caller can fall back.
   */
  private async fetchDeviceInfoLocal(
    device: SmartAppDevice,
    options: string[],
    client: TaiSeiaClient,
  ): Promise<SmartAppDeviceInfo> {
    const states = await client.fetchAllStates();

    const info: SmartAppDeviceInfo = {};
    for (const option of options) {
      const service = parseInt(option, 16);
      if (Number.isFinite(service) && states[service] !== undefined) {
        info[statusKey(service)] = String(states[service]);
      }
    }

    this._devicesInfo[device.GWID] = info;
    this.log.debug(`Smart App - fetchDeviceInfoLocal() for '${device.NickName}' `
      + `via ${client.host}: ${JSON.stringify(info)}`);
    return info;
  }

  /** Sends a single command over the LAN, updating the cache on success. */
  private async doCommandLocal(
    device: SmartAppDevice,
    command: string,
    value: string,
    client: TaiSeiaClient,
  ): Promise<void> {
    const service = parseInt(command, 16);
    const numericValue = parseInt(value, 10);
    if (!Number.isFinite(service) || !Number.isFinite(numericValue)) {
      throw new TaiSeiaCommandRejected(
        `Command '${command}'='${value}' is not a numeric local command.`);
    }

    await client.write(service, numericValue);

    // Optimistically update the cache, mirroring the cloud doCommand().
    if (this._devicesInfo[device.GWID] === undefined) {
      this._devicesInfo[device.GWID] = {};
    }
    this._devicesInfo[device.GWID][command] = value;
    this.log.debug(`Smart App - doCommandLocal() for '${device.NickName}' `
      + `via ${client.host}: '${command}'='${value}'`);
  }

  /**
   * Handles a failed local operation. A refusal (unsupported command) keeps the
   * client - the device is reachable, only that command isn't. A transport
   * failure drops the client so later calls go straight to the cloud, and
   * schedules a throttled rediscovery in case the module's IP changed.
   */
  private handleLocalFailure(
    device: SmartAppDevice,
    error: unknown,
    context: string,
  ): void {
    if (error instanceof TaiSeiaCommandRejected) {
      this.log.debug(`Local ${context} refused for '${device.NickName}' `
        + `(${error.message}); falling back to the cloud.`);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.log.debug(`Local ${context} failed for '${device.NickName}' `
      + `(${message}); falling back to the cloud.`);

    if (this._localClients.delete(this.normalizeGwid(device.GWID))) {
      this.maybeRediscoverLocal();
    }
  }

  /** Kicks off a background rediscovery, throttled by a cooldown. */
  private maybeRediscoverLocal(): void {
    if (!this._localEnabled || this._disposed || this._localDiscovering) {
      return;
    }
    if (Date.now() - this._lastLocalDiscoveryAt < LOCAL_REDISCOVER_COOLDOWN) {
      return;
    }
    this.discoverLocalDevices().catch(() => {
      // discoverLocalDevices() logs its own failures.
    });
  }

  /**
   * Fetches the requested status codes and returns the cached status map.
   * Returns `undefined` when the device request failed, and `null` when the
   * failure was a global condition (full queue, rate-limit pause, shutdown)
   * that callers must not attribute to the device.
   */
  async fetchDeviceInfo(
    device: SmartAppDevice,
    options: string[] | undefined = ['0x00', '0x01', '0x03', '0x04'],
  ): Promise<SmartAppDeviceInfo | null | undefined> {
    this.log.debug(`Smart App: fetchDeviceInfo() for device GUID '${device.NickName}'`);

    // Prefer the LAN: a local ALL_STATES read avoids the cloud (and its rate
    // limit) entirely. Any failure falls through to the cloud path below.
    const localClient = this.localClientFor(device);
    if (localClient) {
      try {
        return await this.fetchDeviceInfoLocal(device, options, localClient);
      } catch (error) {
        this.handleLocalFailure(device, error, 'fetchDeviceInfo');
      }
    }

    if (!this._cp_token) {
      return Promise.reject(new Error('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.'));
    }

    const commands: { DeviceID: number; CommandTypes: { CommandType: string }[] } = {
      DeviceID: 1,
      CommandTypes: [],
    };
    for (const option of options) {
      commands.CommandTypes.push({ 'CommandType': option });
    }

    return this.request({
      method: 'post',
      url: BASE_URL + '/DeviceGetInfo',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cp_token,
        'auth': device.Auth,
        'gwid': device.GWID,
      },
      data: [commands],
    })
      .then((response) => {

        this._devicesInfo[device.GWID] = {};

        this.log.debug(`Smart App - fetchDeviceInfo() for '${device.NickName}': Success`);
        this.log.debug(JSON.stringify(response.data));


        for (const info of response.data['devices'][0]['Info']) {
          this._devicesInfo[device.GWID][info['CommandType']] = info['status'];
        }

        return this._devicesInfo[device.GWID];
      })
      .catch((error: AxiosError) => {

        this.log.debug(`Smart App - fetchDeviceInfo() for '${device.NickName}': Error`);

        if (error instanceof TransientApiError) {
          return null;
        }

        this.handleNetworkRequestError(error, device);

        // A 429 is a global condition already handled by the queue pause -
        // don't let the accessory whose poll drew it think its device failed.
        if (error.response?.status === 429) {
          return null;
        }

        return undefined;
      });
  }

  async doCommand(device: SmartAppDevice, command: string, value: string): Promise<void> {
    this.log.debug(`Smart App: doCommand() for '${device.NickName}' : '${command}' : '${value}'`);

    // Prefer the LAN. A refusal (unsupported command) or transport failure
    // falls through to the cloud path below.
    const localClient = this.localClientFor(device);
    if (localClient) {
      try {
        await this.doCommandLocal(device, command, value, localClient);
        return;
      } catch (error) {
        this.handleLocalFailure(device, error, `doCommand '${command}'`);
      }
    }

    if (!this._cp_token) {
      return Promise.reject(new Error('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.'));
    }

    const payload = { 'DeviceID': 1, 'CommandType': command, 'Value': value };

    // User commands take the priority queue so they are never stuck behind
    // a backlog of status polls.
    return this.request({
      method: 'get',
      url: BASE_URL + '/DeviceSetCommand',
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cp_token,
        'auth': device.Auth,
        'gwid': device.GWID,
      },
      params: payload,
    }, true)
      .then((response) => {
        this.log.debug('Smart App - doCommand(): Success');
        this.log.debug(response.data);
        this.setDeviceInfo(device, command, value);
      })
      .catch((error: AxiosError) => {
        this.log.debug('Smart App - doCommand(): Error');
        if (error instanceof TransientApiError) {
          throw error;
        }
        this.handleNetworkRequestError(error, device);
        return Promise.reject(new Error(`Sending command '${command}' failed.`));
      });
  }

  public getDeviceInfo(
    device: SmartAppDevice,
    commandType: string,
    defaultValue: string | undefined = ''): string {

    if (this._devicesInfo[device.GWID] !== undefined
      && this._devicesInfo[device.GWID][commandType] !== undefined) {
      return this._devicesInfo[device.GWID][commandType];
    }

    return defaultValue;

  }

  public setDeviceInfo(
    device: SmartAppDevice,
    commandType: string,
    value: string): boolean {

    if (this._devicesInfo[device.GWID] !== undefined
      && this._devicesInfo[device.GWID][commandType] !== undefined) {
      this._devicesInfo[device.GWID][commandType] = value;
      return true;
    }

    return false;

  }


  public getCommandList(device: SmartAppDevice, commandType: string) {

    try {

      if (this._commands[device.ModelType] !== undefined) {

        for (const command of this._commands[device.ModelType].JSON[0].list) {
          if (commandType === command.CommandType) {
            return command;
          }
        }

      }


    } catch (e) {
      this.log.error(e);
    }

    return undefined;

  }

  public getCommandName(
    device: SmartAppDevice,
    commandType: string,
    defaultValue: string | undefined = ''): string {

    try {

      if (this._commands[device.ModelType] !== undefined) {

        for (const command of this._commands[device.ModelType].JSON[0].list) {
          if (commandType === command.CommandType) {
            return command.CommandName;
          }
        }

      }


    } catch (e) {
      this.log.error(e);
    }

    return defaultValue;

  }

  /**
   * Generic Axios error handler that checks which type of
   * error occurred and prints the respective information.
   *
   * @see https://axios-http.com/docs/handling_errors
   * @param error The error that is passes into the Axios error handler
   */
  handleNetworkRequestError(
    error: AxiosError,
    device: SmartAppDevice | undefined = undefined) {

    const status = error.response?.status;

    if (status === 417) {

      const data = error.response?.data as { StateMsg?: string } | undefined;
      const stateMsg = data?.StateMsg ?? '';

      if (stateMsg === EXCEPTION_DEVICE_OFFLINE || stateMsg === EXCEPTION_DEVICE_NOT_RESPONDING) {

        const deviceName = device !== undefined ? device.NickName : 'Device';

        this.log.info(`${deviceName} is offline or not responding. Please check the device.`);

      } else if (
        stateMsg === EXCEPTION_INVALID_REFRESH_TOKEN
        || stateMsg === EXCEPTION_TOKEN_EXPIRED
        || stateMsg === EXCEPTION_CPTOKEN_EXPIRED
      ) {
        this.log.info('Authentication token expired. Attempting to log in again.');
        this.reloginIfNeeded();
      } else {
        this.log.debug(error.request);
        this.log.debug(error.message);
      }

    } else if (status === 429) {
      // Pause the whole queue for a while instead of hammering the server.
      this._pausedUntil = Date.now() + RATE_LIMIT_PAUSE_SECONDS * 1000;
      this.log.error('Reached API rate limit. '
        + `Pausing all requests for ${RATE_LIMIT_PAUSE_SECONDS} seconds.`);
    } else {
      this.log.debug(error.request);
      this.log.debug(error.message);
    }

  }
}
