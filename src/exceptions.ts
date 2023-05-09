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

export class PanasonicTokenExpired extends PanasonicBaseException {
  constructor() {
    super('Token expired');
    this.name = 'PanasonicTokenExpired';
  }
}

export class PanasonicInvalidRefreshToken extends PanasonicBaseException {
  constructor() {
    super('Refresh token expired');
    this.name = 'PanasonicInvalidRefreshToken';
  }
}


export class PanasonicLoginFailed extends PanasonicBaseException {
  constructor() {
    super('Any other login exception');
    this.name = 'PanasonicLoginFailed';
  }
}


export class PanasonicDeviceOffline extends PanasonicBaseException {
  constructor(message: string) {
    super(message);
    this.name = 'PanasonicDeviceOffline';
  }
}

export class PanasonicExceedRateLimit extends PanasonicBaseException {
  constructor() {
    super('Reached API rate limit. Please try again later.');
    this.name = 'PanasonicExceedRateLimit';
  }
}
