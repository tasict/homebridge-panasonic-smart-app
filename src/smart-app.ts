import PanasonicPlatformLogger from './logger';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  LOGIN_TOKEN_REFRESH_INTERVAL,
} from './settings';
import {
  SmartAppDevice,
  SmartAppDeviceInfo,
  PanasonicPlatformConfig,
  SmartAppCommandList,
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
} from './const';

import {
  PanasonicRefreshTokenNotFound,
  TransientApiError,
} from './exceptions';

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

  constructor(
    private readonly config: PanasonicPlatformConfig,
    private readonly log: PanasonicPlatformLogger,
  ) {
    this._cp_token = '';
    this._refresh_token = '';
    this._devices = [];
    this._devicesInfo = {};
    this._commands = {};
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

        // A login resolving after dispose() (e.g. a 417-triggered re-login
        // racing Homebridge shutdown) must not re-arm the refresh interval:
        // nothing would ever clear it again.
        if (this._disposed) {
          return;
        }

        // Set an interval to refresh the login token periodically.
        // The rejection must be caught here: an unhandled rejection from the
        // interval callback would crash the whole Homebridge process.
        this._loginRefreshInterval = setInterval(() => {
          this.refresh_token().catch(() => {
            this.log.error('Periodic token refresh failed. '
              + 'Will re-login when the server reports an expired token.');
          });
        }, LOGIN_TOKEN_REFRESH_INTERVAL);
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
