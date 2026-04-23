import { log } from '../utils/util.js';

export type DbValidatorId = string;

export interface DbValidator {
  id: DbValidatorId;
  name: string;
  active: boolean;
}

export enum DbValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeDbValidator(id: DbValidatorId, name: string): DbValidator {
  return { id, name, active: true };
}

export class DbValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: DbValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class DbValidatorStore {
  private readonly items = new Map<DbValidatorId, DbValidator>();
  put(item: DbValidator): void { this.items.set(item.id, item); }
  get(id: DbValidatorId): DbValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_DB_VALIDATOR_FLAG = true;
export const db_validator_limit = 100;
export const db_validator_prefix = 'db-validator';
