import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderServiceId = string;

export interface OrderService {
  id: OrderServiceId;
  name: string;
  active: boolean;
}

export enum OrderServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderService(id: OrderServiceId, name: string): OrderService {
  return { id, name, active: true };
}

export class OrderServiceService {
  constructor(private readonly prefix: string) {}
  label(id: OrderServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderServiceStore {
  private readonly items = new Map<OrderServiceId, OrderService>();
  put(item: OrderService): void { this.items.set(item.id, item); }
  get(id: OrderServiceId): OrderService | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_SERVICE_FLAG = true;
export const orders_service_limit = 100;
export const orders_service_prefix = 'orders-service';
