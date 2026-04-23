import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiServiceId = string;

export interface ApiService {
  id: ApiServiceId;
  name: string;
  active: boolean;
}

export enum ApiServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiService(id: ApiServiceId, name: string): ApiService {
  return { id, name, active: true };
}

export class ApiServiceService {
  constructor(private readonly prefix: string) {}
  label(id: ApiServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiServiceStore {
  private readonly items = new Map<ApiServiceId, ApiService>();
  put(item: ApiService): void { this.items.set(item.id, item); }
  get(id: ApiServiceId): ApiService | undefined { return this.items.get(id); }
}

export const DEFAULT_API_SERVICE_FLAG = true;
export const api_service_limit = 100;
export const api_service_prefix = 'api-service';
