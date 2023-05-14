export const BASE_URL = 'https://ems2.panasonic.com.tw/api';
export const APP_TOKEN = 'D8CBFF4C-2824-4342-B22D-189166FEF503';
export const USER_AGENT = 'okhttp/4.9.1';

export const SECONDS_BETWEEN_REQUEST = 2;
export const REQUEST_TIMEOUT = 20;
export const COMMANDS_PER_REQUEST = 6;

export const EXCEPTION_COMMAND_NOT_FOUND = '無法透過CommandId取得Commmand';
export const EXCEPTION_DEVICE_OFFLINE = 'deviceOffline';
export const EXCEPTION_DEVICE_NOT_RESPONDING = 'deviceNoResponse';
export const EXCEPTION_TOKEN_EXPIRED = '無法依據您的CPToken,auth取得相關資料';
export const EXCEPTION_INVALID_REFRESH_TOKEN = '無效RefreshToken';
export const EXCEPTION_CPTOKEN_EXPIRED = '此CPToken已經逾時';
export const EXCEPTION_REACH_RATE_LIMIT = '系統檢測您當前超量使用';
