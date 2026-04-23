import type { User } from '../users/user.js';
import { log } from '../utils/util.js';

export type AuthMapperId = string;

export interface AuthMapper {
  id: AuthMapperId;
  name: string;
  active: boolean;
}

export enum AuthMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeAuthMapper(id: AuthMapperId, name: string): AuthMapper {
  return { id, name, active: true };
}

export class AuthMapperService {
  constructor(private readonly prefix: string) {}
  label(id: AuthMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class AuthMapperStore {
  private readonly items = new Map<AuthMapperId, AuthMapper>();
  put(item: AuthMapper): void { this.items.set(item.id, item); }
  get(id: AuthMapperId): AuthMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_AUTH_MAPPER_FLAG = true;
export const auth_mapper_limit = 100;
export const auth_mapper_prefix = 'auth-mapper';
