import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthApiId = string;

export interface AuthApi {
  id: AuthApiId;
  name: string;
  active: boolean;
}

export enum AuthApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthApi(id: AuthApiId, name: string): AuthApi {
  return { id, name, active: true };
}

export class AuthApiService {
  constructor(private readonly prefix: string) {}
  label(id: AuthApiId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthApiStore {
  private readonly items = new Map<AuthApiId, AuthApi>();
  put(item: AuthApi): void { this.items.set(item.id, item); }
  get(id: AuthApiId): AuthApi | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_API_FLAG = true;
export const auth_api_limit = 100;
export const auth_api_prefix = 'auth-api';
