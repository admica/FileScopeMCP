import { log } from '../utils/util.js';

export type HookUtilsId = string;

export interface HookUtils {
  id: HookUtilsId;
  name: string;
  active: boolean;
}

export enum HookUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookUtils(id: HookUtilsId, name: string): HookUtils {
  return { id, name, active: true };
}

export class HookUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: HookUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class HookUtilsStore {
  private readonly items = new Map<HookUtilsId, HookUtils>();
  put(item: HookUtils): void { this.items.set(item.id, item); }
  get(id: HookUtilsId): HookUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_UTILS_FLAG = true;
export const hooks_utils_limit = 100;
export const hooks_utils_prefix = 'hooks-utils';
