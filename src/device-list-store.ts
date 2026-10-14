import fs from 'fs';
import path from 'path';
import PanasonicPlatformLogger from './logger';
import { SmartAppCommandList, SmartAppDevice } from './types';

export interface StoredDeviceList {
  // The account the list belongs to, so a list isn't reused after the
  // configured email changes.
  email: string;
  devices: SmartAppDevice[];
  commands: Record<string, SmartAppCommandList>;
  // Epoch milliseconds the list was last written (for diagnostics only).
  savedAt: number;
}

/**
 * Persists the last successful device/command list so a transient cloud
 * failure during discovery can still bring up accessories (and local control)
 * from the previous known-good snapshot. Device lists change rarely; Auth on
 * each device may eventually go stale for cloud calls, but LAN control and
 * HomeKit registration only need GWID / ModelType / CommandList.
 */
export class DeviceListStore {
  private readonly filePath: string;
  private readonly enabled: boolean;

  constructor(storagePath: string, private readonly log: PanasonicPlatformLogger) {
    this.enabled = Boolean(storagePath);
    this.filePath = this.enabled
      ? path.join(storagePath, 'panasonic-smart-app-devices.json')
      : '';
  }

  /** Returns the stored list, or undefined if absent, unreadable or invalid. */
  load(email: string): StoredDeviceList | undefined {
    if (!this.enabled || !email) {
      return undefined;
    }
    try {
      if (!fs.existsSync(this.filePath)) {
        return undefined;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (typeof parsed?.email !== 'string'
        || parsed.email.toLowerCase() !== email.toLowerCase()
        || !Array.isArray(parsed?.devices)
        || typeof parsed?.commands !== 'object' || parsed.commands === null
        || Array.isArray(parsed.commands)) {
        this.log.debug('Device list store: stored list is incomplete or for another '
          + 'account - ignoring it.');
        return undefined;
      }
      if (parsed.devices.length === 0) {
        return undefined;
      }
      return {
        email: parsed.email,
        devices: parsed.devices,
        commands: parsed.commands,
        savedAt: Number(parsed.savedAt) || 0,
      };
    } catch (error) {
      this.log.debug('Device list store: failed to read the saved list - '
        + `${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }

  save(list: StoredDeviceList): void {
    if (!this.enabled || list.devices.length === 0) {
      return;
    }
    const tmpPath = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(list), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (error) {
      this.log.debug('Device list store: failed to write the saved list - '
        + `${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
