import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderMapperId = string;

export interface OrderMapper {
  id: OrderMapperId;
  name: string;
  active: boolean;
}

export enum OrderMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderMapper(id: OrderMapperId, name: string): OrderMapper {
  return { id, name, active: true };
}

export class OrderMapperService {
  constructor(private readonly prefix: string) {}
  label(id: OrderMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderMapperStore {
  private readonly items = new Map<OrderMapperId, OrderMapper>();
  put(item: OrderMapper): void { this.items.set(item.id, item); }
  get(id: OrderMapperId): OrderMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_MAPPER_FLAG = true;
export const orders_mapper_limit = 100;
export const orders_mapper_prefix = 'orders-mapper';
