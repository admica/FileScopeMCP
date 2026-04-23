import { log } from '../utils/util.js';

export type HookBaseId = string;

export interface HookBase {
  id: HookBaseId;
  name: string;
  active: boolean;
}

export enum HookBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookBase(id: HookBaseId, name: string): HookBase {
  return { id, name, active: true };
}

export class HookBaseService {
  constructor(private readonly prefix: string) {}
  label(id: HookBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class HookBaseStore {
  private readonly items = new Map<HookBaseId, HookBase>();
  put(item: HookBase): void { this.items.set(item.id, item); }
  get(id: HookBaseId): HookBase | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_BASE_FLAG = true;
export const hooks_base_limit = 100;
export const hooks_base_prefix = 'hooks-base';
