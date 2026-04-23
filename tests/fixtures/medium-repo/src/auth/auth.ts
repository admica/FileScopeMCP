import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthBaseId = string;

export interface AuthBase {
  id: AuthBaseId;
  name: string;
  active: boolean;
}

export enum AuthBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthBase(id: AuthBaseId, name: string): AuthBase {
  return { id, name, active: true };
}

export class AuthBaseService {
  constructor(private readonly prefix: string) {}
  label(id: AuthBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthBaseStore {
  private readonly items = new Map<AuthBaseId, AuthBase>();
  put(item: AuthBase): void { this.items.set(item.id, item); }
  get(id: AuthBaseId): AuthBase | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_BASE_FLAG = true;
export const auth_base_limit = 100;
export const auth_base_prefix = 'auth-base';
