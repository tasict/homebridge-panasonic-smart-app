import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import PanasonicPlatform from '../platform';
import {
  DEVICE_STATUS_REFRESH_INTERVAL,
  MAX_REFRESH_BACKOFF_INTERVALS,
} from '../settings';
import { SECONDS_BETWEEN_REQUEST } from '../const';
import { TransientApiError } from '../exceptions';
import { PanasonicAccessoryContext, SmartAppDevice, SmartAppDeviceInfo } from '../types';

// Fan speed enum shared by the air purifier and the dehumidifier
// (identical values on both device types).
export enum FanSpeedMode {
  Auto = 0,
  Fast = 1,
  Normal = 2,
  Silent = 3,
}

/**
 * Shared behaviour for all Panasonic accessories: accessory information,
 * cached-value helpers, command sending, and self-guarding status polling.
 * Only one poll per accessory is ever in flight, and polling backs off
 * exponentially while the device or the server keeps failing, so a slow
 * server can never pile up overlapping polls in the request queue.
 */
export default abstract class BaseAccessory {
  // Power ('0x00') is common to every supported Smart App device type.
  protected static readonly PowerCommandType = '0x00';

  // Fan mode ('0x0E') is common to the air purifier and the dehumidifier.
  protected static readonly FanModeCommandType = '0x0E';

  // Used to stagger the polling of accessories created back-to-back during
  // discovery, so they don't all enqueue their polls on the same tick.
  private static _pollStartCounter = 0;

  protected services: Record<string, Service> = {};

  private _startTimeout: NodeJS.Timeout | undefined;
  private _refreshInterval: NodeJS.Timeout | undefined;
  private _refreshInFlight = false;
  private _consecutiveRefreshFailures = 0;
  private _intervalsToSkip = 0;
  private _markedNotResponding = false;

  constructor(
    protected readonly platform: PanasonicPlatform,
    protected readonly accessory: PlatformAccessory<PanasonicAccessoryContext>,
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
  }

  // Command types fetched by every status poll.
  protected abstract get statusCommandTypes(): string[];

  // Service whose Active characteristic reflects the 'Not Responding' state.
  protected abstract get primaryService(): Service;

  // Applies a freshly fetched device status to the HomeKit characteristics.
  protected abstract onDeviceStatusUpdate(deviceStatus: SmartAppDeviceInfo): void;

  /**
   * Fetches the device status once and starts the polling interval.
   * Subclasses call this at the end of their constructor. The start is
   * staggered per accessory so all intervals don't fire on the same tick.
   */
  protected startStatusPolling() {
    const offset = BaseAccessory._pollStartCounter++ * SECONDS_BETWEEN_REQUEST * 1000;

    this._startTimeout = setTimeout(() => {
      this._startTimeout = undefined;
      this.refreshDeviceStatus();

      this._refreshInterval = setInterval(
        this.refreshDeviceStatus.bind(this),
        DEVICE_STATUS_REFRESH_INTERVAL,
      );
    }, offset);
  }

