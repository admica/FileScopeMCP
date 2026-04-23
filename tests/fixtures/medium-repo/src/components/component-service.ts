import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentServiceId = string;

export interface ComponentService {
  id: ComponentServiceId;
  name: string;
  active: boolean;
}

export enum ComponentServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentService(id: ComponentServiceId, name: string): ComponentService {
  return { id, name, active: true };
}

export class ComponentServiceService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentServiceStore {
  private readonly items = new Map<ComponentServiceId, ComponentService>();
  put(item: ComponentService): void { this.items.set(item.id, item); }
  get(id: ComponentServiceId): ComponentService | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_SERVICE_FLAG = true;
export const components_service_limit = 100;
export const components_service_prefix = 'components-service';
