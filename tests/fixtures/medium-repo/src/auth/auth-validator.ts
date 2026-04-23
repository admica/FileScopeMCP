import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthValidatorId = string;

export interface AuthValidator {
  id: AuthValidatorId;
  name: string;
  active: boolean;
}

export enum AuthValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthValidator(id: AuthValidatorId, name: string): AuthValidator {
  return { id, name, active: true };
}

export class AuthValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: AuthValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthValidatorStore {
  private readonly items = new Map<AuthValidatorId, AuthValidator>();
  put(item: AuthValidator): void { this.items.set(item.id, item); }
  get(id: AuthValidatorId): AuthValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_VALIDATOR_FLAG = true;
export const auth_validator_limit = 100;
export const auth_validator_prefix = 'auth-validator';
