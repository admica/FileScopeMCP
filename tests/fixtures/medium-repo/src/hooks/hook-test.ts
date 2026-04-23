import { log } from '../utils/util.js';

export type HookTestId = string;

export interface HookTest {
  id: HookTestId;
  name: string;
  active: boolean;
}

export enum HookTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeHookTest(id: HookTestId, name: string): HookTest {
  return { id, name, active: true };
}

export class HookTestService {
  constructor(private readonly prefix: string) {}
  label(id: HookTestId): string {
    return this.prefix + ':' + id;
  }
}

export class HookTestStore {
  private readonly items = new Map<HookTestId, HookTest>();
  put(item: HookTest): void { this.items.set(item.id, item); }
  get(id: HookTestId): HookTest | undefined { return this.items.get(id); }
}

export const DEFAULT_HOOKS_TEST_FLAG = true;
export const hooks_test_limit = 100;
export const hooks_test_prefix = 'hooks-test';
