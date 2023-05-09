import { PlatformConfig } from 'homebridge';

export interface PanasonicPlatformConfig extends PlatformConfig {
  email: string;
  password: string;
  debugMode: boolean;
}

export interface PanasonicAccessoryContext {
  device: SmartAppDevice;
}

export interface SmartAppDeviceList {
  deviceList: SmartAppDevice[];
}

export interface SmartAppDevice {
  GWID: string;
  ModelID: string;
  AreaID: string;
  SeqNo: string;
  Auth: string;
  NickName: string;
  City: string;
  Area: string;
  LatLng: string;
  DeviceType: string;
  ModelType: string;
  Model: string;
  Function: {
    SetSchedule: string;
  };
  Attribute: {
    Year: string;
  };
  Devices: {
    DeviceID: number;
    Name: string;
    IsAvailable: number;
  }[];
}

export interface SmartAppCommandList {
  ModelType: string;
  JSON: {
    DeviceType: number;
    DeviceName: string;
    ModelType: string;
    ProtocalType: string;
    ProtocalVersion: string;
    Timestamp: string;
    list: SmartAppCommand[];
  }[];
}

export interface SmartAppCommand {
  CommandType: string;
  CommandName: string;
  ParameterType: string;
  ParameterUnit: string;
  Parameters: SmartAppParameter[];
}

export interface SmartAppParameter {
  [name: string]: number | string;
}

export interface SmartAppDeviceInfo {
  [CommandType: string]: {
    status: string;
  };
}

