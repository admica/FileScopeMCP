import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductHelpersId = string;

export interface ProductHelpers {
  id: ProductHelpersId;
  name: string;
  active: boolean;
}

export enum ProductHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductHelpers(id: ProductHelpersId, name: string): ProductHelpers {
  return { id, name, active: true };
}

export class ProductHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: ProductHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductHelpersStore {
  private readonly items = new Map<ProductHelpersId, ProductHelpers>();
  put(item: ProductHelpers): void { this.items.set(item.id, item); }
  get(id: ProductHelpersId): ProductHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_HELPERS_FLAG = true;
export const products_helpers_limit = 100;
export const products_helpers_prefix = 'products-helpers';
