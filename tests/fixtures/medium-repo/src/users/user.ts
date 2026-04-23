import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserBaseId = string;

export interface UserBase {
  id: UserBaseId;
  name: string;
  active: boolean;
}

export enum UserBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserBase(id: UserBaseId, name: string): UserBase {
  return { id, name, active: true };
}

export class UserBaseService {
  constructor(private readonly prefix: string) {}
  label(id: UserBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class UserBaseStore {
  private readonly items = new Map<UserBaseId, UserBase>();
  put(item: UserBase): void { this.items.set(item.id, item); }
  get(id: UserBaseId): UserBase | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_BASE_FLAG = true;
export const users_base_limit = 100;
export const users_base_prefix = 'users-base';
