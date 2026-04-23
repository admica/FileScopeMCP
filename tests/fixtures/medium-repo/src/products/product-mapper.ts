import type { Db } from '../db/db.js';
import { log } from '../utils/util.js';

export type ProductMapperId = string;

export interface ProductMapper {
  id: ProductMapperId;
  name: string;
  active: boolean;
}

export enum ProductMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeProductMapper(id: ProductMapperId, name: string): ProductMapper {
  return { id, name, active: true };
}

export class ProductMapperService {
  constructor(private readonly prefix: string) {}
  label(id: ProductMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class ProductMapperStore {
  private readonly items = new Map<ProductMapperId, ProductMapper>();
  put(item: ProductMapper): void { this.items.set(item.id, item); }
  get(id: ProductMapperId): ProductMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_PRODUCTS_MAPPER_FLAG = true;
export const products_mapper_limit = 100;
export const products_mapper_prefix = 'products-mapper';
