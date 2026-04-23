import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiValidatorId = string;

export interface ApiValidator {
  id: ApiValidatorId;
  name: string;
  active: boolean;
}

export enum ApiValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiValidator(id: ApiValidatorId, name: string): ApiValidator {
  return { id, name, active: true };
}

export class ApiValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: ApiValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiValidatorStore {
  private readonly items = new Map<ApiValidatorId, ApiValidator>();
  put(item: ApiValidator): void { this.items.set(item.id, item); }
  get(id: ApiValidatorId): ApiValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_API_VALIDATOR_FLAG = true;
export const api_validator_limit = 100;
export const api_validator_prefix = 'api-validator';
