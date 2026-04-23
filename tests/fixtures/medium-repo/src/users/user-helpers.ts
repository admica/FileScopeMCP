import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserHelpersId = string;

export interface UserHelpers {
  id: UserHelpersId;
  name: string;
  active: boolean;
}

export enum UserHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserHelpers(id: UserHelpersId, name: string): UserHelpers {
  return { id, name, active: true };
}

export class UserHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: UserHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class UserHelpersStore {
  private readonly items = new Map<UserHelpersId, UserHelpers>();
  put(item: UserHelpers): void { this.items.set(item.id, item); }
  get(id: UserHelpersId): UserHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_HELPERS_FLAG = true;
export const users_helpers_limit = 100;
export const users_helpers_prefix = 'users-helpers';
