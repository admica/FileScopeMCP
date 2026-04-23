import { log } from '../utils/util.js';

export type HookHelpersId = string;

export interface HookHelpers {
  id: HookHelpersId;
  name: string;
  active: boolean;
}

export enum HookHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookHelpers(id: HookHelpersId, name: string): HookHelpers {
  return { id, name, active: true };
}

export class HookHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: HookHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class HookHelpersStore {
  private readonly items = new Map<HookHelpersId, HookHelpers>();
  put(item: HookHelpers): void { this.items.set(item.id, item); }
  get(id: HookHelpersId): HookHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_HELPERS_FLAG = true;
export const hooks_helpers_limit = 100;
export const hooks_helpers_prefix = 'hooks-helpers';
