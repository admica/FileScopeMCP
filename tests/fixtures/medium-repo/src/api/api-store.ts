import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiStoreId = string;

export interface ApiStore {
  id: ApiStoreId;
  name: string;
  active: boolean;
}

export enum ApiStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiStore(id: ApiStoreId, name: string): ApiStore {
  return { id, name, active: true };
}

export class ApiStoreService {
  constructor(private readonly prefix: string) {}
  label(id: ApiStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiStoreStore {
  private readonly items = new Map<ApiStoreId, ApiStore>();
  put(item: ApiStore): void { this.items.set(item.id, item); }
  get(id: ApiStoreId): ApiStore | undefined { return this.items.get(id); }
}

export const DEFAULT_API_STORE_FLAG = true;
export const api_store_limit = 100;
export const api_store_prefix = 'api-store';
