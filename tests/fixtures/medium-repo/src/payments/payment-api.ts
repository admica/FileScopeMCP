import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentApiId = string;

export interface PaymentApi {
  id: PaymentApiId;
  name: string;
  active: boolean;
}

export enum PaymentApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentApi(id: PaymentApiId, name: string): PaymentApi {
  return { id, name, active: true };
}

export class PaymentApiService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentApiId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentApiStore {
  private readonly items = new Map<PaymentApiId, PaymentApi>();
  put(item: PaymentApi): void { this.items.set(item.id, item); }
  get(id: PaymentApiId): PaymentApi | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_API_FLAG = true;
export const payments_api_limit = 100;
export const payments_api_prefix = 'payments-api';
