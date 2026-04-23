import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentBaseId = string;

export interface ComponentBase {
  id: ComponentBaseId;
  name: string;
  active: boolean;
}

export enum ComponentBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentBase(id: ComponentBaseId, name: string): ComponentBase {
  return { id, name, active: true };
}

export class ComponentBaseService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentBaseStore {
  private readonly items = new Map<ComponentBaseId, ComponentBase>();
  put(item: ComponentBase): void { this.items.set(item.id, item); }
  get(id: ComponentBaseId): ComponentBase | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_BASE_FLAG = true;
export const components_base_limit = 100;
export const components_base_prefix = 'components-base';
