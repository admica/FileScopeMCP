import { log } from '../utils/util.js';

export type HookTypesId = string;

export interface HookTypes {
  id: HookTypesId;
  name: string;
  active: boolean;
}

export enum HookTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookTypes(id: HookTypesId, name: string): HookTypes {
  return { id, name, active: true };
}

export class HookTypesService {
  constructor(private readonly prefix: string) {}
  label(id: HookTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class HookTypesStore {
  private readonly items = new Map<HookTypesId, HookTypes>();
  put(item: HookTypes): void { this.items.set(item.id, item); }
  get(id: HookTypesId): HookTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_TYPES_FLAG = true;
export const hooks_types_limit = 100;
export const hooks_types_prefix = 'hooks-types';
