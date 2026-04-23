import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderBaseId = string;

export interface OrderBase {
  id: OrderBaseId;
  name: string;
  active: boolean;
}

export enum OrderBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderBase(id: OrderBaseId, name: string): OrderBase {
  return { id, name, active: true };
}

export class OrderBaseService {
  constructor(private readonly prefix: string) {}
  label(id: OrderBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderBaseStore {
  private readonly items = new Map<OrderBaseId, OrderBase>();
  put(item: OrderBase): void { this.items.set(item.id, item); }
  get(id: OrderBaseId): OrderBase | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_BASE_FLAG = true;
export const orders_base_limit = 100;
export const orders_base_prefix = 'orders-base';
