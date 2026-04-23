import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentHelpersId = string;

export interface ComponentHelpers {
  id: ComponentHelpersId;
  name: string;
  active: boolean;
}

export enum ComponentHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentHelpers(id: ComponentHelpersId, name: string): ComponentHelpers {
  return { id, name, active: true };
}

export class ComponentHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentHelpersStore {
  private readonly items = new Map<ComponentHelpersId, ComponentHelpers>();
  put(item: ComponentHelpers): void { this.items.set(item.id, item); }
  get(id: ComponentHelpersId): ComponentHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_HELPERS_FLAG = true;
export const components_helpers_limit = 100;
export const components_helpers_prefix = 'components-helpers';
