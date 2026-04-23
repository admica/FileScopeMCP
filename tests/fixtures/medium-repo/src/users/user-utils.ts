import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserUtilsId = string;

export interface UserUtils {
  id: UserUtilsId;
  name: string;
  active: boolean;
}

export enum UserUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserUtils(id: UserUtilsId, name: string): UserUtils {
  return { id, name, active: true };
}

export class UserUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: UserUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class UserUtilsStore {
  private readonly items = new Map<UserUtilsId, UserUtils>();
  put(item: UserUtils): void { this.items.set(item.id, item); }
  get(id: UserUtilsId): UserUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_UTILS_FLAG = true;
export const users_utils_limit = 100;
export const users_utils_prefix = 'users-utils';