  /**
   * Retrieves the device status from Smart App and updates its characteristics.
   */
  protected async refreshDeviceStatus() {
    // Never overlap polls: if the previous one is still queued or running
    // (slow server), this tick is a no-op instead of queueing another one.
    if (this._refreshInFlight) {
      this.platform.log.debug(
        `Accessory: Skipping refresh for '${this.accessory.displayName}' `
        + '- the previous refresh is still in progress.');
      return;
    }

    if (this._intervalsToSkip > 0) {
      this._intervalsToSkip--;
      return;
    }

    this._refreshInFlight = true;
    this.platform.log.debug(`Accessory: Refresh status for device '${this.accessory.displayName}'`);

    try {
      const deviceStatus = await this.platform.smartApp.fetchDeviceInfo(
        this.accessory.context.device,
        this.statusCommandTypes,
      );

      // null: the poll was dropped for a global reason (full queue,
      // rate-limit pause, shutdown) - not this device's fault, so don't
      // mark it Not Responding or back off its polling.
      if (deviceStatus === null) {
        return;
      }

      if (deviceStatus === undefined) {
        this.onRefreshFailure();
        return;
      }

      this._consecutiveRefreshFailures = 0;
      this._intervalsToSkip = 0;

      // Reflect the power state on the primary service. Skipped when the
      // response is missing the Power status - unless the accessory is
      // currently marked Not Responding, where any real value must replace
      // the error state or it would stick forever despite successful polls.
      if (deviceStatus[BaseAccessory.PowerCommandType] !== undefined
        || this._markedNotResponding) {
        this.primaryService.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.getDeviceInfoNumber(BaseAccessory.PowerCommandType) === 1
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE);
        this._markedNotResponding = false;
      }

      if (this.platform.log.debugMode) {
        this.platform.log.debug(JSON.stringify(deviceStatus));
      }
      this.onDeviceStatusUpdate(deviceStatus);
    } catch (error) {
      if (error instanceof TransientApiError) {
        this.platform.log.debug(error.message);
        return;
      }

      this.platform.log.error('An error occurred while refreshing the device status. '
        + 'Turn on debug mode for more information.');

      // Only log if a Promise rejection reason was provided.
      // Some errors are already logged at source.
      if (error) {
        this.platform.log.debug(error);
      }

      this.onRefreshFailure();
    } finally {
      this._refreshInFlight = false;
    }
  }

  /**
   * Marks the accessory 'Not Responding' in the Home app and backs off the
   * polling exponentially (skip 1, 3, 7, ... intervals, capped) while the
   * failures persist. The next successful refresh or command resets the backoff.
   */
  private onRefreshFailure() {
    this._consecutiveRefreshFailures++;
    this._intervalsToSkip = Math.min(
      2 ** this._consecutiveRefreshFailures,
      MAX_REFRESH_BACKOFF_INTERVALS,
    ) - 1;

    this._markedNotResponding = true;
    this.primaryService.updateCharacteristic(
      this.platform.Characteristic.Active,
      new Error('Exception occurred in refreshDeviceStatus()'),
    );
  }

  protected getDeviceInfoNumber(commandType: string, defaultValue: number | undefined = 0): number {
    try {

      const value: number = +this.platform.smartApp.getDeviceInfo(
        this.accessory.context.device, commandType, defaultValue.toString());

      // This runs on every poll for every characteristic - don't scan the
      // CommandList or build the message unless debug output is enabled.
      if (this.platform.log.debugMode) {
        const commandName = this.platform.smartApp.getCommandName(
          this.accessory.context.device, commandType);

        this.platform.log.debug(
          `'${this.accessory.displayName}' getDeviceInfoNumber`
          + `('${commandType}':'${commandName}'): ` + value);
      }

      return value;

    } catch (err) {
      this.platform.log.debug(
        `'${this.accessory.displayName}' getDeviceInfoNumber('${commandType}' Error: ${err}`);
    }

    return defaultValue;
  }

  /**
   * Sends a command through the priority queue. Returns whether it succeeded.
   * A success proves the device is reachable, so the poll backoff is reset;
   * a failure schedules a refresh to correct the optimistic HomeKit update.
   */
  protected async sendCommandToDevice(
    device: SmartAppDevice,
    command: string,
    value: string,
  ): Promise<boolean> {
    try {
      // Only send non-empty payloads to prevent a '500 Internal Server Error'
      this.platform.log.debug(
        `Sending command '${command}' with value '${value}' `
        + `to device '${this.accessory.displayName}'`);

      await this.platform.smartApp.doCommand(device, command, value);

      this._consecutiveRefreshFailures = 0;
      this._intervalsToSkip = 0;
      return true;

    } catch (error) {
      if (error instanceof TransientApiError) {
        this.platform.log.debug(error.message);
        return false;
      }

      this.platform.log.error('An error occurred while sending a device update. '
        + 'Turn on debug mode for more information.');

      // Only log if a Promise rejection reason was provided.
      // Some errors are already logged at source.
      if (error) {
        this.platform.log.debug(error);
      }

      // The setter already updated HomeKit optimistically - re-sync from
      // the device so the UI doesn't keep showing a state that never applied.
      this._intervalsToSkip = 0;
      this.refreshDeviceStatus();
      return false;
    }
  }

  async setActive(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setActive() for device '${this.accessory.displayName}'`);

    this.sendCommandToDevice(
      this.accessory.context.device, BaseAccessory.PowerCommandType,
      value === this.platform.Characteristic.Active.ACTIVE ? '1' : '0');

    this.primaryService.updateCharacteristic(this.platform.Characteristic.Active, value);
  }

  async getActive(): Promise<CharacteristicValue> {

    const value: number = this.getDeviceInfoNumber(BaseAccessory.PowerCommandType);
    return value === 1
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  protected fanSpeedModeToPercent(mode: number): number {
    switch (mode) {
      case FanSpeedMode.Fast:
        return 100;
      case FanSpeedMode.Normal:
        return 50;
      case FanSpeedMode.Silent:
        return 20;
      case FanSpeedMode.Auto:
      default:
        return 0;
    }
  }

  protected percentToFanSpeedMode(value: number): FanSpeedMode {
    if (value >= 75) {
      return FanSpeedMode.Fast;
    }
    if (value >= 25) {
      return FanSpeedMode.Normal;
    }
    if (value > 0) {
      return FanSpeedMode.Silent;
    }
    return FanSpeedMode.Auto;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    this.platform.log.debug(
      `Accessory: setRotationSpeed() for device '${this.accessory.displayName}'`);

    const speedMode = this.percentToFanSpeedMode(+value);

    this.sendCommandToDevice(
      this.accessory.context.device, BaseAccessory.FanModeCommandType, speedMode.toString());

    this.primaryService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .updateValue(this.fanSpeedModeToPercent(speedMode));
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {

    const value: number = this.getDeviceInfoNumber(BaseAccessory.FanModeCommandType);
    return this.fanSpeedModeToPercent(value);
  }

  /**
   * Creates (or restores) a Switch service bound to a single on/off command
   * type, named after the device's CommandList entry. `onValue`/`offValue`
   * cover devices with inverted semantics (e.g. the dehumidifier buzzer,
   * where '0' means buzzer-on).
   */
  protected setupToggleSwitch(
    key: string,
    commandType: string,
    defaultName: string,
    onValue = '1',
    offValue = '0',
  ): Service {
    const name = this.platform.smartApp.getCommandName(
      this.accessory.context.device, commandType, defaultName);

    const service = this.accessory.getServiceById(this.platform.Service.Switch, commandType)
      || this.accessory.addService(this.platform.Service.Switch, name, commandType);

    service.setCharacteristic(this.platform.Characteristic.Name, name);
    service.getCharacteristic(this.platform.Characteristic.On)
      .onSet((value: CharacteristicValue) => {
        this.platform.log.debug(
          `Accessory: set '${name}' for device '${this.accessory.displayName}'`);

        this.sendCommandToDevice(
          this.accessory.context.device, commandType, value ? onValue : offValue);

        service.getCharacteristic(this.platform.Characteristic.On).updateValue(value);
      })
      .onGet(() => this.getDeviceInfoNumber(commandType) === +onValue);

    service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);

    this.services[key] = service;
    return service;
  }

  // Stops the background status polling (called on shutdown or when the device is removed).
  dispose() {
    if (this._startTimeout) {
      clearTimeout(this._startTimeout);
      this._startTimeout = undefined;
    }
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = undefined;
    }
  }
}
