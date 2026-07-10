class PanasonicBaseException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanasonicBaseException';
  }
}

export class PanasonicRefreshTokenNotFound extends PanasonicBaseException {
  constructor(){
    super('Refresh token not existed. You may need to login again.');
    this.name = 'PanasonicRefreshTokenNotFound';
  }
}

/**
 * A request failed because of a global condition (full queue, rate-limit
 * pause, client shutdown) rather than the targeted device. Accessories must
 * not treat these as a device failure (no 'Not Responding', no poll backoff).
 */
export class TransientApiError extends PanasonicBaseException {
  constructor(message: string) {
    super(message);
    this.name = 'TransientApiError';
  }
}
