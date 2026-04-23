import { log } from '../utils/util.js';

export type HookValidatorId = string;

export interface HookValidator {
  id: HookValidatorId;
  name: string;
  active: boolean;
}

export enum HookValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookValidator(id: HookValidatorId, name: string): HookValidator {
  return { id, name, active: true };
}

export class HookValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: HookValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class HookValidatorStore {
  private readonly items = new Map<HookValidatorId, HookValidator>();
  put(item: HookValidator): void { this.items.set(item.id, item); }
  get(id: HookValidatorId): HookValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_VALIDATOR_FLAG = true;
export const hooks_validator_limit = 100;
export const hooks_validator_prefix = 'hooks-validator';
