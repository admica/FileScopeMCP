import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentTypesId = string;

export interface PaymentTypes {
  id: PaymentTypesId;
  name: string;
  active: boolean;
}

export enum PaymentTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentTypes(id: PaymentTypesId, name: string): PaymentTypes {
  return { id, name, active: true };
}

export class PaymentTypesService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentTypesStore {
  private readonly items = new Map<PaymentTypesId, PaymentTypes>();
  put(item: PaymentTypes): void { this.items.set(item.id, item); }
  get(id: PaymentTypesId): PaymentTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_TYPES_FLAG = true;
export const payments_types_limit = 100;
export const payments_types_prefix = 'payments-types';
