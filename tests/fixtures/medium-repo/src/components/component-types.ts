import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentTypesId = string;

export interface ComponentTypes {
  id: ComponentTypesId;
  name: string;
  active: boolean;
}

export enum ComponentTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentTypes(id: ComponentTypesId, name: string): ComponentTypes {
  return { id, name, active: true };
}

export class ComponentTypesService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentTypesStore {
  private readonly items = new Map<ComponentTypesId, ComponentTypes>();
  put(item: ComponentTypes): void { this.items.set(item.id, item); }
  get(id: ComponentTypesId): ComponentTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_TYPES_FLAG = true;
export const components_types_limit = 100;
export const components_types_prefix = 'components-types';
