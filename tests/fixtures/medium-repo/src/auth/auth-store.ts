import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthStoreId = string;

export interface AuthStore {
  id: AuthStoreId;
  name: string;
  active: boolean;
}

export enum AuthStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthStore(id: AuthStoreId, name: string): AuthStore {
  return { id, name, active: true };
}

export class AuthStoreService {
  constructor(private readonly prefix: string) {}
  label(id: AuthStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthStoreStore {
  private readonly items = new Map<AuthStoreId, AuthStore>();
  put(item: AuthStore): void { this.items.set(item.id, item); }
  get(id: AuthStoreId): AuthStore | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_STORE_FLAG = true;
export const auth_store_limit = 100;
export const auth_store_prefix = 'auth-store';
