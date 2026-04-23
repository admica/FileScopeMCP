import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentBaseId = string;

export interface PaymentBase {
  id: PaymentBaseId;
  name: string;
  active: boolean;
}

export enum PaymentBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentBase(id: PaymentBaseId, name: string): PaymentBase {
  return { id, name, active: true };
}

export class PaymentBaseService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentBaseStore {
  private readonly items = new Map<PaymentBaseId, PaymentBase>();
  put(item: PaymentBase): void { this.items.set(item.id, item); }
  get(id: PaymentBaseId): PaymentBase | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_BASE_FLAG = true;
export const payments_base_limit = 100;
export const payments_base_prefix = 'payments-base';
