import { log } from '../utils/util.js';

export type DbUtilsId = string;

export interface DbUtils {
  id: DbUtilsId;
  name: string;
  active: boolean;
}

export enum DbUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbUtils(id: DbUtilsId, name: string): DbUtils {
  return { id, name, active: true };
}

export class DbUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: DbUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class DbUtilsStore {
  private readonly items = new Map<DbUtilsId, DbUtils>();
  put(item: DbUtils): void { this.items.set(item.id, item); }
  get(id: DbUtilsId): DbUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_UTILS_FLAG = true;
export const db_utils_limit = 100;
export const db_utils_prefix = 'db-utils';
