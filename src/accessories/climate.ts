import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import { PanasonicAccessoryContext, SmartAppDeviceInfo } from '../types';

enum ClimateCommandType {
  Power = '0x00',
  Mode = '0x01',
  CurrentTemperature = '0x04',
  TargetTemperature = '0x03',
  FanSpeed = '0x02',
  FanPositionHorizontal = '0x0F',
  OutdoorTemperature = '0x21',
  OnTimer = '0x0B',
  OffTimer = '0x0C',
  NanoeX = '0x08',
  Econavi = '0x1B',
  Buzzer = '0x1E',
  TurboMode = '0x1A',
  SelfClean = '0x18',
  SleepMode = '0x05',
  MoldPrevention = '0x17',
  FanPositionVertical = '0x11',
  MotionDetection = '0x19',
  IndicatorLight = '0x1F',
  PM25 = '0x37',
}

enum ClimateMode {
  Off = -1,
  Cool = 0,
  Dry = 1,
  FanOnly = 2,
  Auto = 3,
  Heat = 4,
}


/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class ClimateAccessory extends BaseAccessory {

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

    this.services['Climate'] = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);


    // This is what is displayed as the default name on the Home app
    this.services['Climate'].setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device?.NickName || '空調',
    );

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
        minStep: 0.01,
      });

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    // Cooling Threshold Temperature (optional)
    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: 16,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(this.setCoolingThresholdTemperature.bind(this));

    // Heating Threshold Temperature (optional)
    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: 16,
        maxValue: 30,
        minStep: 0.5,
      })
      .onSet(this.setHeatingThresholdTemperature.bind(this));


    //////////
    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [
      ClimateCommandType.Power,
      ClimateCommandType.Mode,
      ClimateCommandType.Buzzer,
      ClimateCommandType.CurrentTemperature,
      ClimateCommandType.TargetTemperature,
    ];
  }

  protected get primaryService(): Service {
    return this.services['Climate'];
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    // Power -> Active is handled by BaseAccessory.

    if (deviceStatus[ClimateCommandType.CurrentTemperature] !== undefined) {
      this.services['Climate'].updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.getDeviceInfoNumber(ClimateCommandType.CurrentTemperature));
    }
  }

  async getCurrentHeaterCoolerState():Promise<CharacteristicValue> {

    // When the unit is off (or status hasn't been fetched yet) report INACTIVE,
    // otherwise an empty cache (mode defaults to 0) would be misread as Cool.
    if (this.getDeviceInfoNumber(ClimateCommandType.Power) === 0) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    const currentTemperature = this.getDeviceInfoNumber(ClimateCommandType.CurrentTemperature);
    const setTemperature = this.getDeviceInfoNumber(ClimateCommandType.TargetTemperature);
    const currentMode = this.getDeviceInfoNumber(ClimateCommandType.Mode);


    switch (currentMode) {
      // Auto
      case ClimateMode.Auto:
        // Set target state and current state (based on current temperature)
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );

        if (currentTemperature < setTemperature) {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
        } else if (currentTemperature > setTemperature) {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
        } else {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        }
        break;

      // Heat
      case ClimateMode.Heat:
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
        );

        if (currentTemperature < setTemperature) {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
        } else {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        }
        break;

      // Cool
      case ClimateMode.Cool:
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.COOL,
        );

        if (currentTemperature > setTemperature) {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
        } else {
          this.services['Climate']
            .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        }
        break;

      // Dry (Dehumidifier)
      case ClimateMode.Dry:
        this.services['Climate']
          .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,

          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );
        break;

      // Fan
      case ClimateMode.FanOnly:
        this.services['Climate']
          .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,

          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );
        break;

      default:
        this.platform.log.error(
          `Unknown TargetHeaterCoolerState state: '${this.accessory.displayName}' `
          + `'${currentMode}'`);
        break;
    }
    return this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value
      ?? this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;

  }

  async setCoolingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(
      'Accessory: setCoolingThresholdTemperature() for device '
      + `'${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.TargetTemperature, threshold.toString());

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .updateValue(value);
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(
      `Accessory: setHeatingThresholdTemperature() for device '${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.TargetTemperature, threshold.toString());

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .updateValue(value);
  }

  async setTargetHeaterCoolerState(value: CharacteristicValue) {

    this.platform.log.debug(
      `Accessory: setTargetHeaterCoolerState() for device '${this.accessory.displayName}'`);

    let mode = ClimateMode.Auto;

    switch (value) {
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        mode = ClimateMode.Auto;
        break;

      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        mode = ClimateMode.Cool;
        break;

      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        mode = ClimateMode.Heat;
        break;

      default:
        this.platform.log.error('Unknown TargetHeaterCoolerState', value );
        return;
    }


    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.Mode, mode.toString());

    this.services['Climate'].getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .updateValue(value);
  }

}
