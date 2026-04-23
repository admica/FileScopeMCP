import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderHelpersId = string;

export interface OrderHelpers {
  id: OrderHelpersId;
  name: string;
  active: boolean;
}

export enum OrderHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderHelpers(id: OrderHelpersId, name: string): OrderHelpers {
  return { id, name, active: true };
}

export class OrderHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: OrderHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderHelpersStore {
  private readonly items = new Map<OrderHelpersId, OrderHelpers>();
  put(item: OrderHelpers): void { this.items.set(item.id, item); }
  get(id: OrderHelpersId): OrderHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_HELPERS_FLAG = true;
export const orders_helpers_limit = 100;
export const orders_helpers_prefix = 'orders-helpers';
