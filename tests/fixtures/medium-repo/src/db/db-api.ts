import { log } from '../utils/util.js';

export type DbApiId = string;

export interface DbApi {
  id: DbApiId;
  name: string;
  active: boolean;
}

export enum DbApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbApi(id: DbApiId, name: string): DbApi {
  return { id, name, active: true };
}

export class DbApiService {
  constructor(private readonly prefix: string) {}
  label(id: DbApiId): string {
    return this.prefix + ':' + id;
  }
}

export class DbApiStore {
  private readonly items = new Map<DbApiId, DbApi>();
  put(item: DbApi): void { this.items.set(item.id, item); }
  get(id: DbApiId): DbApi | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_API_FLAG = true;
export const db_api_limit = 100;
export const db_api_prefix = 'db-api';
