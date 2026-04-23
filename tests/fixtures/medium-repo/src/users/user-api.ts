import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserApiId = string;

export interface UserApi {
  id: UserApiId;
  name: string;
  active: boolean;
}

export enum UserApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserApi(id: UserApiId, name: string): UserApi {
  return { id, name, active: true };
}

export class UserApiService {
  constructor(private readonly prefix: string) {}
  label(id: UserApiId): string {
    return this.prefix + ':' + id;
  }
}

export class UserApiStore {
  private readonly items = new Map<UserApiId, UserApi>();
  put(item: UserApi): void { this.items.set(item.id, item); }
  get(id: UserApiId): UserApi | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_API_FLAG = true;
export const users_api_limit = 100;
export const users_api_prefix = 'users-api';
