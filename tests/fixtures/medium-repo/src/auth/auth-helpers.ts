import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthHelpersId = string;

export interface AuthHelpers {
  id: AuthHelpersId;
  name: string;
  active: boolean;
}

export enum AuthHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthHelpers(id: AuthHelpersId, name: string): AuthHelpers {
  return { id, name, active: true };
}

export class AuthHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: AuthHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthHelpersStore {
  private readonly items = new Map<AuthHelpersId, AuthHelpers>();
  put(item: AuthHelpers): void { this.items.set(item.id, item); }
  get(id: AuthHelpersId): AuthHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_HELPERS_FLAG = true;
export const auth_helpers_limit = 100;
export const auth_helpers_prefix = 'auth-helpers';
