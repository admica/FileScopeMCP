import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserServiceId = string;

export interface UserService {
  id: UserServiceId;
  name: string;
  active: boolean;
}

export enum UserServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserService(id: UserServiceId, name: string): UserService {
  return { id, name, active: true };
}

export class UserServiceService {
  constructor(private readonly prefix: string) {}
  label(id: UserServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class UserServiceStore {
  private readonly items = new Map<UserServiceId, UserService>();
  put(item: UserService): void { this.items.set(item.id, item); }
  get(id: UserServiceId): UserService | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_SERVICE_FLAG = true;
export const users_service_limit = 100;
export const users_service_prefix = 'users-service';
