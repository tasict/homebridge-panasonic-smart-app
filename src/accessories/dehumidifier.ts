import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import {
  PanasonicAccessoryContext, SmartAppCommand, SmartAppParameter, SmartAppDeviceInfo,
} from '../types';

/*
DEVICE_STATUS_CODES = {
    DEVICE_TYPE_AC: [
        '0x00',  # AC power status
        '0x01',  # AC operation mode
        '0x04',  # AC current termperature
        '0x03',  # AC target temperature
        '0x02',  # AC fan level
        '0x0F',  # AC fan position (horizontal)
        '0x21',  # AC outdoor temperature
        '0x0B',  # AC on timer
        '0x0C',  # AC off timer
        '0x08',  # AC nanoeX
        '0x1B',  # AC ECONAVI
        '0x1E',  # AC buzzer
        '0x1A',  # AC turbo mode
        '0x18',  # AC self clean
        '0x05',  # AC sleep mode
        '0x17',  # AC mold prevention
        '0x11',  # AC fan position (vertical)
        '0x19',  # AC motion detection
        '0x1F',  # AC indicator light
        '0x37',  # AC PM2.5
    ],
    DEVICE_TYPE_DEHUMIDIFIER: [
        '0x00',  # Dehumidifier power status
        '0x01',  # Dehumidifier operation mode
        '0x02',  # Dehumidifier off timer
        '0x07',  # Dehumidifier humidity sensor
        '0x09',  # Dehumidifier fan direction
        '0x0D',  # Dehumidifier nanoe
        '0x50',
        '0x18',  # Dehumidifier buzzer
        '0x53',  # Dehumidifier PM2.5
        '0x55',  # Dehumidifier on timer
        '0x0A',  # Dehumidifier tank status
        '0x04',  # Dehumidifier target humidity
        '0x0E',  # Dehumidifier fan mode
    ],
    DEVICE_TYPE_WASHING_MACHINE: [
        '0x13', # Washing machine remaining washing time
        '0x14', # Washing machine timer
        '0x15', # Washing machine remaining time to trigger timer
        '0x50', # Washing machine status
        '0x54', # Washing machine current mode
        '0x55', # Washing machine current cycle
        '0x61', # Washing machine dryer delay
        '0x64', # Washing machine cycle
    ],
}
*/

enum DehumidifierCommandType {
  Power = '0x00',
  Mode = '0x01',
  OffTimer = '0x02',
  Humidity = '0x07',
  FanDirection = '0x09',
  Nanoe = '0x0D',
  Unknown1 = '0x50',
  Buzzer = '0x18',
  PM25 = '0x53',
  OnTimer = '0x55',
  TankStatus = '0x0A',
  TargetHumidity = '0x04',
  FanMode = '0x0E',
}

