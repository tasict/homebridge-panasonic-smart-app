import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import PanasonicPlatform from '../platform';
import BaseAccessory from './base';
import { PanasonicAccessoryContext, SmartAppDeviceInfo } from '../types';

enum SmartSwitchCommandType {
  // Set per circuit (addressed by its DeviceID); read back on DeviceID 1 alone.
  Power = '0x00',
  // Bitmask of the circuits that are on: bit 0 is circuit (DeviceID) 1.
  OperationState = '0x70',
}

interface Circuit {
  id: number;
  name: string;
}

/**
 * A smart wall switch (智慧開關, e.g. F540107 / F540207 / F540307) with one to
 * three circuits. Each circuit, listed in the device's `Devices`, is its own
 * Switch in the Home app; the Home app's "Display As" can show one as a light
 * or a fan. Circuits are addressed by DeviceID, which only the cloud API
 * carries, so commands always go through the cloud.
 */
export default class SmartSwitchAccessory extends BaseAccessory {

  private readonly circuits: Circuit[];

  constructor(
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>,
  ) {
    super(platform, accessory);

    const device = accessory.context.device;
    const listed = (device?.Devices ?? [])
      .filter((sub) => Number.isInteger(sub?.DeviceID) && sub.DeviceID > 0);
    const nickName = device?.NickName || '智慧開關';
    this.circuits = listed.length > 0
      ? listed.map((sub) => ({
        id: sub.DeviceID,
        name: sub.Name?.trim() || (listed.length > 1 ? `${nickName} ${sub.DeviceID}` : nickName),
      }))
      : [{ id: 1, name: nickName }];

    for (const circuit of this.circuits) {
      const subtype = 'Circuit_' + circuit.id;
      const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
        || this.accessory.addService(this.platform.Service.Switch, circuit.name, subtype);

      service.setCharacteristic(this.platform.Characteristic.Name, circuit.name);
      service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
      service.setCharacteristic(this.platform.Characteristic.ConfiguredName, circuit.name);

      service.getCharacteristic(this.platform.Characteristic.On)
        .onSet((value: CharacteristicValue) => this.setCircuit(circuit, !!value))
        .onGet(() => this.isCircuitOn(circuit.id));

      this.services[subtype] = service;
    }

    // Update characteristic values asynchronously instead of using onGet handlers
    this.startStatusPolling();
  }

  protected get statusCommandTypes(): string[] {
    return [SmartSwitchCommandType.OperationState, SmartSwitchCommandType.Power];
  }

  protected get primaryService(): Service {
    return this.services['Circuit_' + this.circuits[0].id];
  }

  // The circuit bitmask is a cloud-side status; the local registers of a
  // multi-circuit switch can't be relied on to carry it.
  protected get readsStatusLocally(): boolean {
    return this.circuits.length === 1;
  }

  // Switch services have no Active characteristic: circuits show their own state.
  protected get reflectsPowerOnPrimaryService(): boolean {
    return false;
  }

  protected showNotResponding(error: Error) {
    for (const circuit of this.circuits) {
      this.services['Circuit_' + circuit.id]
        .updateCharacteristic(this.platform.Characteristic.On, error);
    }
  }

  protected onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo) {
    if (deviceStatus[SmartSwitchCommandType.OperationState] === undefined
      && deviceStatus[SmartSwitchCommandType.Power] === undefined) {
      return;
    }
    for (const circuit of this.circuits) {
      this.services['Circuit_' + circuit.id].updateCharacteristic(
        this.platform.Characteristic.On, this.isCircuitOn(circuit.id));
    }
  }

  private operationState(): number | undefined {
    const raw = this.platform.smartApp.getDeviceInfo(
      this.accessory.context.device, SmartSwitchCommandType.OperationState, '');
    const value = parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
  }

  private isCircuitOn(id: number): boolean {
    const state = this.operationState();
    if (state !== undefined) {
      return (state & (1 << (id - 1))) !== 0;
    }
    // Without the bitmask, Power on DeviceID 1 is the first circuit's state.
    return id === 1 && this.getDeviceInfoNumber(SmartSwitchCommandType.Power) === 1;
  }

  private async setCircuit(circuit: Circuit, on: boolean) {
    this.platform.log.info(`Setting ${circuit.name} to ${on ? 'on' : 'off'}`);

    const sent = await this.sendCommandToDevice(
      this.accessory.context.device, SmartSwitchCommandType.Power, on ? '1' : '0', circuit.id);

    // Reflect the change in the cached bitmask so the other circuits and the
    // next onGet agree until the next poll confirms it.
    const state = this.operationState();
    if (sent && state !== undefined) {
      const bit = 1 << (circuit.id - 1);
      this.platform.smartApp.setDeviceInfo(
        this.accessory.context.device, SmartSwitchCommandType.OperationState,
        String(on ? state | bit : state & ~bit));
    }
  }
}
