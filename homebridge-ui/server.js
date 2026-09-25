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
// Washers and dryers only when their model reports a finished cycle.
const SUPPORTED_TYPES = new Set(['1', '3', '4', '6', '8', '14', '17']);
const LAUNDRY_TYPES = new Set(['3', '6']);

const DEVICE_TYPE_NAMES = {
  '1': 'Air Conditioner',
  '2': 'Refrigerator',
  '3': 'Washing Machine',
  '4': 'Dehumidifier',
  '5': 'Television',
  '6': 'Dryer',
  '7': 'Heat Pump Water Heater',
  '8': 'Air Purifier',
  '14': 'Heat Exchanger',
  '15': 'Fan',
  '17': 'Smart Switch',
  '23': 'Weight Plate',
};

// Kept in sync with src/accessories: codes resolved from the model's
// CommandList by name, as the plugin does.
const FINISHED_NAME = /終了|完了|完成|結束/;
const RUNNING_NAME = /(動作|運轉|運行|作動|洗衣|洗濯|乾燥|烘乾|烘衣)中/;
const sameCode = (a, b) => parseInt(a, 16) === parseInt(b, 16);
const key = (code) => '0x' + parseInt(code, 16).toString(16).toUpperCase().padStart(2, '0');
const isEnum = (c) => c.ParameterType === 'enum' && Array.isArray(c.Parameters) && c.Parameters.length > 0;
const isReading = (c) => !c.ParameterType && !(c.Parameters || []).length;

function laundryStatus(commands) {
  const withFinished = commands.filter((c) => isEnum(c)
    && c.Parameters.some((p) => FINISHED_NAME.test(String(p[0]))));
  const preferred = ['0x50', '0x03', '0x01'];
  const rank = (c) => {
    const i = preferred.findIndex((code) => sameCode(code, c.CommandType));
    return i < 0 ? preferred.length : i;
  };
  withFinished.sort((a, b) => rank(a) - rank(b));
  return withFinished[0];
}

// Status codes read for a device's card, and how to name what they mean.
function statusPlan(device, commands) {
  const byName = (re, accept) => commands.find((c) => re.test(c.CommandName || '') && accept(c));
  switch (String(device.DeviceType)) {
    case '1':
      return { codes: ['0x00', '0x01', '0x04', '0x03'] };
    case '4':
      return { codes: ['0x00', '0x07', '0x04', '0x0A'] };
    case '8': {
      const pm = byName(/PM\s*2\.?5/i, (c) => isReading(c) && !/level/i.test(c.CommandName));
      const pm25 = key(pm ? pm.CommandType : '0x53');
      return { codes: ['0x00', pm25], pm25 };
    }
    case '14': {
      const mode = byName(/換氣|模式/, isEnum);
      return { codes: ['0x00'].concat(mode ? [key(mode.CommandType)] : []), mode };
    }
    case '17':
      return { codes: ['0x70', '0x00'] };
    case '3':
    case '6': {
      const status = laundryStatus(commands);
      return { codes: status ? [key(status.CommandType)] : [], status };
    }
    default:
      return { codes: ['0x00'] };
  }
}

const labelOf = (command, value) => {
  const param = ((command && command.Parameters) || []).find((p) => String(p[1]) === String(value));
  return param ? String(param[0]) : undefined;
};

class PanasonicUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this._cpToken = '';
    this._devices = [];
    this._commands = {};

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
    this._commands = {};
    for (const entry of response.data.CommandList || []) {
      this._commands[entry.ModelType] = ((entry.JSON || [])[0] || {}).list || [];
    }
    return response.data.GwList || [];
  }

  commandsFor(device) {
    return this._commands[device.ModelType] || [];
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
      supported: SUPPORTED_TYPES.has(String(device.DeviceType))
        && (!LAUNDRY_TYPES.has(String(device.DeviceType))
          || laundryStatus(this.commandsFor(device)) !== undefined),
      circuits: (device.Devices || []).length,
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
      const plan = statusPlan(device, this.commandsFor(device));
      if (plan.codes.length === 0) {
        statuses[device.GWID] = null;
        continue;
      }
      try {
        const info = await this.fetchDeviceInfo(device, plan.codes);
        // Name what the model-specific codes mean, so the page stays generic.
        if (plan.pm25) {
          info.pm25 = info[plan.pm25];
        }
        if (plan.mode) {
          info.modeName = labelOf(plan.mode, info[key(plan.mode.CommandType)]);
        }
        if (plan.status) {
          const value = info[key(plan.status.CommandType)];
          info.laundry = labelOf(plan.status, value);
          info.laundryDone = FINISHED_NAME.test(info.laundry || '');
          info.laundryRunning = RUNNING_NAME.test(info.laundry || '');
        }
        statuses[device.GWID] = info;
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
      CommandTypes: codes.map(code => ({ CommandType: key(code) })),
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
