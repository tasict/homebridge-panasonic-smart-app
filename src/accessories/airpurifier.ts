import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import { PanasonicAccessoryContext, SmartAppDeviceInfo } from '../types';

enum AirPurifierCommandType {
  Power = '0x00',
  Mode = '0x01',
  Nanoe = '0x0D',
  PM25 = '0x53',
  FanMode = '0x0E',
}

/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class AirPurifierAccessory extends BaseAccessory {

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

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

    this.services['AirPurifier']
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    //////////
    this.setupToggleSwitch('NanoeSwitch', AirPurifierCommandType.Nanoe, 'NanoE');

    //////////
    this.services['AirQualitySensor'] = this.accessory.getService(
      this.platform.Service.AirQualitySensor)
    || this.accessory.addService(this.platform.Service.AirQualitySensor);

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.getCurrentAirQuality.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.PM2_5Density)
      .onGet(this.getCurrentPM2_5Density.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.StatusActive)
      .onGet(this.getActive.bind(this));



    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [
      AirPurifierCommandType.Power,
      AirPurifierCommandType.Mode,
      AirPurifierCommandType.FanMode,
      AirPurifierCommandType.Nanoe,
      AirPurifierCommandType.PM25,
    ];
  }

  protected get primaryService(): Service {
    return this.services['AirPurifier'];
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    // Power -> Active is handled by BaseAccessory.

    if(deviceStatus[AirPurifierCommandType.FanMode] !== undefined) {
      this.services['AirPurifier'].updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        this.fanSpeedModeToPercent(this.getDeviceInfoNumber(AirPurifierCommandType.FanMode)));
    }

    if(deviceStatus[AirPurifierCommandType.Nanoe] !== undefined) {
      this.services['NanoeSwitch'].updateCharacteristic(
        this.platform.Characteristic.On,
        this.getDeviceInfoNumber(AirPurifierCommandType.Nanoe) === 1);
    }
  }

  async getAirPurifierState():Promise<CharacteristicValue> {

    const power:number = this.getDeviceInfoNumber(AirPurifierCommandType.Power);

    if(power === 0){
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }


    return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;

  }

  async getCurrentAirQuality():Promise<CharacteristicValue> {
    const pm25 = this.getDeviceInfoNumber(AirPurifierCommandType.PM25);
    const pm25Quality = pm25 <= 35 ? 1
      : (pm25 <= 53 ? 2 : (pm25 <= 70 ? 3 : (pm25 <= 150 ? 4 : 5)));

    return pm25Quality;
  }

  async getCurrentPM2_5Density():Promise<CharacteristicValue>{
    return this.getDeviceInfoNumber(AirPurifierCommandType.PM25) || 0;
  }

}
