import { log } from '../utils/util.js';

export type DbHelpersId = string;

export interface DbHelpers {
  id: DbHelpersId;
  name: string;
  active: boolean;
}

export enum DbHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbHelpers(id: DbHelpersId, name: string): DbHelpers {
  return { id, name, active: true };
}

export class DbHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: DbHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class DbHelpersStore {
  private readonly items = new Map<DbHelpersId, DbHelpers>();
  put(item: DbHelpers): void { this.items.set(item.id, item); }
  get(id: DbHelpersId): DbHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_HELPERS_FLAG = true;
export const db_helpers_limit = 100;
export const db_helpers_prefix = 'db-helpers';
