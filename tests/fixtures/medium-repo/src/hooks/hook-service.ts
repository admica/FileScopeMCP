import { log } from '../utils/util.js';

export type HookServiceId = string;

export interface HookService {
  id: HookServiceId;
  name: string;
  active: boolean;
}

export enum HookServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookService(id: HookServiceId, name: string): HookService {
  return { id, name, active: true };
}

export class HookServiceService {
  constructor(private readonly prefix: string) {}
  label(id: HookServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class HookServiceStore {
  private readonly items = new Map<HookServiceId, HookService>();
  put(item: HookService): void { this.items.set(item.id, item); }
  get(id: HookServiceId): HookService | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_SERVICE_FLAG = true;
export const hooks_service_limit = 100;
export const hooks_service_prefix = 'hooks-service';
