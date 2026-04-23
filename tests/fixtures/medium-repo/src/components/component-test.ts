import type { Hook } from '../hooks/hook.js';
import { log } from '../utils/util.js';

export type ComponentTestId = string;

export interface ComponentTest {
  id: ComponentTestId;
  name: string;
  active: boolean;
}

export enum ComponentTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeComponentTest(id: ComponentTestId, name: string): ComponentTest {
  return { id, name, active: true };
}

export class ComponentTestService {
  constructor(private readonly prefix: string) {}
  label(id: ComponentTestId): string {
    return this.prefix + ':' + id;
  }
}

export class ComponentTestStore {
  private readonly items = new Map<ComponentTestId, ComponentTest>();
  put(item: ComponentTest): void { this.items.set(item.id, item); }
  get(id: ComponentTestId): ComponentTest | undefined { return this.items.get(id); }
}

export const DEFAULT_COMPONENTS_TEST_FLAG = true;
export const components_test_limit = 100;
export const components_test_prefix = 'components-test';
