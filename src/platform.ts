import {
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import SmartAppApi from './smart-app';
import DehumidifierAccessory from './accessories/dehumidifier';
import ClimateAccessory from './accessories/climate';
import AirPurifierAccessory from './accessories/airpurifier';

import PanasonicPlatformLogger from './logger';
import { PanasonicAccessoryContext, PanasonicPlatformConfig, SmartAppDevice } from './types';
import {
  LOGIN_RETRY_DELAY,
  MAX_NO_OF_FAILED_LOGIN_ATTEMPTS,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './settings';

enum SupportDeviceType {
  Climate = '1',
  WashMachine = '3',
  Dehumidifier = '4',
  AirPurifier = '8'
}


/**
 * Panasonic Smart App Platform Plugin for Homebridge
 * Based on https://github.com/homebridge/homebridge-plugin-template
 */
export default class PanasonicPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // Used to track restored cached accessories
  private readonly accessories: PlatformAccessory<PanasonicAccessoryContext>[] = [];

  // Active accessory handlers, keyed by accessory UUID, so we can stop their polling.
  private readonly handlers = new Map<string, { dispose(): void }>();

  private _loginRetryTimeout: NodeJS.Timeout | undefined;
  private noOfFailedLoginAttempts = 0;

  public readonly smartApp: SmartAppApi;
  public readonly log: PanasonicPlatformLogger;

  public platformConfig: PanasonicPlatformConfig;

  /**
   * This constructor is where you should parse the user config
   * and discover/register accessories with Homebridge.
   *
   * @param logger Homebridge logger
   * @param config Homebridge platform config
   * @param api Homebridge API
   */
  constructor(
    homebridgeLogger: Logger,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    this.platformConfig = config as PanasonicPlatformConfig;

    // Initialise logging utility
    this.log = new PanasonicPlatformLogger(homebridgeLogger, this.platformConfig.debugMode);

    // Create Smart App communication module
    this.smartApp = new SmartAppApi(
      this.platformConfig,
      this.log,
    );

    /**
     * When this event is fired it means Homebridge has restored all cached accessories from disk.
     * Dynamic Platform plugins should only register new accessories after this event was fired,
     * in order to ensure they weren't added to homebridge already. This event can also be used
     * to start discovery of new accessories.
     */
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.log.debug('Finished launching and restored cached accessories.');
      this.configurePlugin();
    });

    // Stop all timers on shutdown so we don't leak intervals or keep hitting the API.
    this.api.on(APIEvent.SHUTDOWN, () => {
      if (this._loginRetryTimeout) {
        clearTimeout(this._loginRetryTimeout);
      }
      this.smartApp.dispose();
      this.handlers.forEach(handler => handler.dispose());
      this.handlers.clear();
    });
  }

  async configurePlugin() {
    await this.loginAndDiscoverDevices();
  }

  async loginAndDiscoverDevices() {
    if (!this.platformConfig.email) {
      this.log.error('Email is not configured - aborting plugin start. '
        + 'Please set the field `email` in your config and restart Homebridge.');
      return;
    }

    if (!this.platformConfig.password) {
      this.log.error('Password is not configured - aborting plugin start. '
        + 'Please set the field `password` in your config and restart Homebridge.');
      return;
    }

    this.log.info('Attempting to log into Smart App.');
    this.smartApp.login()
      .then(() => {
        this.log.info('Successfully logged in.');
        this.noOfFailedLoginAttempts = 0;
        this.discoverDevices();
      })
      .catch(() => {
        this.log.error('Login failed. Skipping device discovery.');
        this.noOfFailedLoginAttempts++;

        if (this.noOfFailedLoginAttempts < MAX_NO_OF_FAILED_LOGIN_ATTEMPTS) {
          this.log.error(
            'The Smart App server might be experiencing issues at the moment. '
            + `The plugin will try to log in again in ${LOGIN_RETRY_DELAY / 1000} seconds. `
            + 'If the issue persists, make sure you configured the correct email and password '
            + 'and run the latest version of the plugin. '
            + 'Restart Homebridge when you change your config.',
          );

          this._loginRetryTimeout = setTimeout(
            this.loginAndDiscoverDevices.bind(this),
            LOGIN_RETRY_DELAY,
          );
        } else {
          this.log.error(
            'Maximum number of failed login attempts reached '
            + `(${MAX_NO_OF_FAILED_LOGIN_ATTEMPTS}). `
            + 'Check your login details and restart Homebridge to reset the plugin.',
          );
        }
      });
  }

  /**
   * This function is invoked when Homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory<PanasonicAccessoryContext>) {
    this.log.info(`Loading accessory '${accessory.displayName}' from cache.`);

    /**
     * We don't have to set up the handlers here,
     * because our device discovery function takes care of that.
     *
     * But we need to add the restored accessory to the
     * accessories cache so we can access it during that process.
     */
    this.accessories.push(accessory);
  }

  isSupportedDevice(deviceType: string): boolean {

    switch (deviceType) {
      case SupportDeviceType.Dehumidifier:
      case SupportDeviceType.Climate:
      case SupportDeviceType.AirPurifier:


        return true;

      default:
      case SupportDeviceType.WashMachine:
        return false;
    }

    return false;

  }

  /**
   * Fetches all of the user's devices from Smart App and sets up handlers.
   *
   * Accessories must only be registered once. Previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    this.log.info('Discovering devices on Smart App.');

    try {
      const smartAppDevices = await this.smartApp.fetchDevices();

      // Loop over the discovered (indoor) devices and register each
      // one if it has not been registered before.
      for (const device of smartAppDevices) {

        // Check if the device is supported
        if (!this.isSupportedDevice(device.DeviceType)) {
          this.log.info(`Skipping unsupport device '${device.NickName}' with ${device.DeviceType}`);
          continue;
        }

        // Generate a unique id for the accessory.
        // This should be generated from something globally unique,
        // but constant, for example, the device serial number or MAC address
        const uuid = this.api.hap.uuid.generate(device.GWID);

        // Check if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above.
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

        if (existingAccessory !== undefined) {
          // The accessory already exists
          this.log.info(`Restoring accessory '${existingAccessory.displayName}' `
            + `(${device.GWID}) from cache.`);

          // If you need to update the accessory.context then you should run
          // `api.updatePlatformAccessories`. eg.:
          existingAccessory.context.device = device;
          this.api.updatePlatformAccessories([existingAccessory]);

          // Create the accessory handler for the restored accessory

          this.createPanasonicAccessory(device.DeviceType, this, existingAccessory);

        } else {
          this.log.info(`Adding accessory '${device.NickName}' (${device.GWID}).`);
          // The accessory does not yet exist, so we need to create it
          const accessory = new this.api.platformAccessory<PanasonicAccessoryContext>(
            device.NickName, uuid);

          // Store a copy of the device object in the `accessory.context` property,
          // which can be used to store any data about the accessory you may need.
          accessory.context.device = device;

          // Create the accessory handler for the newly create accessory
          // this is imported from `platformAccessory.ts`
          this.createPanasonicAccessory(device.DeviceType, this, accessory);

          // Link the accessory to your platform
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }

      // At this point, we set up all devices from Smart App, but we did not unregister
      // cached devices that do not exist on the Smart App account anymore.
      // Guard: if the server returned an empty device list (e.g. a temporary
      // glitch that still reports success), skip the cleanup - otherwise a
      // single bad response would wipe every cached accessory and the user
      // would lose their HomeKit room assignments and automations.
      if (smartAppDevices.length === 0) {
        this.log.info('Smart App returned no devices - skipping cached accessory cleanup. '
          + 'If you really removed every device from your account, remove the stale '
          + 'accessories manually via the Homebridge UI.');
        return;
      }

      const isOnAccount = (
        devices: SmartAppDevice[],
        accessory: PlatformAccessory<PanasonicAccessoryContext>,
      ) => devices.some(device => device.GWID === accessory.context.device?.GWID);

      let staleAccessories = this.accessories.filter(
        accessory => accessory.context.device && !isOnAccount(smartAppDevices, accessory));

      if (staleAccessories.length > 0) {
        // A transiently incomplete device list must not unregister accessories
        // (the user would lose their HomeKit room assignments and automations),
        // so confirm the absence with a second fetch before removing anything.
        const confirmedDevices = await this.smartApp.fetchDevices();

        if (confirmedDevices.length === 0) {
          this.log.info('Smart App returned no devices on the confirmation fetch '
            + '- skipping cached accessory cleanup.');
          return;
        }

        staleAccessories = staleAccessories.filter(
          accessory => !isOnAccount(confirmedDevices, accessory));
      }

      for (const cachedAccessory of staleAccessories) {
        // This cached device does not exist on the Smart App account (anymore).
        const guid = cachedAccessory.context.device?.GWID;
        this.log.info(`Removing accessory '${cachedAccessory.displayName}' (${guid}) `
          + 'because it does not exist on the Smart App account (anymore?).');

        this.handlers.get(cachedAccessory.UUID)?.dispose();
        this.handlers.delete(cachedAccessory.UUID);

        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);

        const index = this.accessories.indexOf(cachedAccessory);
        if (index !== -1) {
          this.accessories.splice(index, 1);
        }
      }
    } catch (error) {
      this.log.error(error);
    }
  }

  createPanasonicAccessory(
    deviceType: string,
    platform: PanasonicPlatform,
    accessory: PlatformAccessory<PanasonicAccessoryContext>) {

    // Replace any existing handler for this accessory (e.g. on cache restore) and stop its timer.
    this.handlers.get(accessory.UUID)?.dispose();

    let handler: { dispose(): void } | undefined;

    switch (deviceType) {
      case SupportDeviceType.Dehumidifier:
        handler = new DehumidifierAccessory(platform, accessory);
        break;
      case SupportDeviceType.Climate:
        handler = new ClimateAccessory(platform, accessory);
        break;
      case SupportDeviceType.AirPurifier:
        handler = new AirPurifierAccessory(platform, accessory);
        break;
      default:
        this.log.info(`Skipping unsupported deviceType: '${deviceType}' `);
    }

    if (handler) {
      this.handlers.set(accessory.UUID, handler);
    }
  }

}
