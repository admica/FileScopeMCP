export type UtilTestId = string;

export interface UtilTest {
  id: UtilTestId;
  name: string;
  active: boolean;
}

export enum UtilTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilTest(id: UtilTestId, name: string): UtilTest {
  return { id, name, active: true };
}

export class UtilTestService {
  constructor(private readonly prefix: string) {}
  label(id: UtilTestId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilTestStore {
  private readonly items = new Map<UtilTestId, UtilTest>();
  put(item: UtilTest): void { this.items.set(item.id, item); }
  get(id: UtilTestId): UtilTest | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_TEST_FLAG = true;
export const utils_test_limit = 100;
export const utils_test_prefix = 'utils-test';
