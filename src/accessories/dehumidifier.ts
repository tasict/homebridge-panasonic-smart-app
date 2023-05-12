import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, CharacteristicEventTypes } from 'homebridge';
import PanasonicPlatform from '../platform';
import { DEVICE_STATUS_REFRESH_INTERVAL } from '../settings';
import { PanasonicAccessoryContext, SmartAppCommand, SmartAppParameter } from '../types';

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

enum DehumidifierFanSpeedMode {
  Auto = 0,
  Fast = 1,
  Normal = 2,
  Silent = 3
}

/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class DehumidifierAccessory {
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

    this.services['HumidifierDehumidifier'] = this.accessory.getService(this.platform.Service.HumidifierDehumidifier)
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
      .setProps({ validValues: [this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER] });

    this.services['HumidifierDehumidifier']
      .setCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState, this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER);


    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .setProps({ validValues: [
        this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE, 
        this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING,
      	this.platform.Characteristic.CurrentHumidifierDehumidifierState.IDLE,
        ]
      })
      .onGet(this.getHumidifierDehumidifierState.bind(this));

    this.services['HumidifierDehumidifier']
      .getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .setProps({
        minValue: 40,
        maxValue: 70,
        minStep: 5,
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
     this.services['LeakSensor'] = this.accessory.getService(this.platform.Service.LeakSensor) || this.accessory.addService(this.platform.Service.LeakSensor, '水箱');
    
     this.services['LeakSensor'].setCharacteristic(this.platform.Characteristic.Name, '水箱');
     this.services['LeakSensor'].getCharacteristic(this.platform.Characteristic.LeakDetected)
    .onGet(this.getLeakDetected.bind(this));

     this.services['LeakSensor'].addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
     this.services['LeakSensor'].setCharacteristic(this.platform.Characteristic.ConfiguredName, '水箱');

    //////////
    const buttonBuzzerName = this.platform.smartApp.getCommandName(this.accessory.context.device, DehumidifierCommandType.Buzzer, '操作提示音');
    this.services['BuzzerSwitch'] = this.accessory.getServiceByUUIDAndSubType(this.platform.Service.Switch, DehumidifierCommandType.Buzzer) || this.accessory.addService(this.platform.Service.Switch,  'buttonBuzzerName', DehumidifierCommandType.Buzzer);

     this.services['BuzzerSwitch'].setCharacteristic(this.platform.Characteristic.Name, buttonBuzzerName);
     this.services['BuzzerSwitch'].getCharacteristic(this.platform.Characteristic.On)
    .onSet(this.setBuzzer.bind(this))
    .onGet(this.getBuzzer.bind(this));

     this.services['BuzzerSwitch'].addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
     this.services['BuzzerSwitch'].setCharacteristic(this.platform.Characteristic.ConfiguredName, buttonBuzzerName);

    //////////
    const buttonNanoName = this.platform.smartApp.getCommandName(this.accessory.context.device, DehumidifierCommandType.Nanoe, 'NanoE');

    this.services['NanoeSwitch'] = this.accessory.getServiceByUUIDAndSubType(this.platform.Service.Switch, DehumidifierCommandType.Nanoe) || this.accessory.addService(this.platform.Service.Switch,  buttonNanoName, DehumidifierCommandType.Nanoe);
    
    this.services['NanoeSwitch'].setCharacteristic(this.platform.Characteristic.Name, buttonNanoName);
    this.services['NanoeSwitch'].getCharacteristic(this.platform.Characteristic.On)
    .onSet(this.setNanoe.bind(this))
    .onGet(this.getNanoe.bind(this));
    
    this.services['NanoeSwitch'].addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    this.services['NanoeSwitch'].setCharacteristic(this.platform.Characteristic.ConfiguredName, buttonNanoName);

    //////////
    const smartAppCommand:SmartAppCommand = this.platform.smartApp.getCommandList(this.accessory.context.device, DehumidifierCommandType.Mode);

    if(smartAppCommand !== undefined){

      smartAppCommand.Parameters.forEach((param:SmartAppParameter) => {

        const name:string = param[0] as string;
        const subtype:string = 'Mode_' + param[1];

        this.platform.log.debug(`Accessory: Mode Switch for device '${name}'`);
        
        let serviceSwitch = this.accessory.getServiceByUUIDAndSubType(this.platform.Service.Switch, subtype) || this.accessory.addService(this.platform.Service.Switch, name, subtype);

        serviceSwitch.setCharacteristic(this.platform.Characteristic.Name, name);
        serviceSwitch.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        serviceSwitch.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);

        serviceSwitch.getCharacteristic(this.platform.Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

          this.platform.log.info(`Setting ${this.accessory.displayName} ${name} to ${value ? 'on' : 'off'}`);

          if(value){
            this.sendCommandToDevice(
              this.accessory.context.device, DehumidifierCommandType.Mode, param[1] as string);
          }

          callback();
          this.updateSwitchMode(+param[1]);

        })
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          const mode:number = this.getDeviceInfoNumber(DehumidifierCommandType.Mode);
          this.platform.log.info(`Getting ${this.accessory.displayName} ${name} status: '${+param[1] == mode ? 'on' : 'off'}}'`);
          callback(undefined, mode == +param[1]);
        });
               
        this.services[subtype] = serviceSwitch;

      });


    }
   
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
         DehumidifierCommandType.Power, 
         DehumidifierCommandType.Mode,
         DehumidifierCommandType.FanMode,
         DehumidifierCommandType.Buzzer,
         DehumidifierCommandType.Nanoe,
         DehumidifierCommandType.TargetHumidity, 
         DehumidifierCommandType.Humidity,
         DehumidifierCommandType.TankStatus
        ]
      );


      if(deviceStatus === undefined) {
  
        this.services['HumidifierDehumidifier'].updateCharacteristic(
          this.platform.Characteristic.Active,
          new Error('Exception occurred in refreshDeviceStatus()'),
        );
        
        return;
      }

      this.platform.log.debug(JSON.stringify(deviceStatus));

      // Power
      if (deviceStatus[DehumidifierCommandType.Power] !== undefined) {
        const active = deviceStatus[DehumidifierCommandType.Power].status === '1'
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
        this.services['HumidifierDehumidifier'].updateCharacteristic(this.platform.Characteristic.Active, active);
      }

      if (deviceStatus[DehumidifierCommandType.TargetHumidity] !== undefined) {
        this.services['HumidifierDehumidifier'].updateCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold, this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5 + 40);
      }

      if (deviceStatus[DehumidifierCommandType.Humidity] !== undefined) {
        this.services['HumidifierDehumidifier'].updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.getDeviceInfoNumber(DehumidifierCommandType.Humidity));
      }
      
      if(deviceStatus[DehumidifierCommandType.FanMode] !== undefined) {
        this.services['HumidifierDehumidifier'].updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSpeedVal(this.getDeviceInfoNumber(DehumidifierCommandType.FanMode)));        
      }


      if (deviceStatus[DehumidifierCommandType.TankStatus] !== undefined) {
         this.services['LeakSensor'].updateCharacteristic(this.platform.Characteristic.LeakDetected
          , this.getDeviceInfoNumber(DehumidifierCommandType.TankStatus) == 1 ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED);
      }

      if(deviceStatus[DehumidifierCommandType.Buzzer] !== undefined) {
         this.services['BuzzerSwitch'].updateCharacteristic(this.platform.Characteristic.On, this.getDeviceInfoNumber(DehumidifierCommandType.Buzzer) == 0);
      }

      if(deviceStatus[DehumidifierCommandType.Nanoe] !== undefined) {
        this.services['NanoeSwitch'].updateCharacteristic(this.platform.Characteristic.On, this.getDeviceInfoNumber(DehumidifierCommandType.Nanoe) == 1);
      }

      ///

      this.updateSwitchMode(this.getDeviceInfoNumber(DehumidifierCommandType.Mode));



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

    const smartAppCommand:SmartAppCommand = this.platform.smartApp.getCommandList(this.accessory.context.device, DehumidifierCommandType.Mode);

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
      this.accessory.context.device, DehumidifierCommandType.Power, value === this.platform.Characteristic.Active.ACTIVE ? '1' : '0');

    this.services['HumidifierDehumidifier'].updateCharacteristic(this.platform.Characteristic.Active, value);  
  }

  async getActive():Promise<CharacteristicValue> { 
      
      const value:number = this.getDeviceInfoNumber(DehumidifierCommandType.Power);
      return value === 1 ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async getHumidifierDehumidifierState():Promise<CharacteristicValue> {
  
    const power:number = this.getDeviceInfoNumber(DehumidifierCommandType.Power);
    const humidity:number = this.getDeviceInfoNumber(DehumidifierCommandType.Humidity);
    const targetHumidity:number = this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5 + 40;

    if(power === 0){
      return this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }


    return humidity > targetHumidity ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING : this.platform.Characteristic.CurrentHumidifierDehumidifierState.IDLE;
  
  }

  async setRelativeHumidityDehumidifierThreshold(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setRelativeHumidityDehumidifierThreshold() for device '${this.accessory.displayName}'`);

    const threshold:number = +value - 40;

    this.sendCommandToDevice(
      this.accessory.context.device, DehumidifierCommandType.TargetHumidity, threshold.toString());

    this.services['HumidifierDehumidifier'].getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .updateValue(value);
  }

  async getRelativeHumidityDehumidifierThreshold():Promise<CharacteristicValue> {

    const value:number = this.getDeviceInfoNumber(DehumidifierCommandType.TargetHumidity) * 5 + 40;
    
    return value;
  
  }

  getSpeedVal(value:number){
    let speed = 0;
    

    switch(value){
      case DehumidifierFanSpeedMode.Fast:
          speed = 100;
          break;

      case DehumidifierFanSpeedMode.Normal:
          speed = 50;
          break;

      case DehumidifierFanSpeedMode.Silent:      
          speed = 20;
          break;

      
      case DehumidifierFanSpeedMode.Auto:
      default:
        speed = 0;
    }

    return speed;

  }

  async setRotationSpeed(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setRotationSpeed() for device '${this.accessory.displayName}'`);
    var speedMode = DehumidifierFanSpeedMode.Auto;

    if(+value > 0 && +value < 25){
      speedMode = DehumidifierFanSpeedMode.Silent;
    }
    else if(+value >= 25 && +value < 75){
      speedMode = DehumidifierFanSpeedMode.Normal;
    }
    else if(+value >= 75){
      speedMode = DehumidifierFanSpeedMode.Fast;      
    }
    else{
      speedMode = DehumidifierFanSpeedMode.Auto;
    }

    this.sendCommandToDevice(
      this.accessory.context.device, DehumidifierCommandType.FanMode, speedMode.toString());

    this.services['HumidifierDehumidifier'].getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .updateValue(this.getSpeedVal(speedMode));

  }

  async getRotationSpeed():Promise<CharacteristicValue> {
    
    const value:number = this.getDeviceInfoNumber(DehumidifierCommandType.FanMode);
    return this.getSpeedVal(value);
  
  } 
  
  async getLeakDetected():Promise<CharacteristicValue> {

    const value:number = this.getDeviceInfoNumber(DehumidifierCommandType.TankStatus);
    
    return value == 1 ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
  }
  
  async setBuzzer(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setBuzzer() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, DehumidifierCommandType.Buzzer, value ? '0' : '1');

     this.services['BuzzerSwitch'].getCharacteristic(this.platform.Characteristic.On)
      .updateValue(value);
  }

  async getBuzzer():Promise<CharacteristicValue> {
      
    return this.getDeviceInfoNumber(DehumidifierCommandType.Buzzer) == 0;    

  }

  async setNanoe(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setNanoe() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, DehumidifierCommandType.Nanoe, value ? '1' : '0');

    this.services['NanoeSwitch'].getCharacteristic(this.platform.Characteristic.On)
      .updateValue(value);
  }

  async getNanoe():Promise<CharacteristicValue> {
      
    return this.getDeviceInfoNumber(DehumidifierCommandType.Nanoe) == 1;    

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
