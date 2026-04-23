import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentTestId = string;

export interface PaymentTest {
  id: PaymentTestId;
  name: string;
  active: boolean;
}

export enum PaymentTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentTest(id: PaymentTestId, name: string): PaymentTest {
  return { id, name, active: true };
}

export class PaymentTestService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentTestId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentTestStore {
  private readonly items = new Map<PaymentTestId, PaymentTest>();
  put(item: PaymentTest): void { this.items.set(item.id, item); }
  get(id: PaymentTestId): PaymentTest | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_TEST_FLAG = true;
export const payments_test_limit = 100;
export const payments_test_prefix = 'payments-test';
