import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import {
  findCommandByName, isEnum, isReading, normalizeCommandType, sameCode,
} from './command-helpers';
import { PanasonicAccessoryContext, SmartAppCommand, SmartAppDeviceInfo } from '../types';

// Candidate codes, tried when the CommandList doesn't name the feature. The
// Taiwanese FY-ZY series uses 0x15 (換氣模式) and 0x56 (風量); TaiSEIA's
// generic ERV registers are 0x01 / 0x02.
const MODE_CANDIDATES = ['0x15', '0x01'];
const FAN_CANDIDATES = ['0x56', '0x02'];
// Indoor and outdoor temperature readings, shown only if the model lists them.
const TEMPERATURE_CANDIDATES = ['0x04', '0x05'];

/**
 * A heat exchanger (全熱交換器, ERV). HomeKit has no ventilation service, so it
 * is a fan: power and fan speed (with Auto when the model has an automatic
 * speed), one switch per ventilation mode, and temperature sensors for the
 * readings the model reports.
 */
export default class ErvAccessory extends BaseAccessory {

  private readonly modeCommandType: string | undefined;
  private readonly hasFan: boolean;
  private readonly temperatureCommandTypes: string[] = [];

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

    const device = accessory.context.device;
    const commands = this.platform.smartApp.getCommands(device);
    const listed = (code: string) =>
      commands.find((command) => sameCode(command.CommandType, code));

    const fan = findCommandByName(commands, /風量|風速/, isEnum);
    this.hasFan = this.useFanCommand(fan ? [fan.CommandType] : FAN_CANDIDATES);

    // The ventilation mode: an enum named like one, else the first candidate
    // listed as an enum - never the fan speed command.
    const isMode = (command: SmartAppCommand | undefined): command is SmartAppCommand =>
      command !== undefined && isEnum(command)
      && !(this.hasFan && sameCode(command.CommandType, this.fanCommandType));
    const mode = findCommandByName(commands, /換氣|模式/, isMode)
      ?? MODE_CANDIDATES.map(listed).find(isMode);
    this.modeCommandType = mode ? normalizeCommandType(mode.CommandType) : undefined;

    this.services['Fan'] = this.accessory.getService(this.platform.Service.Fanv2)
      || this.accessory.addService(this.platform.Service.Fanv2);

    // This is what is displayed as the default name on the Home app
    this.services['Fan'].setCharacteristic(
      this.platform.Characteristic.Name,
      device?.NickName || '全熱交換器',
    );

    this.services['Fan']
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    if (this.hasFan) {
      this.services['Fan']
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onSet(this.setFanRotationSpeed.bind(this))
        .onGet(this.getRotationSpeed.bind(this));

      if (this.fanLevels.auto !== undefined) {
        this.services['Fan']
          .getCharacteristic(this.platform.Characteristic.TargetFanState)
          .onSet(this.setTargetFanState.bind(this))
          .onGet(() => this.targetFanState());
      }
    }

    //////////
    // One switch per ventilation mode in the device's CommandList.
    if (this.modeCommandType !== undefined) {
      this.setupModeSwitches(this.modeCommandType);
    }

    //////////
    for (const code of TEMPERATURE_CANDIDATES) {
      const command = listed(code);
      if (command === undefined || !isReading(command) || !/溫/.test(command.CommandName ?? '')) {
        continue;
      }
      const commandType = normalizeCommandType(code);
      const subtype = 'Temperature_' + commandType;
      const { TemperatureSensor } = this.platform.Service;
      const service = this.accessory.getServiceById(TemperatureSensor, subtype)
        || this.accessory.addService(TemperatureSensor, command.CommandName, subtype);
      service.setCharacteristic(this.platform.Characteristic.Name, command.CommandName);
      service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -50, maxValue: 100 })
        .onGet(() => this.temperature(commandType));
      this.services[subtype] = service;
      this.temperatureCommandTypes.push(commandType);
    }

    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [
      BaseAccessory.PowerCommandType,
      ...(this.hasFan ? [this.fanCommandType] : []),
      ...(this.modeCommandType !== undefined ? [this.modeCommandType] : []),
      ...this.temperatureCommandTypes,
    ];
  }

  protected get primaryService(): Service {
    return this.services['Fan'];
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    // Power -> Active is handled by BaseAccessory.

    if (this.hasFan && deviceStatus[this.fanCommandType] !== undefined) {
      if (this.fanLevels.auto !== undefined) {
        this.services['Fan'].updateCharacteristic(
          this.platform.Characteristic.TargetFanState, this.targetFanState());
      }
      if (!this.isFanAuto()) {
        this.services['Fan'].updateCharacteristic(
          this.platform.Characteristic.RotationSpeed, this.fanPercent());
      }
    }

    if (this.modeCommandType !== undefined && deviceStatus[this.modeCommandType] !== undefined) {
      this.updateModeSwitches(this.modeCommandType);
    }

    for (const commandType of this.temperatureCommandTypes) {
      if (deviceStatus[commandType] !== undefined) {
        this.services['Temperature_' + commandType].updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature, this.temperature(commandType));
      }
    }
  }

  private temperature(commandType: string): number {
    return Math.max(-50, Math.min(100, this.getDeviceInfoNumber(commandType)));
  }

  private targetFanState(): number {
    return this.isFanAuto()
      ? this.platform.Characteristic.TargetFanState.AUTO
      : this.platform.Characteristic.TargetFanState.MANUAL;
  }

  async setTargetFanState(value: CharacteristicValue) {
    this.platform.log.debug(
      `Accessory: setTargetFanState() for device '${this.accessory.displayName}'`);

    if (value === this.platform.Characteristic.TargetFanState.AUTO) {
      this.sendFanPercent(0);
      return;
    }

    // Manual: keep the speed shown in the Home app, or pick the middle one.
    if (this.isFanAuto()) {
      const shown = +(this.services['Fan']
        .getCharacteristic(this.platform.Characteristic.RotationSpeed).value ?? 0);
      const percent = this.sendFanPercent(shown > 0 ? shown : 50);
      this.services['Fan'].updateCharacteristic(
        this.platform.Characteristic.RotationSpeed, percent);
    }
  }

  async setFanRotationSpeed(value: CharacteristicValue) {
    // HomeKit sends 0 together with Active = off; the power command handles that.
    if (+value <= 0) {
      return;
    }
    await this.setRotationSpeed(value);
    if (this.fanLevels.auto !== undefined) {
      const { TargetFanState } = this.platform.Characteristic;
      this.services['Fan'].updateCharacteristic(TargetFanState, TargetFanState.MANUAL);
    }
  }
}
