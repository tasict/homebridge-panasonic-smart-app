import fs from 'fs';
import path from 'path';
import PanasonicPlatformLogger from './logger';

export interface StoredToken {
  // The account the token belongs to, so a token isn't reused after the
  // configured email changes.
  email: string;
  cpToken: string;
  refreshToken: string;
  // Epoch milliseconds the token was last written (for diagnostics only).
  savedAt: number;
}

/**
 * Persists the Smart App session token to disk so a Homebridge restart can
 * reuse it instead of logging in with the email/password again. The token is
 * no more sensitive than the password already stored in `config.json`, but the
 * file is still written owner-only (0600) and atomically (temp file + rename)
 * so a crash mid-write can't leave a corrupt token behind.
 */
export class TokenStore {
  private readonly filePath: string;
  private readonly enabled: boolean;

  constructor(storagePath: string, private readonly log: PanasonicPlatformLogger) {
    this.enabled = Boolean(storagePath);
    this.filePath = this.enabled
      ? path.join(storagePath, 'panasonic-smart-app-session.json')
      : '';
  }

  /** Returns the stored token, or undefined if absent, unreadable or invalid. */
  load(): StoredToken | undefined {
    if (!this.enabled) {
      return undefined;
    }
    try {
      if (!fs.existsSync(this.filePath)) {
        return undefined;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (typeof parsed?.email === 'string'
        && typeof parsed?.cpToken === 'string' && parsed.cpToken
        && typeof parsed?.refreshToken === 'string' && parsed.refreshToken) {
        return {
          email: parsed.email,
          cpToken: parsed.cpToken,
          refreshToken: parsed.refreshToken,
          savedAt: Number(parsed.savedAt) || 0,
        };
      }
      this.log.debug('Token store: stored session is incomplete - ignoring it.');
    } catch (error) {
      this.log.debug('Token store: failed to read the saved session - '
        + `${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }

  save(token: StoredToken): void {
    if (!this.enabled) {
      return;
    }
    const tmpPath = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(token), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (error) {
      this.log.debug('Token store: failed to write the saved session - '
        + `${error instanceof Error ? error.message : String(error)}`);
    }
  }

  clear(): void {
    if (!this.enabled) {
      return;
    }
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch (error) {
      this.log.debug('Token store: failed to remove the saved session - '
        + `${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
