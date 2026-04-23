import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiTypesId = string;

export interface ApiTypes {
  id: ApiTypesId;
  name: string;
  active: boolean;
}

export enum ApiTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiTypes(id: ApiTypesId, name: string): ApiTypes {
  return { id, name, active: true };
}

export class ApiTypesService {
  constructor(private readonly prefix: string) {}
  label(id: ApiTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiTypesStore {
  private readonly items = new Map<ApiTypesId, ApiTypes>();
  put(item: ApiTypes): void { this.items.set(item.id, item); }
  get(id: ApiTypesId): ApiTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_API_TYPES_FLAG = true;
export const api_types_limit = 100;
export const api_types_prefix = 'api-types';
