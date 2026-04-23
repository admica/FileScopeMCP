import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiApiId = string;

export interface ApiApi {
  id: ApiApiId;
  name: string;
  active: boolean;
}

export enum ApiApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiApi(id: ApiApiId, name: string): ApiApi {
  return { id, name, active: true };
}

export class ApiApiService {
  constructor(private readonly prefix: string) {}
  label(id: ApiApiId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiApiStore {
  private readonly items = new Map<ApiApiId, ApiApi>();
  put(item: ApiApi): void { this.items.set(item.id, item); }
  get(id: ApiApiId): ApiApi | undefined { return this.items.get(id); }
}

export const DEFAULT_API_API_FLAG = true;
export const api_api_limit = 100;
export const api_api_prefix = 'api-api';
