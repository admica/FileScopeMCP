import { log } from '../utils/util.js';

export type DbStoreId = string;

export interface DbStore {
  id: DbStoreId;
  name: string;
  active: boolean;
}

export enum DbStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbStore(id: DbStoreId, name: string): DbStore {
  return { id, name, active: true };
}

export class DbStoreService {
  constructor(private readonly prefix: string) {}
  label(id: DbStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class DbStoreStore {
  private readonly items = new Map<DbStoreId, DbStore>();
  put(item: DbStore): void { this.items.set(item.id, item); }
  get(id: DbStoreId): DbStore | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_STORE_FLAG = true;
export const db_store_limit = 100;
export const db_store_prefix = 'db-store';
