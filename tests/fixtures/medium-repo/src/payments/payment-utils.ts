import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentUtilsId = string;

export interface PaymentUtils {
  id: PaymentUtilsId;
  name: string;
  active: boolean;
}

export enum PaymentUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentUtils(id: PaymentUtilsId, name: string): PaymentUtils {
  return { id, name, active: true };
}

export class PaymentUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentUtilsStore {
  private readonly items = new Map<PaymentUtilsId, PaymentUtils>();
  put(item: PaymentUtils): void { this.items.set(item.id, item); }
  get(id: PaymentUtilsId): PaymentUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_UTILS_FLAG = true;
export const payments_utils_limit = 100;
export const payments_utils_prefix = 'payments-utils';
