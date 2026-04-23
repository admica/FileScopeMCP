import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiUtilsId = string;

export interface ApiUtils {
  id: ApiUtilsId;
  name: string;
  active: boolean;
}

export enum ApiUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiUtils(id: ApiUtilsId, name: string): ApiUtils {
  return { id, name, active: true };
}

export class ApiUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: ApiUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiUtilsStore {
  private readonly items = new Map<ApiUtilsId, ApiUtils>();
  put(item: ApiUtils): void { this.items.set(item.id, item); }
  get(id: ApiUtilsId): ApiUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_API_UTILS_FLAG = true;
export const api_utils_limit = 100;
export const api_utils_prefix = 'api-utils';