/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class DehumidifierAccessory extends BaseAccessory {

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

    this.services['HumidifierDehumidifier']
      = this.accessory.getService(this.platform.Service.HumidifierDehumidifier)
      || this.accessory.addService(this.platform.Service.HumidifierDehumidifier);


    // This is what is displayed as the default name on the Home app
    this.services['HumidifierDehumidifier'].setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device?.NickName || '除濕機',
    );

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER,
        ],
      });

    this.services['HumidifierDehumidifier']
      .setCharacteristic(
        this.platform.Characteristic.TargetHumidifierDehumidifierState,
        this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER);


    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .setProps({ validValues: [
        this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
        this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING,
        this.platform.Characteristic.CurrentHumidifierDehumidifierState.IDLE,
      ],
      })
      .onGet(this.getHumidifierDehumidifierState.bind(this));

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .setProps({
        minValue: 40,
        maxValue: 70,
        minStep: 1,
      })
      .onSet(this.setRelativeHumidityDehumidifierThreshold.bind(this))
      .onGet(this.getRelativeHumidityDehumidifierThreshold.bind(this));

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 25,
      })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));


    //////////
    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.WaterLevel)
      .onGet(this.getWaterLevel.bind(this));

    //////////
    // Inverted on purpose: the device treats '0' as buzzer-on and '1' as muted.
    this.setupToggleSwitch(
      'BuzzerSwitch', DehumidifierCommandType.Buzzer, '操作提示音', '0', '1');

    //////////
    this.setupToggleSwitch('NanoeSwitch', DehumidifierCommandType.Nanoe, 'NanoE');

    //////////
    const smartAppCommand:SmartAppCommand | undefined
      = this.platform.smartApp.getCommandList(
        this.accessory.context.device, DehumidifierCommandType.Mode);

    if(smartAppCommand !== undefined){

      smartAppCommand.Parameters.forEach((param:SmartAppParameter) => {

        const name:string = param[0] as string;
        const subtype:string = 'Mode_' + param[1];

        this.platform.log.debug(`Accessory: Mode Switch for device '${name}'`);

        const serviceSwitch = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
          || this.accessory.addService(this.platform.Service.Switch, name, subtype);

        serviceSwitch.setCharacteristic(this.platform.Characteristic.Name, name);
        serviceSwitch.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        serviceSwitch.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);

        serviceSwitch.getCharacteristic(this.platform.Characteristic.On)
          .onSet((value: CharacteristicValue) => {

            this.platform.log.info(
              `Setting ${this.accessory.displayName} ${name} to ${value ? 'on' : 'off'}`);

            if(value){
              this.sendCommandToDevice(
                this.accessory.context.device, DehumidifierCommandType.Mode, param[1] as string);
              this.updateSwitchMode(+param[1]);
            } else {
              // A mode can only be switched, not turned off: snap the
              // switches back to the current mode instead of pretending
              // the toggled-off mode became active.
              this.updateSwitchMode(this.getDeviceInfoNumber(DehumidifierCommandType.Mode));
            }
          })
          .onGet(() => {
            const mode:number = this.getDeviceInfoNumber(DehumidifierCommandType.Mode);
            this.platform.log.debug(
              `Getting ${this.accessory.displayName} ${name} `
              + `status: '${+param[1] === mode ? 'on' : 'off'}'`);
            return mode === +param[1];
          });

        this.services[subtype] = serviceSwitch;

      });


    }

    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [
      DehumidifierCommandType.Power,
      DehumidifierCommandType.Mode,
      DehumidifierCommandType.FanMode,
      DehumidifierCommandType.Buzzer,
      DehumidifierCommandType.Nanoe,
      DehumidifierCommandType.TargetHumidity,
      DehumidifierCommandType.Humidity,
      DehumidifierCommandType.TankStatus,
    ];
  }

  protected get primaryService(): Service {
    return this.services['HumidifierDehumidifier'];
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    // Power -> Active is handled by BaseAccessory.

    if (deviceStatus[DehumidifierCommandType.TargetHumidity] !== undefined) {
      this.services['HumidifierDehumidifier'].updateCharacteristic(
        this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
        this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5 + 40);
    }

    if (deviceStatus[DehumidifierCommandType.Humidity] !== undefined) {
      this.services['HumidifierDehumidifier'].updateCharacteristic(
        this.platform.Characteristic.CurrentRelativeHumidity,
        this.getDeviceInfoNumber(DehumidifierCommandType.Humidity));
    }

    if(deviceStatus[DehumidifierCommandType.FanMode] !== undefined) {
      this.services['HumidifierDehumidifier'].updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        this.fanSpeedModeToPercent(this.getDeviceInfoNumber(DehumidifierCommandType.FanMode)));
    }


    if (deviceStatus[DehumidifierCommandType.TankStatus] !== undefined) {
      this.services['HumidifierDehumidifier'].updateCharacteristic(
        this.platform.Characteristic.WaterLevel,
        this.getDeviceInfoNumber(DehumidifierCommandType.TankStatus) === 1 ? 100 : 0);
    }

    if(deviceStatus[DehumidifierCommandType.Buzzer] !== undefined) {
      this.services['BuzzerSwitch'].updateCharacteristic(
        this.platform.Characteristic.On,
        this.getDeviceInfoNumber(DehumidifierCommandType.Buzzer) === 0);
    }

    if(deviceStatus[DehumidifierCommandType.Nanoe] !== undefined) {
      this.services['NanoeSwitch'].updateCharacteristic(
        this.platform.Characteristic.On,
        this.getDeviceInfoNumber(DehumidifierCommandType.Nanoe) === 1);
    }

    this.updateSwitchMode(this.getDeviceInfoNumber(DehumidifierCommandType.Mode));
  }

  updateSwitchMode(mode: number) {

    const smartAppCommand:SmartAppCommand | undefined
      = this.platform.smartApp.getCommandList(
        this.accessory.context.device, DehumidifierCommandType.Mode);

    if(smartAppCommand !== undefined){

      smartAppCommand.Parameters.forEach((param:SmartAppParameter) => {

        const subtype:string = 'Mode_' + param[1];
        this.services[subtype]?.updateCharacteristic(
          this.platform.Characteristic.On, mode === +param[1]);
      });

    }
  }

  async getHumidifierDehumidifierState():Promise<CharacteristicValue> {

    const power:number = this.getDeviceInfoNumber(DehumidifierCommandType.Power);
    const humidity:number = this.getDeviceInfoNumber(DehumidifierCommandType.Humidity);
    const targetHumidity:number
      = (this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5) + 40;

    if(power === 0){
      return this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }


    return humidity > targetHumidity
      ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
      : this.platform.Characteristic.CurrentHumidifierDehumidifierState.IDLE;

  }

  async setRelativeHumidityDehumidifierThreshold(value: CharacteristicValue) {

    this.platform.log.debug(
      'Accessory: setRelativeHumidityDehumidifierThreshold() '
      + `for device '${this.accessory.displayName}' '${value}' `);

    const threshold:number = (Math.round(Math.min(Math.max(+value, 40), 70) / 5) * 5) - 40;

    this.sendCommandToDevice(
      this.accessory.context.device, DehumidifierCommandType.TargetHumidity, threshold.toString());

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .updateValue(value);
  }

  async getRelativeHumidityDehumidifierThreshold():Promise<CharacteristicValue> {

    const value:number
      = Math.round((this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5)) + 40;

    this.platform.log.debug(
      'Accessory: getRelativeHumidityDehumidifierThreshold() '
      + `for device '${this.accessory.displayName}' - '${value}'`);


    return value;

  }

  async getWaterLevel():Promise<CharacteristicValue> {

    const value:number = this.getDeviceInfoNumber(DehumidifierCommandType.TankStatus);

    return value === 1 ? 100 : 0;
  }

}
