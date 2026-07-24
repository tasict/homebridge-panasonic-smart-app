import { PlatformConfig } from 'homebridge';

export interface PanasonicPlatformConfig extends PlatformConfig {
  email: string;
  password: string;
  debugMode: boolean;
  // Prefer local (LAN) communication, falling back to the cloud when a device
  // has no local module, a local request fails, or a command is unsupported.
  // Defaults to enabled.
  localControl?: boolean;
  // Whether local discovery may TCP-scan the subnet (in addition to SSDP) to
  // locate modules. Defaults to enabled.
  localScanSubnet?: boolean;
  // Optional manual GWID (MAC) -> LAN IP overrides for when SSDP is blocked
  // (e.g. the module lives on a different VLAN) or DHCP keeps moving a device.
  localDevices?: LocalDeviceOverride[];
}

export interface LocalDeviceOverride {
  // Device GWID as shown by the cloud (equals the module MAC, 12 hex chars).
  gwid: string;
  // LAN IP address (or hostname) of the module.
  host: string;
}

// A local module located on the LAN, matched to a cloud device by GWID/MAC.
export interface LocalDeviceEndpoint {
  host: string;
  mac: string;
  friendlyName: string;
  modelName: string;
  modelNumber: string;
  firmware: string;
}

// device.xml details surfaced on the HomeKit AccessoryInformation service.
export interface LocalDeviceMetadata {
  // device.xml <modelName> - the Wi-Fi module model (e.g. CZ-T006).
  moduleModel: string;
  // device.xml <modelNumber>.
  modelNumber: string;
  // Firmware version parsed from <modelDescription> (SW_VER).
  firmware: string;
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
  [CommandType: string]: string;
}

