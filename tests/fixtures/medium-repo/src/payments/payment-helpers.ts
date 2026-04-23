import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentHelpersId = string;

export interface PaymentHelpers {
  id: PaymentHelpersId;
  name: string;
  active: boolean;
}

export enum PaymentHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentHelpers(id: PaymentHelpersId, name: string): PaymentHelpers {
  return { id, name, active: true };
}

export class PaymentHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentHelpersStore {
  private readonly items = new Map<PaymentHelpersId, PaymentHelpers>();
  put(item: PaymentHelpers): void { this.items.set(item.id, item); }
  get(id: PaymentHelpersId): PaymentHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_HELPERS_FLAG = true;
export const payments_helpers_limit = 100;
export const payments_helpers_prefix = 'payments-helpers';
