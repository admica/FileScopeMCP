import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthTestId = string;

export interface AuthTest {
  id: AuthTestId;
  name: string;
  active: boolean;
}

export enum AuthTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthTest(id: AuthTestId, name: string): AuthTest {
  return { id, name, active: true };
}

export class AuthTestService {
  constructor(private readonly prefix: string) {}
  label(id: AuthTestId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthTestStore {
  private readonly items = new Map<AuthTestId, AuthTest>();
  put(item: AuthTest): void { this.items.set(item.id, item); }
  get(id: AuthTestId): AuthTest | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_TEST_FLAG = true;
export const auth_test_limit = 100;
export const auth_test_prefix = 'auth-test';
