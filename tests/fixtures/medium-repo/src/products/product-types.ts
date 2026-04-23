import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductTypesId = string;

export interface ProductTypes {
  id: ProductTypesId;
  name: string;
  active: boolean;
}

export enum ProductTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductTypes(id: ProductTypesId, name: string): ProductTypes {
  return { id, name, active: true };
}

export class ProductTypesService {
  constructor(private readonly prefix: string) {}
  label(id: ProductTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductTypesStore {
  private readonly items = new Map<ProductTypesId, ProductTypes>();
  put(item: ProductTypes): void { this.items.set(item.id, item); }
  get(id: ProductTypesId): ProductTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_TYPES_FLAG = true;
export const products_types_limit = 100;
export const products_types_prefix = 'products-types';
