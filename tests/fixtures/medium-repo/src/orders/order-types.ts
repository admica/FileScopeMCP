import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderTypesId = string;

export interface OrderTypes {
  id: OrderTypesId;
  name: string;
  active: boolean;
}

export enum OrderTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderTypes(id: OrderTypesId, name: string): OrderTypes {
  return { id, name, active: true };
}

export class OrderTypesService {
  constructor(private readonly prefix: string) {}
  label(id: OrderTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderTypesStore {
  private readonly items = new Map<OrderTypesId, OrderTypes>();
  put(item: OrderTypes): void { this.items.set(item.id, item); }
  get(id: OrderTypesId): OrderTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_TYPES_FLAG = true;
export const orders_types_limit = 100;
export const orders_types_prefix = 'orders-types';
