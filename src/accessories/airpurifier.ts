import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, CharacteristicEventTypes } from 'homebridge';
import PanasonicPlatform from '../platform';
import { DEVICE_STATUS_REFRESH_INTERVAL } from '../settings';
import { PanasonicAccessoryContext, SmartAppCommand, SmartAppParameter } from '../types';

enum AirPurifierCommandType {
  Power = '0x00',
  Mode = '0x01',
  Nanoe = '0x0D',
  PM25 = '0x53',
  FanMode = '0x0E',
}


enum AirPurifierFanSpeedMode {
  Auto = 0,
  Fast = 1,
  Normal = 2,
  Silent = 3
}

/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class AirPurifierAccessory {
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
        ]
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
    const buttonNanoName = this.platform.smartApp.getCommandName(this.accessory.context.device, AirPurifierCommandType.Nanoe, 'NanoE');

    this.services['NanoeSwitch'] = this.accessory.getServiceByUUIDAndSubType(this.platform.Service.Switch, AirPurifierCommandType.Nanoe) || this.accessory.addService(this.platform.Service.Switch,  buttonNanoName, AirPurifierCommandType.Nanoe);
    
    this.services['NanoeSwitch'].setCharacteristic(this.platform.Characteristic.Name, buttonNanoName);
    this.services['NanoeSwitch'].getCharacteristic(this.platform.Characteristic.On)
    .onSet(this.setNanoe.bind(this))
    .onGet(this.getNanoe.bind(this));
    
    this.services['NanoeSwitch'].addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    this.services['NanoeSwitch'].setCharacteristic(this.platform.Characteristic.ConfiguredName, buttonNanoName);

    //////////
    this.services['AirQualitySensor'] = this.accessory.getService(this.platform.Service.AirQualitySensor)
    || this.accessory.addService(this.platform.Service.AirQualitySensor);

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.getCurrentAirQuality.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.PM2_5Density)
      .onGet(this.getCurrentPM2_5Density.bind(this));

    this.services['AirQualitySensor'].getCharacteristic(this.platform.Characteristic.StatusActive)
      .onGet(this.getActive.bind(this));


   
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
         AirPurifierCommandType.Power, 
         AirPurifierCommandType.Mode,
         AirPurifierCommandType.FanMode,
         AirPurifierCommandType.Nanoe,
          AirPurifierCommandType.PM25
        ]
      );
                                      

      if(deviceStatus === undefined) {
  
        this.services['AirPurifier'].updateCharacteristic(
          this.platform.Characteristic.Active,
          new Error('Exception occurred in refreshDeviceStatus()'),
        );
        
        return;
      }

      this.platform.log.debug(JSON.stringify(deviceStatus));

      // Power
      if (deviceStatus[AirPurifierCommandType.Power] !== undefined) {
        const active = deviceStatus[AirPurifierCommandType.Power].status === '1'
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
        this.services['AirPurifier'].updateCharacteristic(this.platform.Characteristic.Active, active);
      }

    
      if(deviceStatus[AirPurifierCommandType.FanMode] !== undefined) {
        this.services['AirPurifier'].updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSpeedVal(this.getDeviceInfoNumber(AirPurifierCommandType.FanMode)));        
      }

      if(deviceStatus[AirPurifierCommandType.Nanoe] !== undefined) {
        this.services['NanoeSwitch'].updateCharacteristic(this.platform.Characteristic.On, this.getDeviceInfoNumber(AirPurifierCommandType.Nanoe) == 1);
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

  updateSwitchMode(mode: number) {

    const smartAppCommand:SmartAppCommand = this.platform.smartApp.getCommandList(this.accessory.context.device, AirPurifierCommandType.Mode);

    if(smartAppCommand !== undefined){

      smartAppCommand.Parameters.forEach((param:SmartAppParameter) => {
          
          const subtype:string = 'Mode_' + param[1];
          this.services[subtype].updateCharacteristic(this.platform.Characteristic.On, mode == +param[1]);
      });

    }
  }

  private getDeviceInfoNumber(commandType:string, defaultValue:number|undefined = 0):number {
    try{

      const value:number = +this.platform.smartApp.getDeviceInfo(this.accessory.context.device, commandType, defaultValue.toString());
      const CommandName = this.platform.smartApp.getCommandName(this.accessory.context.device, commandType);
      
      this.platform.log.debug(`'${this.accessory.displayName}' getDeviceInfoNumber('${commandType}':'${CommandName}'): `+value);

      return value;

    }catch(err){
      this.platform.log.debug(`'${this.accessory.displayName}' getDeviceInfoNumber('${commandType}' Error: ${err}`);
    }

    return defaultValue;
  }

  async setActive(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setActive() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, AirPurifierCommandType.Power, value === this.platform.Characteristic.Active.ACTIVE ? '1' : '0');

    this.services['AirPurifier'].updateCharacteristic(this.platform.Characteristic.Active, value);  
  }

  async getActive():Promise<CharacteristicValue> { 
      
      const value:number = this.getDeviceInfoNumber(AirPurifierCommandType.Power);
      return value === 1 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getAirPurifierState():Promise<CharacteristicValue> {
  
    const power:number = this.getDeviceInfoNumber(AirPurifierCommandType.Power);

    if(power === 0){
      return this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
    }


    return this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
  
  }

  getSpeedVal(value:number){
    let speed = 0;
    

    switch(value){
      case AirPurifierFanSpeedMode.Fast:
          speed = 100;
          break;

      case AirPurifierFanSpeedMode.Normal:
          speed = 50;
          break;

      case AirPurifierFanSpeedMode.Silent:      
          speed = 20;
          break;

      
      case AirPurifierFanSpeedMode.Auto:
      default:
        speed = 0;
    }

    return speed;

  }

  async setRotationSpeed(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setRotationSpeed() for device '${this.accessory.displayName}'`);
    var speedMode = AirPurifierFanSpeedMode.Auto;

    if(+value > 0 && +value < 25){
      speedMode = AirPurifierFanSpeedMode.Silent;
    }
    else if(+value >= 25 && +value < 75){
      speedMode = AirPurifierFanSpeedMode.Normal;
    }
    else if(+value >= 75){
      speedMode = AirPurifierFanSpeedMode.Fast;      
    }
    else{
      speedMode = AirPurifierFanSpeedMode.Auto;
    }

    this.sendCommandToDevice(
      this.accessory.context.device, AirPurifierCommandType.FanMode, speedMode.toString());

    this.services['AirPurifier'].getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .updateValue(this.getSpeedVal(speedMode));

  }

  async getRotationSpeed():Promise<CharacteristicValue> {
    
    const value:number = this.getDeviceInfoNumber(AirPurifierCommandType.FanMode);
    return this.getSpeedVal(value);
  
  } 

  async setNanoe(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setNanoe() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, AirPurifierCommandType.Nanoe, value ? '1' : '0');

    this.services['NanoeSwitch'].getCharacteristic(this.platform.Characteristic.On)
      .updateValue(value);
  }

  async getNanoe():Promise<CharacteristicValue> {
      
    return this.getDeviceInfoNumber(AirPurifierCommandType.Nanoe) == 1;    

  }

  async getCurrentAirQuality():Promise<CharacteristicValue> {
    const pm25 = this.getDeviceInfoNumber(AirPurifierCommandType.PM25);    
    const pm25Quality = pm25 <= 35 ? 1 : (pm25 <= 53 ? 2 : (pm25 <= 70 ? 3 : (pm25 <= 150 ? 4 : 5)));

    return pm25Quality;
  }

  async getCurrentPM2_5Density():Promise<CharacteristicValue>{
    return this.getDeviceInfoNumber(AirPurifierCommandType.PM25) || 0;
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
