import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderApiId = string;

export interface OrderApi {
  id: OrderApiId;
  name: string;
  active: boolean;
}

export enum OrderApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderApi(id: OrderApiId, name: string): OrderApi {
  return { id, name, active: true };
}

export class OrderApiService {
  constructor(private readonly prefix: string) {}
  label(id: OrderApiId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderApiStore {
  private readonly items = new Map<OrderApiId, OrderApi>();
  put(item: OrderApi): void { this.items.set(item.id, item); }
  get(id: OrderApiId): OrderApi | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_API_FLAG = true;
export const orders_api_limit = 100;
export const orders_api_prefix = 'orders-api';
