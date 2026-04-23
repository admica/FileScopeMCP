import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiBaseId = string;

export interface ApiBase {
  id: ApiBaseId;
  name: string;
  active: boolean;
}

export enum ApiBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiBase(id: ApiBaseId, name: string): ApiBase {
  return { id, name, active: true };
}

export class ApiBaseService {
  constructor(private readonly prefix: string) {}
  label(id: ApiBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiBaseStore {
  private readonly items = new Map<ApiBaseId, ApiBase>();
  put(item: ApiBase): void { this.items.set(item.id, item); }
  get(id: ApiBaseId): ApiBase | undefined { return this.items.get(id); }
}

export const DEFAULT_API_BASE_FLAG = true;
export const api_base_limit = 100;
export const api_base_prefix = 'api-base';
