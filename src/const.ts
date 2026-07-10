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
