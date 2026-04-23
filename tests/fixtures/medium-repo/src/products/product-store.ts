import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductStoreId = string;

export interface ProductStore {
  id: ProductStoreId;
  name: string;
  active: boolean;
}

export enum ProductStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductStore(id: ProductStoreId, name: string): ProductStore {
  return { id, name, active: true };
}

export class ProductStoreService {
  constructor(private readonly prefix: string) {}
  label(id: ProductStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductStoreStore {
  private readonly items = new Map<ProductStoreId, ProductStore>();
  put(item: ProductStore): void { this.items.set(item.id, item); }
  get(id: ProductStoreId): ProductStore | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_STORE_FLAG = true;
export const products_store_limit = 100;
export const products_store_prefix = 'products-store';
