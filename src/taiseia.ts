import http from 'http';
import PanasonicPlatformLogger from './logger';
import {
  LOCAL_PORT,
  LOCAL_CONTROL_PATH,
  LOCAL_DEVICE_XML_PATH,
  LOCAL_REQUEST_TIMEOUT,
  LOCAL_SOAP_SERVICE,
  TAISEIA_TYPE_REGISTER,
  TAISEIA_REG_ALL_STATES,
  TAISEIA_UNSUPPORTED_SERVICE,
} from './const';
import { LocalDeviceEndpoint } from './types';

/**
 * Raised when a module accepts the request but refuses the command: it returns
 * the all-`F` rejection frame, echoes back the "unsupported service" id, or
 * sends a malformed PDU. Callers treat this as "not doable locally" and fall
 * back to the cloud - it is distinct from a transport error (device offline).
 */
export class TaiSeiaCommandRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaiSeiaCommandRejected';
  }
}

export function xorChecksum(data: Buffer): number {
  let c = 0;
  for (const b of data) {
    c ^= b;
  }
  return c;
}

/**
 * Builds a TaiSEIA PDU: `[06, typeId, serviceId, dataHi, dataLo, xor]`.
 * The high bit of the service id marks a write. `data` is a 16-bit value
 * (0xFFFF is the conventional "read / don't care" payload).
 */
export function makePdu(
  typeId: number,
  service: number,
  data = 0xffff,
  write = false,
): Buffer {
  const sid = write ? (0x80 | service) : (service & 0x7f);
  const body = Buffer.from([
    6,
    typeId & 0xff,
    sid,
    (data >> 8) & 0xff,
    data & 0xff,
  ]);
  return Buffer.concat([body, Buffer.from([xorChecksum(body)])]);
}

/**
 * Formats a service id as the cloud's CommandType string (e.g. `0x0E`), so a
 * locally-read status map is a drop-in replacement for the cloud one.
 */
