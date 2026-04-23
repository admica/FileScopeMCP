import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserTypesId = string;

export interface UserTypes {
  id: UserTypesId;
  name: string;
  active: boolean;
}

export enum UserTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserTypes(id: UserTypesId, name: string): UserTypes {
  return { id, name, active: true };
}

export class UserTypesService {
  constructor(private readonly prefix: string) {}
  label(id: UserTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class UserTypesStore {
  private readonly items = new Map<UserTypesId, UserTypes>();
  put(item: UserTypes): void { this.items.set(item.id, item); }
  get(id: UserTypesId): UserTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_TYPES_FLAG = true;
export const users_types_limit = 100;
export const users_types_prefix = 'users-types';
