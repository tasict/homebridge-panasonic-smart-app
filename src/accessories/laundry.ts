import { Service, PlatformAccessory } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import { isEnum, normalizeCommandType } from './command-helpers';
import SmartAppApi from '../smart-app';
import { PanasonicAccessoryContext, SmartAppDevice, SmartAppDeviceInfo } from '../types';

// Status names in a washer's or dryer's operating-status enum, e.g. on the
// NA-V150RPH: 0x50 運轉情報 = 不顯示 0, 待機中 1, 動作中 2, 預約中 3/4, 終了 5, 遠隔待機 6.
const FINISHED_NAME = /終了|完了|完成|結束/;
const RUNNING_NAME = /(動作|運轉|運行|作動|洗衣|洗濯|乾燥|烘乾|烘衣)中/;
// Where the status usually is: 0x50 on current models, 0x03 / 0x01 on older ones.
const PREFERRED_CODES = ['0x50', '0x03', '0x01'];

export interface LaundryStatus {
  commandType: string;
  finished: Set<string>;
  running: Set<string>;
}

/**
 * Finds the washer's or dryer's operating-status command in its CommandList:
 * an enum with a "finished" value. Undefined when the model has none, in which
 * case the device isn't exposed (its sensors could never change).
 */
export function resolveLaundryStatus(
  smartApp: SmartAppApi, device: SmartAppDevice): LaundryStatus | undefined {
  const candidates = smartApp.getCommands(device)
    .filter((command) => isEnum(command)
      && command.Parameters.some((param) => FINISHED_NAME.test(String(param[0]))));
  const preferred = (code: string) => {
    const index = PREFERRED_CODES.indexOf(normalizeCommandType(code).toLowerCase());
    return index < 0 ? PREFERRED_CODES.length : index;
  };
  candidates.sort((a, b) => preferred(a.CommandType) - preferred(b.CommandType));

  const command = candidates[0];
  if (command === undefined) {
    return undefined;
  }
  const valuesNamed = (name: RegExp) => new Set(command.Parameters
    .filter((param) => name.test(String(param[0])))
    .map((param) => String(param[1])));
  return {
    commandType: normalizeCommandType(command.CommandType),
    finished: valuesNamed(FINISHED_NAME),
    running: valuesNamed(RUNNING_NAME),
  };
}

/**
 * A washing machine or dryer, as notifications only. Panasonic's washers and
 * dryers accept remote commands only after Wi-Fi control is enabled on the
 * machine itself, for safety, so the plugin never sends them any: it shows
 * when a cycle is done and while one is running.
 *
 * - "Done" is a contact sensor that opens when the cycle finishes and closes
 *   again once the machine leaves that state (lid opened, powered off or a
 *   new cycle). The Home app can notify when it opens.
 * - "Running" is an occupancy sensor, for automations.
 */
export default class LaundryAccessory extends BaseAccessory {

  private readonly status: LaundryStatus | undefined;

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
    private readonly isDryer: boolean,
  ) {
    super(platform, accessory);

    const device = accessory.context.device;
    this.status = resolveLaundryStatus(this.platform.smartApp, device);
    const nickName = device?.NickName || (isDryer ? '乾衣機' : '洗衣機');

    const doneName = `${nickName} ${isDryer ? '烘衣完成' : '洗衣完成'}`;
    const { ContactSensor, OccupancySensor } = this.platform.Service;
    this.services['Done'] = this.accessory.getServiceById(ContactSensor, 'Done')
      || this.accessory.addService(ContactSensor, doneName, 'Done');
    this.services['Done'].setCharacteristic(this.platform.Characteristic.Name, doneName);
    this.services['Done'].getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => this.contactState());

    const runningName = `${nickName} ${isDryer ? '烘衣中' : '洗衣中'}`;
    this.services['Running'] = this.accessory.getServiceById(OccupancySensor, 'Running')
      || this.accessory.addService(OccupancySensor, runningName, 'Running');
    this.services['Running'].setCharacteristic(this.platform.Characteristic.Name, runningName);
    this.services['Running'].getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(() => this.occupancyState());

    for (const service of [this.services['Done'], this.services['Running']]) {
      service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
      service.setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        service.getCharacteristic(this.platform.Characteristic.Name).value as string);
    }

    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return this.status ? [this.status.commandType] : [];
  }

  protected get primaryService(): Service {
    return this.services['Done'];
  }

  // Sensors have no Active characteristic: they show their own state.
  protected get reflectsPowerOnPrimaryService(): boolean {
    return false;
  }

  protected showNotResponding(error: Error) {
    this.services['Done'].updateCharacteristic(
      this.platform.Characteristic.ContactSensorState, error);
    this.services['Running'].updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected, error);
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    if (this.status === undefined || deviceStatus[this.status.commandType] === undefined) {
      return;
    }
    this.services['Done'].updateCharacteristic(
      this.platform.Characteristic.ContactSensorState, this.contactState());
    this.services['Running'].updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected, this.occupancyState());
  }

  private currentStatus(): string {
    return this.status === undefined ? '' : this.platform.smartApp.getDeviceInfo(
      this.accessory.context.device, this.status.commandType, '');
  }

  private contactState(): number {
    const { ContactSensorState } = this.platform.Characteristic;
    return this.status?.finished.has(this.currentStatus())
      ? ContactSensorState.CONTACT_NOT_DETECTED
      : ContactSensorState.CONTACT_DETECTED;
  }

  private occupancyState(): number {
    const { OccupancyDetected } = this.platform.Characteristic;
    return this.status?.running.has(this.currentStatus())
      ? OccupancyDetected.OCCUPANCY_DETECTED
      : OccupancyDetected.OCCUPANCY_NOT_DETECTED;
  }
}
