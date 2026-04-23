import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentUtilsId = string;

export interface ComponentUtils {
  id: ComponentUtilsId;
  name: string;
  active: boolean;
}

export enum ComponentUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentUtils(id: ComponentUtilsId, name: string): ComponentUtils {
  return { id, name, active: true };
}

export class ComponentUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentUtilsStore {
  private readonly items = new Map<ComponentUtilsId, ComponentUtils>();
  put(item: ComponentUtils): void { this.items.set(item.id, item); }
  get(id: ComponentUtilsId): ComponentUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_UTILS_FLAG = true;
export const components_utils_limit = 100;
export const components_utils_prefix = 'components-utils';
