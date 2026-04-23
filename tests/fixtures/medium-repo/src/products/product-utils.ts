import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductUtilsId = string;

export interface ProductUtils {
  id: ProductUtilsId;
  name: string;
  active: boolean;
}

export enum ProductUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductUtils(id: ProductUtilsId, name: string): ProductUtils {
  return { id, name, active: true };
}

export class ProductUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: ProductUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductUtilsStore {
  private readonly items = new Map<ProductUtilsId, ProductUtils>();
  put(item: ProductUtils): void { this.items.set(item.id, item); }
  get(id: ProductUtilsId): ProductUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_UTILS_FLAG = true;
export const products_utils_limit = 100;
export const products_utils_prefix = 'products-utils';
