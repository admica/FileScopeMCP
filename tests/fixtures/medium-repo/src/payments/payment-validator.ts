import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentValidatorId = string;

export interface PaymentValidator {
  id: PaymentValidatorId;
  name: string;
  active: boolean;
}

export enum PaymentValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentValidator(id: PaymentValidatorId, name: string): PaymentValidator {
  return { id, name, active: true };
}

export class PaymentValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentValidatorStore {
  private readonly items = new Map<PaymentValidatorId, PaymentValidator>();
  put(item: PaymentValidator): void { this.items.set(item.id, item); }
  get(id: PaymentValidatorId): PaymentValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_VALIDATOR_FLAG = true;
export const payments_validator_limit = 100;
export const payments_validator_prefix = 'payments-validator';
