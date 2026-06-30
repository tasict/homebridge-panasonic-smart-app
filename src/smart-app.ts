import PanasonicPlatformLogger from './logger';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
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
  EXCEPTION_DEVICE_OFFLINE,
  EXCEPTION_DEVICE_NOT_RESPONDING,
  EXCEPTION_INVALID_REFRESH_TOKEN,
  EXCEPTION_TOKEN_EXPIRED,
  EXCEPTION_CPTOKEN_EXPIRED,
} from './const';

import {
  PanasonicRefreshTokenNotFound,
} from './exceptions';

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

  // Serialises outbound requests and spaces them out to avoid the API rate limit.
  private _requestQueue: Promise<unknown> = Promise.resolve();
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

  // Stops the periodic token refresh (called on Homebridge shutdown).
  dispose() {
    if (this._loginRefreshInterval !== undefined) {
      clearInterval(this._loginRefreshInterval);
      this._loginRefreshInterval = undefined;
    }
  }

  /**
   * Runs all device requests through a single FIFO queue with a fixed gap
   * between them (SECONDS_BETWEEN_REQUEST) and a hard timeout (REQUEST_TIMEOUT),
   * so concurrent accessory refreshes don't trip the API rate limit.
   */
  private request(config: AxiosRequestConfig) {
    const run = this._requestQueue.then(() => axios.request({
      timeout: REQUEST_TIMEOUT * 1000,
      ...config,
    }));

    // Keep the chain alive regardless of success/failure, then space out the next call.
    this._requestQueue = run
      .catch(() => undefined)
      .then(() => this.delay(SECONDS_BETWEEN_REQUEST * 1000));

    return run;
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

        // Set an interval to refresh the login token periodically.
        this._loginRefreshInterval = setInterval(this.refresh_token.bind(this),
          LOGIN_TOKEN_REFRESH_INTERVAL);
      })
      .catch((error: AxiosError) => {
        this.log.error('Smart App - login(): Error');
        this.log.error(JSON.stringify(error, null, 2));
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
    })
      .then((response) => {

        this.log.debug('Smart App - refresh_token(): Success');
        this.log.debug(JSON.stringify(response.data));

        this._refresh_token = response.data['RefreshToken'];
        this._cp_token = response.data['CPToken'];


      })
      .catch((error: AxiosError) => {
        this.log.debug('Smart App - refresh_token(): Error');
        this.handleNetworkRequestError(error);
        return Promise.reject();
      });

  }

  async fetchDevices(): Promise<SmartAppDevice[]> {
    this.log.debug('Smart App: fetchDevices()');

    this._devices = [];

    if (!this._cp_token) {
      return Promise.reject('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.');
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
    })
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
        return Promise.reject();
      });
  }

  async fetchDeviceInfo(
    device: SmartAppDevice,
    options: string[] | undefined = ['0x00', '0x01', '0x03', '0x04'],
  ): Promise<SmartAppDeviceInfo | undefined> {
    this.log.debug(`Smart App: fetchDeviceInfo() for device GUID '${device.NickName}'`);

    if (!this._cp_token) {
      return Promise.reject('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.');
    }

    if (!device) {
      return Promise.reject('Cannot get device info for undefined device.');
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
        this.handleNetworkRequestError(error, device);
        return undefined;
      });
  }

  async doCommand(device: SmartAppDevice, command: string, value: string): Promise<void> {
    this.log.debug(`Smart App: doCommand() for '${device.NickName}' : '${command}' : '${value}'`);

    if (!this._cp_token) {
      return Promise.reject('No auth token available (login probably failed). '
        + 'Check your credentials and restart Homebridge.');
    }

    if (!device) {
      return Promise.reject('Cannot set device status for undefined deviceGuid.');
    }

    const payload = { 'DeviceID': 1, 'CommandType': command, 'Value': value };

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
    })
      .then((response) => {
        this.log.debug('Smart App - doCommand(): Success');
        this.log.debug(response.data);
        this.setDeviceInfo(device, command, value);
      })
      .catch((error: AxiosError) => {
        this.log.debug('Smart App - doCommand(): Error');
        this.handleNetworkRequestError(error, device);
        return Promise.reject();
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
      this.log.error('Reached API rate limit. Please try again later.');
    } else {
      this.log.debug(error.request);
      this.log.debug(error.message);
    }

  }
}
