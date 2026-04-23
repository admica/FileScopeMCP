import { log } from '../utils/util.js';

export type DbTypesId = string;

export interface DbTypes {
  id: DbTypesId;
  name: string;
  active: boolean;
}

export enum DbTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbTypes(id: DbTypesId, name: string): DbTypes {
  return { id, name, active: true };
}

export class DbTypesService {
  constructor(private readonly prefix: string) {}
  label(id: DbTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class DbTypesStore {
  private readonly items = new Map<DbTypesId, DbTypes>();
  put(item: DbTypes): void { this.items.set(item.id, item); }
  get(id: DbTypesId): DbTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_TYPES_FLAG = true;
export const db_types_limit = 100;
export const db_types_prefix = 'db-types';
