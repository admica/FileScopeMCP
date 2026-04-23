import type { User } from '../users/user.js';
import type { Product } from '../products/product.js';

export type OrderValidatorId = string;

export interface OrderValidator {
  id: OrderValidatorId;
  name: string;
  active: boolean;
}

export enum OrderValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeOrderValidator(id: OrderValidatorId, name: string): OrderValidator {
  return { id, name, active: true };
}

export class OrderValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: OrderValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class OrderValidatorStore {
  private readonly items = new Map<OrderValidatorId, OrderValidator>();
  put(item: OrderValidator): void { this.items.set(item.id, item); }
  get(id: OrderValidatorId): OrderValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_ORDERS_VALIDATOR_FLAG = true;
export const orders_validator_limit = 100;
export const orders_validator_prefix = 'orders-validator';
