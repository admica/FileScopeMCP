import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentApiId = string;

export interface ComponentApi {
  id: ComponentApiId;
  name: string;
  active: boolean;
}

export enum ComponentApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentApi(id: ComponentApiId, name: string): ComponentApi {
  return { id, name, active: true };
}

export class ComponentApiService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentApiId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentApiStore {
  private readonly items = new Map<ComponentApiId, ComponentApi>();
  put(item: ComponentApi): void { this.items.set(item.id, item); }
  get(id: ComponentApiId): ComponentApi | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_API_FLAG = true;
export const components_api_limit = 100;
export const components_api_prefix = 'components-api';
