import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderStoreId = string;

export interface OrderStore {
  id: OrderStoreId;
  name: string;
  active: boolean;
}

export enum OrderStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderStore(id: OrderStoreId, name: string): OrderStore {
  return { id, name, active: true };
}

export class OrderStoreService {
  constructor(private readonly prefix: string) {}
  label(id: OrderStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderStoreStore {
  private readonly items = new Map<OrderStoreId, OrderStore>();
  put(item: OrderStore): void { this.items.set(item.id, item); }
  get(id: OrderStoreId): OrderStore | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_STORE_FLAG = true;
export const orders_store_limit = 100;
export const orders_store_prefix = 'orders-store';
