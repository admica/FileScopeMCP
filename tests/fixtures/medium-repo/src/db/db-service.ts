import { log } from '../utils/util.js';

export type DbServiceId = string;

export interface DbService {
  id: DbServiceId;
  name: string;
  active: boolean;
}

export enum DbServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbService(id: DbServiceId, name: string): DbService {
  return { id, name, active: true };
}

export class DbServiceService {
  constructor(private readonly prefix: string) {}
  label(id: DbServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class DbServiceStore {
  private readonly items = new Map<DbServiceId, DbService>();
  put(item: DbService): void { this.items.set(item.id, item); }
  get(id: DbServiceId): DbService | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_SERVICE_FLAG = true;
export const db_service_limit = 100;
export const db_service_prefix = 'db-service';
