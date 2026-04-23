import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductTestId = string;

export interface ProductTest {
  id: ProductTestId;
  name: string;
  active: boolean;
}

export enum ProductTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductTest(id: ProductTestId, name: string): ProductTest {
  return { id, name, active: true };
}

export class ProductTestService {
  constructor(private readonly prefix: string) {}
  label(id: ProductTestId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductTestStore {
  private readonly items = new Map<ProductTestId, ProductTest>();
  put(item: ProductTest): void { this.items.set(item.id, item); }
  get(id: ProductTestId): ProductTest | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_TEST_FLAG = true;
export const products_test_limit = 100;
export const products_test_prefix = 'products-test';
