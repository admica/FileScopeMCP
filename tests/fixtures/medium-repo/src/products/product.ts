import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductBaseId = string;

export interface ProductBase {
  id: ProductBaseId;
  name: string;
  active: boolean;
}

export enum ProductBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductBase(id: ProductBaseId, name: string): ProductBase {
  return { id, name, active: true };
}

export class ProductBaseService {
  constructor(private readonly prefix: string) {}
  label(id: ProductBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductBaseStore {
  private readonly items = new Map<ProductBaseId, ProductBase>();
  put(item: ProductBase): void { this.items.set(item.id, item); }
  get(id: ProductBaseId): ProductBase | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_BASE_FLAG = true;
export const products_base_limit = 100;
export const products_base_prefix = 'products-base';
