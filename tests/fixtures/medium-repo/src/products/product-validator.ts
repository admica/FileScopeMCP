import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductValidatorId = string;

export interface ProductValidator {
  id: ProductValidatorId;
  name: string;
  active: boolean;
}

export enum ProductValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductValidator(id: ProductValidatorId, name: string): ProductValidator {
  return { id, name, active: true };
}

export class ProductValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: ProductValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductValidatorStore {
  private readonly items = new Map<ProductValidatorId, ProductValidator>();
  put(item: ProductValidator): void { this.items.set(item.id, item); }
  get(id: ProductValidatorId): ProductValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_VALIDATOR_FLAG = true;
export const products_validator_limit = 100;
export const products_validator_prefix = 'products-validator';
