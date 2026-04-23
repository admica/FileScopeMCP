import { log } from '../utils/util.js';

export type HookApiId = string;

export interface HookApi {
  id: HookApiId;
  name: string;
  active: boolean;
}

export enum HookApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookApi(id: HookApiId, name: string): HookApi {
  return { id, name, active: true };
}

export class HookApiService {
  constructor(private readonly prefix: string) {}
  label(id: HookApiId): string {
    return this.prefix + ':' + id;
  }
}

export class HookApiStore {
  private readonly items = new Map<HookApiId, HookApi>();
  put(item: HookApi): void { this.items.set(item.id, item); }
  get(id: HookApiId): HookApi | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_API_FLAG = true;
export const hooks_api_limit = 100;
export const hooks_api_prefix = 'hooks-api';
