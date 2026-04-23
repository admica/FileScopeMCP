import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserMapperId = string;

export interface UserMapper {
  id: UserMapperId;
  name: string;
  active: boolean;
}

export enum UserMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserMapper(id: UserMapperId, name: string): UserMapper {
  return { id, name, active: true };
}

export class UserMapperService {
  constructor(private readonly prefix: string) {}
  label(id: UserMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class UserMapperStore {
  private readonly items = new Map<UserMapperId, UserMapper>();
  put(item: UserMapper): void { this.items.set(item.id, item); }
  get(id: UserMapperId): UserMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_MAPPER_FLAG = true;
export const users_mapper_limit = 100;
export const users_mapper_prefix = 'users-mapper';
