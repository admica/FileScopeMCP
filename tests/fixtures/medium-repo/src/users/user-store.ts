import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserStoreId = string;

export interface UserStore {
  id: UserStoreId;
  name: string;
  active: boolean;
}

export enum UserStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserStore(id: UserStoreId, name: string): UserStore {
  return { id, name, active: true };
}

export class UserStoreService {
  constructor(private readonly prefix: string) {}
  label(id: UserStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class UserStoreStore {
  private readonly items = new Map<UserStoreId, UserStore>();
  put(item: UserStore): void { this.items.set(item.id, item); }
  get(id: UserStoreId): UserStore | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_STORE_FLAG = true;
export const users_store_limit = 100;
export const users_store_prefix = 'users-store';
