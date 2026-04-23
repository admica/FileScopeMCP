import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductServiceId = string;

export interface ProductService {
  id: ProductServiceId;
  name: string;
  active: boolean;
}

export enum ProductServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductService(id: ProductServiceId, name: string): ProductService {
  return { id, name, active: true };
}

export class ProductServiceService {
  constructor(private readonly prefix: string) {}
  label(id: ProductServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductServiceStore {
  private readonly items = new Map<ProductServiceId, ProductService>();
  put(item: ProductService): void { this.items.set(item.id, item); }
  get(id: ProductServiceId): ProductService | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_SERVICE_FLAG = true;
export const products_service_limit = 100;
export const products_service_prefix = 'products-service';
