import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentValidatorId = string;

export interface ComponentValidator {
  id: ComponentValidatorId;
  name: string;
  active: boolean;
}

export enum ComponentValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentValidator(id: ComponentValidatorId, name: string): ComponentValidator {
  return { id, name, active: true };
}

export class ComponentValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentValidatorStore {
  private readonly items = new Map<ComponentValidatorId, ComponentValidator>();
  put(item: ComponentValidator): void { this.items.set(item.id, item); }
  get(id: ComponentValidatorId): ComponentValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_VALIDATOR_FLAG = true;
export const components_validator_limit = 100;
export const components_validator_prefix = 'components-validator';
