export const BASE_URL = 'https://ems2.panasonic.com.tw/api';
export const APP_TOKEN = 'D8CBFF4C-2824-4342-B22D-189166FEF503';
export const USER_AGENT = 'okhttp/4.9.1';

export const SECONDS_BETWEEN_REQUEST = 2;
export const REQUEST_TIMEOUT = 20;

// Upper bound for queued status polls; excess polls are dropped so a slow
// server cannot grow the queue (and delay user commands) without bound.
export const MAX_PENDING_POLL_REQUESTS = 32;

// How long to pause the request queue after an HTTP 429 (rate limit).
export const RATE_LIMIT_PAUSE_SECONDS = 60;

export const EXCEPTION_DEVICE_OFFLINE = 'deviceOffline';
export const EXCEPTION_DEVICE_NOT_RESPONDING = 'deviceNoResponse';
export const EXCEPTION_TOKEN_EXPIRED = '無法依據您的CPToken,auth取得相關資料';
export const EXCEPTION_INVALID_REFRESH_TOKEN = '無效RefreshToken';
export const EXCEPTION_CPTOKEN_EXPIRED = '此CPToken已經逾時';

// --- Local (TaiSEIA over CZ-T006/T007 UPnP SetSaanet) communication ---
// The Panasonic WiFi module answers the same SAANET registers locally over
// HTTP/SOAP on this TCP port; the cloud is just a relay to the same module,
// so status/command values are identical whether read locally or via cloud.
export const LOCAL_PORT = 57223;
export const LOCAL_CONTROL_PATH = '/SmartHome/Control';
export const LOCAL_DEVICE_XML_PATH = '/device.xml';
export const LOCAL_SOAP_SERVICE = 'urn:schemas-upnp-org:service:SwitchPower:1';

// SSDP discovery (multicast M-SEARCH).
export const LOCAL_SSDP_ADDRESS = '239.255.255.250';
export const LOCAL_SSDP_PORT = 1900;
export const LOCAL_SSDP_SEARCH_TARGETS = [
  'urn:schemas-upnp-org:service:SwitchPower:1',
  'urn:schemas-upnp-org:device:airconditonDevice:1',
];
// Only SSDP responses mentioning one of these markers are treated as a module.
export const LOCAL_SSDP_MARKERS = ['switchpower', '57223', 'airconditon', 'panasonic'];
export const LOCAL_SSDP_TIMEOUT = 3000;

// Timeouts (ms) for the local HTTP requests and the subnet port scan.
export const LOCAL_REQUEST_TIMEOUT = 5000;
export const LOCAL_PORT_SCAN_TIMEOUT = 500;
export const LOCAL_PORT_SCAN_CONCURRENCY = 64;
// Cap the subnet scan so an unusually wide netmask can't enumerate a whole /16.
export const LOCAL_MAX_SCAN_HOSTS = 1024;
// LAN IPs can change (DHCP); periodically re-map GWID (MAC) -> host.
export const LOCAL_REDISCOVER_INTERVAL = 30 * 60 * 1000;
// Shortest gap between the on-demand rediscoveries triggered by a local
// failure, so a run of failures can't spam the network with scans.
export const LOCAL_REDISCOVER_COOLDOWN = 60 * 1000;

// TaiSEIA PDU register/service ids used locally.
export const TAISEIA_TYPE_REGISTER = 0x00;
export const TAISEIA_REG_ALL_STATES = 0x08;
// An unavailable service is echoed back with this service id in the response.
export const TAISEIA_UNSUPPORTED_SERVICE = 0x7f;
