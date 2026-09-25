import { statusKey } from '../taiseia';
import { SmartAppCommand } from '../types';

/**
 * A device's fan speeds as enum values from its CommandList: `auto` (if the
 * device has one) and the manual `steps`, ordered from slowest to fastest.
 */
export interface FanLevels {
  auto?: string;
  steps: string[];
}

// How fast each speed name found in CommandLists is, relative to the others.
// The enum values themselves are not ordered consistently: one dehumidifier
// model lists 急速/標準/靜音 as 1/2/3 and most others list 靜音/標準/急速 as 1/2/3.
const SPEED_RANK: Record<string, number> = {
  '靜音': 10, '微風': 15, '微': 15, '弱': 20, '低': 20, '標準': 50, '中': 50,
  '強': 80, '高': 80, '急速': 100, '最強': 100, '強力': 100,
};
const AUTO_NAME = /自動|auto/i;

/** The code as the status cache keys it: '0x' + two upper-case hex digits. */
export function normalizeCommandType(code: string): string {
  return statusKey(parseInt(code, 16));
}

/** Whether two codes ('0x0F', '0x0f', '0xf') are the same command type. */
export function sameCode(a: string, b: string): boolean {
  const x = parseInt(a, 16), y = parseInt(b, 16);
  return Number.isFinite(x) && x === y;
}

/** The first command whose name matches, optionally restricted to a parameter type. */
export function findCommandByName(
  commands: SmartAppCommand[],
  name: RegExp,
  accept: (command: SmartAppCommand) => boolean = () => true,
): SmartAppCommand | undefined {
  return commands.find((command) => name.test(command.CommandName ?? '') && accept(command));
}

export const isEnum = (command: SmartAppCommand) => command.ParameterType === 'enum'
  && Array.isArray(command.Parameters) && command.Parameters.length > 0;

// A reading has no parameters to choose from (e.g. PM2.5, humidity).
export const isReading = (command: SmartAppCommand) =>
  !command.ParameterType && (!Array.isArray(command.Parameters) || command.Parameters.length === 0);

/**
 * Orders a fan-speed enum from slowest to fastest by the speed names. When a
 * name isn't recognised, the CommandList order (which lists speeds ascending
 * on the models seen so far) is kept as is.
 */
export function fanLevelsFromCommand(command: SmartAppCommand | undefined): FanLevels | undefined {
  if (command === undefined || !isEnum(command)) {
    return undefined;
  }

  let auto: string | undefined;
  const manual: { name: string; value: string }[] = [];
  for (const param of command.Parameters) {
    const name = String(param[0]).trim();
    const value = String(param[1]);
    if (AUTO_NAME.test(name)) {
      auto = value;
    } else {
      manual.push({ name, value });
    }
  }
  if (manual.length === 0) {
    return undefined;
  }

  const rank = (name: string) =>
    SPEED_RANK[name] ?? (/^\d+$/.test(name) ? Number(name) : undefined);
  if (manual.every((level) => rank(level.name) !== undefined)) {
    manual.sort((a, b) => rank(a.name)! - rank(b.name)!);
  }

  return { auto, steps: manual.map((level) => level.value) };
}

/** The Home app percentage for a manual step, or undefined for auto or an unknown value. */
export function fanLevelToPercent(levels: FanLevels, value: string): number | undefined {
  const index = levels.steps.indexOf(value);
  if (index < 0) {
    return undefined;
  }
  return Math.round(((index + 1) * 100) / levels.steps.length);
}

/** The manual step closest to a Home app percentage above zero. */
export function percentToFanLevel(levels: FanLevels, percent: number): string {
  const count = levels.steps.length;
  const index = Math.min(count - 1, Math.max(0, Math.ceil((percent * count) / 100) - 1));
  return levels.steps[index];
}
