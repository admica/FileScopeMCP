import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentMapperId = string;

export interface ComponentMapper {
  id: ComponentMapperId;
  name: string;
  active: boolean;
}

export enum ComponentMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentMapper(id: ComponentMapperId, name: string): ComponentMapper {
  return { id, name, active: true };
}

export class ComponentMapperService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentMapperStore {
  private readonly items = new Map<ComponentMapperId, ComponentMapper>();
  put(item: ComponentMapper): void { this.items.set(item.id, item); }
  get(id: ComponentMapperId): ComponentMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_MAPPER_FLAG = true;
export const components_mapper_limit = 100;
export const components_mapper_prefix = 'components-mapper';
