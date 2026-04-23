import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentStoreId = string;

export interface ComponentStore {
  id: ComponentStoreId;
  name: string;
  active: boolean;
}

export enum ComponentStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentStore(id: ComponentStoreId, name: string): ComponentStore {
  return { id, name, active: true };
}

export class ComponentStoreService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentStoreStore {
  private readonly items = new Map<ComponentStoreId, ComponentStore>();
  put(item: ComponentStore): void { this.items.set(item.id, item); }
  get(id: ComponentStoreId): ComponentStore | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_STORE_FLAG = true;
export const components_store_limit = 100;
export const components_store_prefix = 'components-store';
