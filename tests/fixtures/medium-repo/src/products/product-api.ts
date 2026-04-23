import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductApiId = string;

export interface ProductApi {
  id: ProductApiId;
  name: string;
  active: boolean;
}

export enum ProductApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductApi(id: ProductApiId, name: string): ProductApi {
  return { id, name, active: true };
}

export class ProductApiService {
  constructor(private readonly prefix: string) {}
  label(id: ProductApiId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductApiStore {
  private readonly items = new Map<ProductApiId, ProductApi>();
  put(item: ProductApi): void { this.items.set(item.id, item); }
  get(id: ProductApiId): ProductApi | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_API_FLAG = true;
export const products_api_limit = 100;
export const products_api_prefix = 'products-api';
