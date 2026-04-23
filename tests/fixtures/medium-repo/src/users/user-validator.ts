import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type UserValidatorId = string;

export interface UserValidator {
  id: UserValidatorId;
  name: string;
  active: boolean;
}

export enum UserValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUserValidator(id: UserValidatorId, name: string): UserValidator {
  return { id, name, active: true };
}

export class UserValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: UserValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class UserValidatorStore {
  private readonly items = new Map<UserValidatorId, UserValidator>();
  put(item: UserValidator): void { this.items.set(item.id, item); }
  get(id: UserValidatorId): UserValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_USERS_VALIDATOR_FLAG = true;
export const users_validator_limit = 100;
export const users_validator_prefix = 'users-validator';
