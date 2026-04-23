import { log } from '../utils/util.js';

export type DbTestId = string;

export interface DbTest {
  id: DbTestId;
  name: string;
  active: boolean;
}

export enum DbTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbTest(id: DbTestId, name: string): DbTest {
  return { id, name, active: true };
}

export class DbTestService {
  constructor(private readonly prefix: string) {}
  label(id: DbTestId): string {
    return this.prefix + ':' + id;
  }
}

export class DbTestStore {
  private readonly items = new Map<DbTestId, DbTest>();
  put(item: DbTest): void { this.items.set(item.id, item); }
  get(id: DbTestId): DbTest | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_TEST_FLAG = true;
export const db_test_limit = 100;
export const db_test_prefix = 'db-test';
