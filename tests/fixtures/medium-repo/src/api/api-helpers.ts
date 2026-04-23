import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiHelpersId = string;

export interface ApiHelpers {
  id: ApiHelpersId;
  name: string;
  active: boolean;
}

export enum ApiHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiHelpers(id: ApiHelpersId, name: string): ApiHelpers {
  return { id, name, active: true };
}

export class ApiHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: ApiHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiHelpersStore {
  private readonly items = new Map<ApiHelpersId, ApiHelpers>();
  put(item: ApiHelpers): void { this.items.set(item.id, item); }
  get(id: ApiHelpersId): ApiHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_API_HELPERS_FLAG = true;
export const api_helpers_limit = 100;
export const api_helpers_prefix = 'api-helpers';
