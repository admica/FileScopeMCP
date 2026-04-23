import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthUtilsId = string;

export interface AuthUtils {
  id: AuthUtilsId;
  name: string;
  active: boolean;
}

export enum AuthUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthUtils(id: AuthUtilsId, name: string): AuthUtils {
  return { id, name, active: true };
}

export class AuthUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: AuthUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthUtilsStore {
  private readonly items = new Map<AuthUtilsId, AuthUtils>();
  put(item: AuthUtils): void { this.items.set(item.id, item); }
  get(id: AuthUtilsId): AuthUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_UTILS_FLAG = true;
export const auth_utils_limit = 100;
export const auth_utils_prefix = 'auth-utils';
