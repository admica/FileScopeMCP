import { log } from '../utils/util.js';

export type DbMapperId = string;

export interface DbMapper {
  id: DbMapperId;
  name: string;
  active: boolean;
}

export enum DbMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbMapper(id: DbMapperId, name: string): DbMapper {
  return { id, name, active: true };
}

export class DbMapperService {
  constructor(private readonly prefix: string) {}
  label(id: DbMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class DbMapperStore {
  private readonly items = new Map<DbMapperId, DbMapper>();
  put(item: DbMapper): void { this.items.set(item.id, item); }
  get(id: DbMapperId): DbMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_MAPPER_FLAG = true;
export const db_mapper_limit = 100;
export const db_mapper_prefix = 'db-mapper';
