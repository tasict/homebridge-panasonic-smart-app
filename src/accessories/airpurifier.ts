import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import { findCommandByName, isEnum, isReading, normalizeCommandType } from './command-helpers';
import { PanasonicAccessoryContext, SmartAppDeviceInfo } from '../types';

// Codes used when the model's CommandList doesn't name the feature. Current
// Taiwanese purifiers (e.g. the F-P series) describe theirs as 0x01 風量,
// 0x07 nanoeX and 0x50 PM2.5, and are resolved by name instead.
enum LegacyCommandType {
  FanMode = '0x0E',
  Nanoe = '0x0D',
  PM25 = '0x53',
}

// PM2.5 (µg/m³) upper bounds for Excellent, Good, Fair and Inferior; above is Poor.
const AIR_QUALITY_LIMITS = [35, 53, 70, 150];

/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class AirPurifierAccessory extends BaseAccessory {

  private readonly nanoeCommandType: string;
  private readonly pm25CommandType: string;

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

    // Resolve the model's codes from its CommandList by name.
    const commands = this.platform.smartApp.getCommands(accessory.context.device);
    const fan = findCommandByName(commands, /風量|風速/, isEnum);
    const nanoe = findCommandByName(commands, /nanoe/i, isEnum);
    const pm25 = findCommandByName(commands, /PM\s*2\.?5/i,
      (command) => isReading(command) && !/level/i.test(command.CommandName));

    this.useFanCommand(fan ? [fan.CommandType] : [], LegacyCommandType.FanMode);
    this.nanoeCommandType = normalizeCommandType(nanoe?.CommandType ?? LegacyCommandType.Nanoe);
    this.pm25CommandType = normalizeCommandType(pm25?.CommandType ?? LegacyCommandType.PM25);

    this.services['AirPurifier'] = this.accessory.getService(this.platform.Service.AirPurifier)
      || this.accessory.addService(this.platform.Service.AirPurifier);


    // This is what is displayed as the default name on the Home app
    this.services['AirPurifier'].setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device?.NickName || '空氣清淨機',
    );

    this.services['AirPurifier']
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.services['AirPurifier']
      .getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .setProps({ validValues: [
        this.platform.Characteristic.CurrentAirPurifierState.INACTIVE,
        this.platform.Characteristic.CurrentAirPurifierState.IDLE,
        this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR,
      ],
      })
      .onGet(this.getAirPurifierState.bind(this));

    // Auto / Manual in the Home app is the purifier's automatic fan speed.
    this.services['AirPurifier']
      .getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onSet(this.setTargetAirPurifierState.bind(this))
      .onGet(this.getTargetAirPurifierState.bind(this));

    this.services['AirPurifier']
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onSet(this.setPurifierRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    //////////
    // The nanoe switch is keyed by its command type: drop the one a previous
    // version created under the legacy code if this model uses another.
    this.removeStaleSwitch(LegacyCommandType.Nanoe, this.nanoeCommandType);
    this.setupToggleSwitch('NanoeSwitch', this.nanoeCommandType, 'NanoE');

    //////////
    this.services['AirQualitySensor'] = this.accessory.getService(
      this.platform.Service.AirQualitySensor)
    || this.accessory.addService(this.platform.Service.AirQualitySensor);

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.getCurrentAirQuality.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.PM2_5Density)
      .onGet(this.getCurrentPM2_5Density.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.StatusActive)
      .onGet(() => this.getDeviceInfoNumber(BaseAccessory.PowerCommandType) === 1);


    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [
      BaseAccessory.PowerCommandType,
      this.fanCommandType,
      this.nanoeCommandType,
      this.pm25CommandType,
    ];
  }

  protected get primaryService(): Service {
    return this.services['AirPurifier'];
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    // Power -> Active is handled by BaseAccessory.

    if (deviceStatus[this.fanCommandType] !== undefined) {
      this.services['AirPurifier'].updateCharacteristic(
        this.platform.Characteristic.TargetAirPurifierState, this.targetAirPurifierState());
      if (!this.isFanAuto()) {
        this.services['AirPurifier'].updateCharacteristic(
          this.platform.Characteristic.RotationSpeed, this.fanPercent());
      }
    }

    if (deviceStatus[BaseAccessory.PowerCommandType] !== undefined) {
      const on = this.getDeviceInfoNumber(BaseAccessory.PowerCommandType) === 1;
      this.services['AirPurifier'].updateCharacteristic(
        this.platform.Characteristic.CurrentAirPurifierState,
        on
          ? this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
          : this.platform.Characteristic.CurrentAirPurifierState.INACTIVE);
      this.services['AirQualitySensor'].updateCharacteristic(
        this.platform.Characteristic.StatusActive, on);
    }

    if(deviceStatus[this.nanoeCommandType] !== undefined) {
      this.services['NanoeSwitch'].updateCharacteristic(
        this.platform.Characteristic.On,
        this.getDeviceInfoNumber(this.nanoeCommandType) === 1);
    }

    if (deviceStatus[this.pm25CommandType] !== undefined) {
      const pm25 = this.getDeviceInfoNumber(this.pm25CommandType);
      this.services['AirQualitySensor'].updateCharacteristic(
        this.platform.Characteristic.PM2_5Density, Math.max(0, Math.min(1000, pm25)));
      this.services['AirQualitySensor'].updateCharacteristic(
        this.platform.Characteristic.AirQuality, this.airQualityFor(pm25));
    }
  }

  private removeStaleSwitch(legacySubtype: string, currentSubtype: string) {
    if (legacySubtype === currentSubtype) {
      return;
    }
    const stale = this.accessory.getServiceById(this.platform.Service.Switch, legacySubtype);
    if (stale) {
      this.accessory.removeService(stale);
    }
  }

  private targetAirPurifierState(): number {
    return this.isFanAuto()
      ? this.platform.Characteristic.TargetAirPurifierState.AUTO
      : this.platform.Characteristic.TargetAirPurifierState.MANUAL;
  }

  async getTargetAirPurifierState(): Promise<CharacteristicValue> {
    return this.targetAirPurifierState();
  }

  async setTargetAirPurifierState(value: CharacteristicValue) {
    this.platform.log.debug(
      `Accessory: setTargetAirPurifierState() for device '${this.accessory.displayName}'`);

    if (value === this.platform.Characteristic.TargetAirPurifierState.AUTO) {
      if (this.fanLevels.auto !== undefined) {
        this.sendFanPercent(0);
      }
      return;
    }

    // Manual: keep the speed shown in the Home app, or pick the middle one.
    if (this.isFanAuto()) {
      const shown = +(this.services['AirPurifier']
        .getCharacteristic(this.platform.Characteristic.RotationSpeed).value ?? 0);
      const percent = this.sendFanPercent(shown > 0 ? shown : 50);
      this.services['AirPurifier'].updateCharacteristic(
        this.platform.Characteristic.RotationSpeed, percent);
    }
  }

  async setPurifierRotationSpeed(value: CharacteristicValue) {
    // HomeKit sends 0 together with Active = off; the power command handles that.
    if (+value <= 0) {
      return;
    }
    await this.setRotationSpeed(value);
    this.services['AirPurifier'].updateCharacteristic(
      this.platform.Characteristic.TargetAirPurifierState,
      this.platform.Characteristic.TargetAirPurifierState.MANUAL);
  }

  async getAirPurifierState():Promise<CharacteristicValue> {

    const power:number = this.getDeviceInfoNumber(BaseAccessory.PowerCommandType);

    if(power === 0){
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }


    return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;

  }

  private airQualityFor(pm25: number): number {
    const index = AIR_QUALITY_LIMITS.findIndex((limit) => pm25 <= limit);
    return index < 0 ? AIR_QUALITY_LIMITS.length + 1 : index + 1;
  }

  async getCurrentAirQuality():Promise<CharacteristicValue> {
    return this.airQualityFor(this.getDeviceInfoNumber(this.pm25CommandType));
  }

  async getCurrentPM2_5Density():Promise<CharacteristicValue>{
    return Math.max(0, Math.min(1000, this.getDeviceInfoNumber(this.pm25CommandType) || 0));
  }

}
