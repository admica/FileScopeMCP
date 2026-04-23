import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentServiceId = string;

export interface PaymentService {
  id: PaymentServiceId;
  name: string;
  active: boolean;
}

export enum PaymentServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentService(id: PaymentServiceId, name: string): PaymentService {
  return { id, name, active: true };
}

export class PaymentServiceService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentServiceStore {
  private readonly items = new Map<PaymentServiceId, PaymentService>();
  put(item: PaymentService): void { this.items.set(item.id, item); }
  get(id: PaymentServiceId): PaymentService | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_SERVICE_FLAG = true;
export const payments_service_limit = 100;
export const payments_service_prefix = 'payments-service';