export function statusKey(service: number): string {
  return '0x' + service.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Parses an ALL_STATES response body of `(serviceId, hi, lo)` triples into a
 * `serviceId -> value` map.
 */
export function parseAllStates(resp: Buffer): Record<number, number> {
  const states: Record<number, number> = {};
  if (resp.length < 4) {
    return states;
  }
  const body = resp.subarray(3, resp.length - 1);
  for (let i = 0; i + 2 < body.length; i += 3) {
    states[body[i]] = (body[i + 1] << 8) | body[i + 2];
  }
  return states;
}

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function macFromUdn(udn: string): string {
  // UDN looks like `uuid:0F422ECF-...-B8B7F1212AAB`; the last segment is the MAC.
  const tail = udn.split('-').pop() ?? '';
  return /^[0-9A-Fa-f]{12}$/.test(tail) ? tail.toUpperCase() : '';
}

/**
 * Async TaiSEIA 101 client for a single Panasonic module reached over its
 * CZ-T006/T007 UPnP `SetSaanet` endpoint on the LAN. One instance per device.
 */
export class TaiSeiaClient {
  constructor(
    public readonly host: string,
    private readonly log: PanasonicPlatformLogger,
    // The device's SA type id, which equals the cloud `DeviceType`
    // (1 = AC, 4 = dehumidifier, 8 = air cleaner). Used for reads/writes.
    private readonly typeId: number,
    public readonly port: number = LOCAL_PORT,
  ) {}

  /**
   * Issues one HTTP request to the module. The CZ-T006/T007 embedded server
   * returns non-compliant HTTP (bare-LF line endings), which Node's strict
   * parser (and axios) reject - so the lenient parser is required here.
   */
  private httpRequest(
    path: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        path,
        method,
        headers,
        timeout: LOCAL_REQUEST_TIMEOUT,
        insecureHTTPParser: true,
      }, (res) => {
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Local request to ${this.host} timed out`));
      });
      if (body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * Sends one PDU via SetSaanet and returns the validated response PDU.
   * Throws {@link TaiSeiaCommandRejected} on a refusal/unsupported/malformed
   * reply, and rethrows transport errors (timeout, connection refused) as-is.
   */
  async setSaanet(frame: Buffer): Promise<Buffer> {
    const hexv = frame.toString('hex').toUpperCase();
    const body
      = '<?xml version="1.0"?>'
      + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
      + 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
      + '<s:Body>'
      + `<u:SetSaanet xmlns:u="${LOCAL_SOAP_SERVICE}">`
      + `<NewSaanetValue>${hexv}</NewSaanetValue>`
      + '</u:SetSaanet></s:Body></s:Envelope>';

    const text = await this.httpRequest(LOCAL_CONTROL_PATH, 'POST', {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPACTION': `"${LOCAL_SOAP_SERVICE}#SetSaanet"`,
      'Content-Length': String(Buffer.byteLength(body)),
    }, body);

    const match = text.match(/<RetSaanetValue>([^<]*)<\/RetSaanetValue>/);
    if (!match) {
      throw new TaiSeiaCommandRejected(
        `No RetSaanetValue in response from ${this.host}`);
    }

    const ret = match[1];
    if (ret.toUpperCase() === 'FFFFFFFFFFFF') {
      throw new TaiSeiaCommandRejected(`Command rejected by ${this.host}: ${hexv}`);
    }

    const raw = Buffer.from(ret, 'hex');
    if (raw.length < 6
      || raw[0] !== raw.length
      || xorChecksum(raw.subarray(0, raw.length - 1)) !== raw[raw.length - 1]) {
      throw new TaiSeiaCommandRejected(
        `Invalid TaiSEIA response from ${this.host}: ${ret}`);
    }

    // An unavailable service is echoed back with service id 0x7F (0xFF & 0x7F).
    if ((raw[2] & 0x7f) === TAISEIA_UNSUPPORTED_SERVICE) {
      throw new TaiSeiaCommandRejected(
        `Service not supported by ${this.host}: ${ret}`);
    }

    return raw;
  }

  /**
   * Reads every reported service in a single request. Returns a
   * `serviceId -> value` map, mirroring the raw registers the cloud relays.
   */
  async fetchAllStates(): Promise<Record<number, number>> {
    const resp = await this.setSaanet(
      makePdu(TAISEIA_TYPE_REGISTER, TAISEIA_REG_ALL_STATES));
    return parseAllStates(resp);
  }

  /** Writes a 16-bit value to a service and returns the acknowledged value. */
  async write(service: number, value: number): Promise<number> {
    const resp = await this.setSaanet(
      makePdu(this.typeId, service, value & 0xffff, true));
    return (resp[3] << 8) | resp[4];
  }

  /**
   * Fetches `/device.xml` to confirm the module is reachable and to learn its
   * MAC (from the UDN) so it can be matched to a cloud device by GWID.
   */
  async fetchDeviceEndpoint(): Promise<LocalDeviceEndpoint> {
    const xml = await this.httpRequest(LOCAL_DEVICE_XML_PATH, 'GET', {});

    // modelDescription looks like: "WiFi with SAANET Module:SW_VER 2.1.2 ...".
    const firmware = xmlTag(xml, 'modelDescription').match(/SW_VER\s+([0-9.]+)/i);

    const endpoint: LocalDeviceEndpoint = {
      host: this.host,
      mac: macFromUdn(xmlTag(xml, 'UDN')),
      friendlyName: xmlTag(xml, 'friendlyName'),
      modelName: xmlTag(xml, 'modelName'),
      modelNumber: xmlTag(xml, 'modelNumber'),
      firmware: firmware ? firmware[1] : '',
    };

    this.log.debug(`TaiSEIA: ${this.host} -> mac=${endpoint.mac} `
      + `module=${endpoint.modelName} fw=${endpoint.firmware}`);
    return endpoint;
  }
}
