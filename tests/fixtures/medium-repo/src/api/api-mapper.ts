import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiMapperId = string;

export interface ApiMapper {
  id: ApiMapperId;
  name: string;
  active: boolean;
}

export enum ApiMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiMapper(id: ApiMapperId, name: string): ApiMapper {
  return { id, name, active: true };
}

export class ApiMapperService {
  constructor(private readonly prefix: string) {}
  label(id: ApiMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiMapperStore {
  private readonly items = new Map<ApiMapperId, ApiMapper>();
  put(item: ApiMapper): void { this.items.set(item.id, item); }
  get(id: ApiMapperId): ApiMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_API_MAPPER_FLAG = true;
export const api_mapper_limit = 100;
export const api_mapper_prefix = 'api-mapper';
