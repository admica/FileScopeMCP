import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderUtilsId = string;

export interface OrderUtils {
  id: OrderUtilsId;
  name: string;
  active: boolean;
}

export enum OrderUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderUtils(id: OrderUtilsId, name: string): OrderUtils {
  return { id, name, active: true };
}

export class OrderUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: OrderUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderUtilsStore {
  private readonly items = new Map<OrderUtilsId, OrderUtils>();
  put(item: OrderUtils): void { this.items.set(item.id, item); }
  get(id: OrderUtilsId): OrderUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_UTILS_FLAG = true;
export const orders_utils_limit = 100;
export const orders_utils_prefix = 'orders-utils';
