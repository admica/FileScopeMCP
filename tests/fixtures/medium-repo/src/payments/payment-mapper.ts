import type { Order } from '../orders/order.js';
import type { Auth } from '../auth/auth.js';

export type PaymentMapperId = string;

export interface PaymentMapper {
  id: PaymentMapperId;
  name: string;
  active: boolean;
}

export enum PaymentMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makePaymentMapper(id: PaymentMapperId, name: string): PaymentMapper {
  return { id, name, active: true };
}

export class PaymentMapperService {
  constructor(private readonly prefix: string) {}
  label(id: PaymentMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class PaymentMapperStore {
  private readonly items = new Map<PaymentMapperId, PaymentMapper>();
  put(item: PaymentMapper): void { this.items.set(item.id, item); }
  get(id: PaymentMapperId): PaymentMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_PAYMENTS_MAPPER_FLAG = true;
export const payments_mapper_limit = 100;
export const payments_mapper_prefix = 'payments-mapper';
