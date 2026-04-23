import { log } from '../utils/util.js';

export type HookMapperId = string;

export interface HookMapper {
  id: HookMapperId;
  name: string;
  active: boolean;
}

export enum HookMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookMapper(id: HookMapperId, name: string): HookMapper {
  return { id, name, active: true };
}

export class HookMapperService {
  constructor(private readonly prefix: string) {}
  label(id: HookMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class HookMapperStore {
  private readonly items = new Map<HookMapperId, HookMapper>();
  put(item: HookMapper): void { this.items.set(item.id, item); }
  get(id: HookMapperId): HookMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_MAPPER_FLAG = true;
export const hooks_mapper_limit = 100;
export const hooks_mapper_prefix = 'hooks-mapper';
