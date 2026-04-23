import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderTestId = string;

export interface OrderTest {
  id: OrderTestId;
  name: string;
  active: boolean;
}

export enum OrderTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderTest(id: OrderTestId, name: string): OrderTest {
  return { id, name, active: true };
}

export class OrderTestService {
  constructor(private readonly prefix: string) {}
  label(id: OrderTestId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderTestStore {
  private readonly items = new Map<OrderTestId, OrderTest>();
  put(item: OrderTest): void { this.items.set(item.id, item); }
  get(id: OrderTestId): OrderTest | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_TEST_FLAG = true;
export const orders_test_limit = 100;
export const orders_test_prefix = 'orders-test';
