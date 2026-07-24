const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Kept in sync with src/const.ts / src/token-store.ts. The custom UI talks to
// the same cloud API and reuses the token the running plugin saved to disk.
const BASE_URL = 'https://ems2.panasonic.com.tw/api';
const APP_TOKEN = 'D8CBFF4C-2824-4342-B22D-189166FEF503';
const USER_AGENT = 'okhttp/4.9.1';
const REQUEST_TIMEOUT = 20000;
const TOKEN_FILE = 'panasonic-smart-app-session.json';

// Device types this plugin can expose to HomeKit (see SupportDeviceType).
const SUPPORTED_TYPES = new Set(['1', '4', '8']);

const DEVICE_TYPE_NAMES = {
  '1': 'Air Conditioner',
  '2': 'Refrigerator',
  '3': 'Washing Machine',
  '4': 'Dehumidifier',
  '5': 'Television',
  '6': 'Dryer',
  '7': 'Heat Pump Water Heater',
  '8': 'Air Purifier',
  '15': 'Fan',
};

// Status codes read per device type for the card (power is common to all).
const STATUS_CODES = {
  '1': ['0x00', '0x01', '0x04', '0x03'],
  '4': ['0x00', '0x07', '0x04', '0x0A'],
  '8': ['0x00', '0x53'],
};

class PanasonicUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this._cpToken = '';
    this._devices = [];

    this.onRequest('/devices', this.handleDevices.bind(this));
    this.onRequest('/statuses', this.handleStatuses.bind(this));

    this.ready();
  }

  get tokenPath() {
    return path.join(this.homebridgeStoragePath || '', TOKEN_FILE);
  }

  loadStoredToken() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
      if (parsed && typeof parsed.cpToken === 'string' && parsed.cpToken) {
        return parsed;
      }
    } catch {
      // No usable saved token.
    }
    return null;
  }

  saveToken(email, data) {
    try {
      const payload = JSON.stringify({
        email,
        cpToken: data.CPToken,
        refreshToken: data.RefreshToken,
        savedAt: Date.now(),
      });
      const tmp = this.tokenPath + '.tmp';
      fs.writeFileSync(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.tokenPath);
    } catch {
      // Best effort - the plugin manages its own token too.
    }
  }

  async login(email, password) {
    if (!email || !password) {
      throw new RequestError(
        'Enter your Panasonic Smart App email and password, then save, before loading devices.',
        { status: 400 });
    }
    let response;
    try {
      response = await axios.request({
        method: 'post',
        url: BASE_URL + '/userlogin1',
        timeout: REQUEST_TIMEOUT,
        headers: { 'User-Agent': USER_AGENT },
        data: { MemId: email, PW: password, AppToken: APP_TOKEN },
      });
    } catch (error) {
      const status = error.response && error.response.status;
      throw new RequestError(
        status === 429
          ? 'The Panasonic server is rate limiting right now. Please wait a minute and try again.'
          : 'Login failed. Please check your email and password.',
        { status: status || 500 });
    }
    this._cpToken = response.data.CPToken;
    this.saveToken(email, response.data);
    return this._cpToken;
  }

  async fetchDeviceList(cpToken) {
    const response = await axios.request({
      method: 'get',
      url: BASE_URL + '/UserGetRegisteredGwList2',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': cpToken,
      },
    });
    return response.data.GwList || [];
  }

  async handleDevices(payload) {
    const email = payload && payload.email;
    const password = payload && payload.password;

    // Prefer a token already cached this session, then the one the running
    // plugin saved to disk (only if it belongs to the same account).
    let cpToken = this._cpToken;
    if (!cpToken) {
      const stored = this.loadStoredToken();
      if (stored && (!email || stored.email === email)) {
        cpToken = stored.cpToken;
      }
    }

    let list;
    try {
      if (!cpToken) {
        throw new Error('no-token');
      }
      list = await this.fetchDeviceList(cpToken);
    } catch {
      // Missing or expired token: log in with the configured credentials.
      cpToken = await this.login(email, password);
      list = await this.fetchDeviceList(cpToken);
    }

    this._cpToken = cpToken;
    this._devices = list;

    return list.map(device => ({
      gwid: device.GWID,
      name: device.NickName,
      model: device.Model,
      deviceType: device.DeviceType,
      typeName: DEVICE_TYPE_NAMES[device.DeviceType] || ('Type ' + device.DeviceType),
      supported: SUPPORTED_TYPES.has(String(device.DeviceType)),
    }));
  }

  async handleStatuses() {
    const statuses = {};
    if (!this._cpToken || this._devices.length === 0) {
      return statuses;
    }

    // Read sequentially with a gap so the UI doesn't trip the account's rate
    // limit (the running plugin is polling the same API).
    for (const device of this._devices) {
      const codes = STATUS_CODES[String(device.DeviceType)] || ['0x00'];
      try {
        statuses[device.GWID] = await this.fetchDeviceInfo(device, codes);
      } catch {
        statuses[device.GWID] = null;
      }
      await this.delay(1200);
    }
    return statuses;
  }

  async fetchDeviceInfo(device, codes) {
    const data = [{
      DeviceID: 1,
      CommandTypes: codes.map(code => ({ CommandType: code })),
    }];
    const response = await axios.request({
      method: 'post',
      url: BASE_URL + '/DeviceGetInfo',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'cptoken': this._cpToken,
        'auth': device.Auth,
        'gwid': device.GWID,
      },
      data,
    });

    const info = {};
    const entries = (((response.data || {}).devices || [])[0] || {}).Info || [];
    for (const entry of entries) {
      info[entry.CommandType] = entry.status;
    }
    return info;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

(() => new PanasonicUiServer())();
