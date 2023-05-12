import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, CharacteristicEventTypes } from 'homebridge';
import PanasonicPlatform from '../platform';
import { DEVICE_STATUS_REFRESH_INTERVAL } from '../settings';
import { PanasonicAccessoryContext, SmartAppCommand, SmartAppParameter } from '../types';

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

enum ClimateFanSpeedMode {
  Auto = 0,
  Fast = 1,
  Normal = 2,
  Silent = 3,
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
export default class ClimateAccessory {
  private services: Service[] = [];
  private _refreshInterval: NodeJS.Timer | undefined;


  constructor(
    private readonly platform: PanasonicPlatform,
    private readonly accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {


    // Accessory Information
    // https://developers.homebridge.io/#/service/AccessoryInformation
    this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Panasonic TW',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        accessory.context.device?.Model || 'Unknown',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.context.device?.GWID || 'Unknown',
      );

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
    this.refreshDeviceStatus();
  }

  /**
   * Retrieves the device status from Smart App and updates its characteristics.
   */
  async refreshDeviceStatus() {
    this.platform.log.debug(`Accessory: Refresh status for device '${this.accessory.displayName}'`);

    try {
      const deviceStatus = await this.platform.smartApp.fetchDeviceInfo(
        this.accessory.context.device, 
        [
         ClimateCommandType.Power, 
         ClimateCommandType.Mode,
         ClimateCommandType.Buzzer,
         ClimateCommandType.CurrentTemperature,
         ClimateCommandType.TargetTemperature,
        ]
      );


      if(deviceStatus === undefined) {
  
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.Active,
          new Error('Exception occurred in refreshDeviceStatus()'),
        );
        
        return;
      }

      this.platform.log.debug(JSON.stringify(deviceStatus));

      // Power
      if (deviceStatus[ClimateCommandType.Power] !== undefined) {
        const active = deviceStatus[ClimateCommandType.Power].status === '1'
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
        this.services['Climate'].updateCharacteristic(this.platform.Characteristic.Active, active);
      }


      if (deviceStatus[ClimateCommandType.CurrentTemperature] !== undefined) {
        this.services['Climate'].updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getDeviceInfoNumber(ClimateCommandType.CurrentTemperature));
      }


      ///



    } catch (error) {
      this.platform.log.error('An error occurred while refreshing the device status. Turn on debug mode for more information.');

      // Only log if a Promise rejection reason was provided.
      // Some errors are already logged at source.
      if (error) {
        this.platform.log.debug(error);
      }

      /**
       * We should be able to pass an error object to the function to mark a service/accessory
       * as 'Not Responding' in the Home App.
       * (Only needs to be set on a single/primary characteristic of an accessory,
       * and needs to be updated with a valid value when the accessory is available again.
       * The error message text is for internal use only, and is not passed to the Home App.)
       *
       * Problem: The Typescript definitions suggest this is not permitted -  commenting for now.
       */
      /*
      this.service.updateCharacteristic(
        this.platform.Characteristic.Active,
        new Error('Exception occurred in refreshDeviceStatus()'),
      );
      */
    }

    // Schedule continuous device updates on the first run
    if (!this._refreshInterval) {
      this._refreshInterval = setInterval(
        this.refreshDeviceStatus.bind(this),
        DEVICE_STATUS_REFRESH_INTERVAL,
      );
    }
  }

  private getDeviceInfoNumber(commandType:string, defaultValue:number|undefined = 0):number {
    try{

      const value:number = +this.platform.smartApp.getDeviceInfo(this.accessory.context.device, commandType, defaultValue.toString());
      const CommandName = this.platform.smartApp.getCommandName(this.accessory.context.device, commandType);
      
      this.platform.log.debug(`getDeviceInfoNumber('${commandType}':'${CommandName}'): `+value);

      return value;

    }catch(err){
      this.platform.log.debug(`getDeviceInfoNumber('${commandType}' Error: ${err}`);
    }

    return defaultValue;
  }

  async setActive(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setActive() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.Power, value === this.platform.Characteristic.Active.ACTIVE ? '1' : '0');

    this.services['Climate'].updateCharacteristic(this.platform.Characteristic.Active, value);  
  }

  async getActive():Promise<CharacteristicValue> { 
      
      const value:number = this.getDeviceInfoNumber(ClimateCommandType.Power);
      return value === 1 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getCurrentHeaterCoolerState():Promise<CharacteristicValue> {

    const currentTemperature = this.getDeviceInfoNumber(ClimateCommandType.CurrentTemperature);
    const setTemperature = this.getDeviceInfoNumber(ClimateCommandType.TargetTemperature);
    const currentMode = this.getDeviceInfoNumber(ClimateCommandType.Mode);


    switch (currentMode) 

    {
      // Auto
      case ClimateMode.Auto:
        // Set target state and current state (based on current temperature)
        this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,
          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );

        if (currentTemperature < setTemperature) {
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
        } else if (currentTemperature > setTemperature) {
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
        } else {
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
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
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
        } else {
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
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
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
        } else {
          this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
            .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
        }
        break;

      // Dry (Dehumidifier)
      case ClimateMode.Dry:
        this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
          this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,

          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );
        break;

      // Fan
      case ClimateMode.FanOnly:
        this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
          .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
          this.services['Climate'].updateCharacteristic(
          this.platform.Characteristic.TargetHeaterCoolerState,

          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        );
        break;

      default:
        this.platform.log.error(
          `Unknown TargetHeaterCoolerState state: '${this.accessory.displayName}' '${currentMode}'`);
        break;
    }
    return this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value ;
  
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setCoolingThresholdTemperature() for device '${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.TargetTemperature, threshold.toString());

    this.services['Climate'].getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .updateValue(value);
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setHeatingThresholdTemperature() for device '${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.sendCommandToDevice(
      this.accessory.context.device, ClimateCommandType.TargetTemperature, threshold.toString());

    this.services['Climate'].getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .updateValue(value);
  }

  async setTargetHeaterCoolerState(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setTargetHeaterCoolerState() for device '${this.accessory.displayName}'`);

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


  async sendCommandToDevice(device: any, command: string, value: string) {
    try {
      // Only send non-empty payloads to prevent a '500 Internal Server Error'
      this.platform.log.debug(`Sending command '${command}' with value '${value}' to device '${this.accessory.displayName}'`);

      this.platform.smartApp.doCommand(device, command, value);

    } catch (error) {
      this.platform.log.error('An error occurred while sending a device update. '
        + 'Turn on debug mode for more information.');

      // Only log if a Promise rejection reason was provided.
      // Some errors are already logged at source.
      if (error) {
        this.platform.log.debug(error);
      }
    }
  }


}
