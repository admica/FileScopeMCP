import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserTestId = string;

export interface UserTest {
  id: UserTestId;
  name: string;
  active: boolean;
}

export enum UserTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserTest(id: UserTestId, name: string): UserTest {
  return { id, name, active: true };
}

export class UserTestService {
  constructor(private readonly prefix: string) {}
  label(id: UserTestId): string {
    return this.prefix + ':' + id;
  }
}

export class UserTestStore {
  private readonly items = new Map<UserTestId, UserTest>();
  put(item: UserTest): void { this.items.set(item.id, item); }
  get(id: UserTestId): UserTest | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_TEST_FLAG = true;
export const users_test_limit = 100;
export const users_test_prefix = 'users-test';
