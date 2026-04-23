import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthTypesId = string;

export interface AuthTypes {
  id: AuthTypesId;
  name: string;
  active: boolean;
}

export enum AuthTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthTypes(id: AuthTypesId, name: string): AuthTypes {
  return { id, name, active: true };
}

export class AuthTypesService {
  constructor(private readonly prefix: string) {}
  label(id: AuthTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthTypesStore {
  private readonly items = new Map<AuthTypesId, AuthTypes>();
  put(item: AuthTypes): void { this.items.set(item.id, item); }
  get(id: AuthTypesId): AuthTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_TYPES_FLAG = true;
export const auth_types_limit = 100;
export const auth_types_prefix = 'auth-types';
