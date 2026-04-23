import { log } from '../utils/util.js';

export type DbBaseId = string;

export interface DbBase {
  id: DbBaseId;
  name: string;
  active: boolean;
}

export enum DbBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbBase(id: DbBaseId, name: string): DbBase {
  return { id, name, active: true };
}

export class DbBaseService {
  constructor(private readonly prefix: string) {}
  label(id: DbBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class DbBaseStore {
  private readonly items = new Map<DbBaseId, DbBase>();
  put(item: DbBase): void { this.items.set(item.id, item); }
  get(id: DbBaseId): DbBase | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_BASE_FLAG = true;
export const db_base_limit = 100;
export const db_base_prefix = 'db-base';
