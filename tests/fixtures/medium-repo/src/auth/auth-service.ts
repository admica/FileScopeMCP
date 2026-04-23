import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthServiceId = string;

export interface AuthService {
  id: AuthServiceId;
  name: string;
  active: boolean;
}

export enum AuthServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthService(id: AuthServiceId, name: string): AuthService {
  return { id, name, active: true };
}

export class AuthServiceService {
  constructor(private readonly prefix: string) {}
  label(id: AuthServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthServiceStore {
  private readonly items = new Map<AuthServiceId, AuthService>();
  put(item: AuthService): void { this.items.set(item.id, item); }
  get(id: AuthServiceId): AuthService | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_SERVICE_FLAG = true;
export const auth_service_limit = 100;
export const auth_service_prefix = 'auth-service';
