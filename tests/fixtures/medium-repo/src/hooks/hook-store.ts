import { log } from '../utils/util.js';

export type HookStoreId = string;

export interface HookStore {
  id: HookStoreId;
  name: string;
  active: boolean;
}

export enum HookStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookStore(id: HookStoreId, name: string): HookStore {
  return { id, name, active: true };
}

export class HookStoreService {
  constructor(private readonly prefix: string) {}
  label(id: HookStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class HookStoreStore {
  private readonly items = new Map<HookStoreId, HookStore>();
  put(item: HookStore): void { this.items.set(item.id, item); }
  get(id: HookStoreId): HookStore | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_STORE_FLAG = true;
export const hooks_store_limit = 100;
export const hooks_store_prefix = 'hooks-store';
