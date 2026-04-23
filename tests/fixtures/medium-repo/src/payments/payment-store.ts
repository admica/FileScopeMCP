import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentStoreId = string;

export interface PaymentStore {
  id: PaymentStoreId;
  name: string;
  active: boolean;
}

export enum PaymentStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentStore(id: PaymentStoreId, name: string): PaymentStore {
  return { id, name, active: true };
}

export class PaymentStoreService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentStoreStore {
  private readonly items = new Map<PaymentStoreId, PaymentStore>();
  put(item: PaymentStore): void { this.items.set(item.id, item); }
  get(id: PaymentStoreId): PaymentStore | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_STORE_FLAG = true;
export const payments_store_limit = 100;
export const payments_store_prefix = 'payments-store';
