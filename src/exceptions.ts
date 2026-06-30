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
