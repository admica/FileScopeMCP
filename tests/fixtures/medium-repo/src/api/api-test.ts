import type { User } from '../users/user.js';
import type { Order } from '../orders/order.js';

export type ApiTestId = string;

export interface ApiTest {
  id: ApiTestId;
  name: string;
  active: boolean;
}

export enum ApiTestStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeApiTest(id: ApiTestId, name: string): ApiTest {
  return { id, name, active: true };
}

export class ApiTestService {
  constructor(private readonly prefix: string) {}
  label(id: ApiTestId): string {
    return this.prefix + ':' + id;
  }
}

export class ApiTestStore {
  private readonly items = new Map<ApiTestId, ApiTest>();
  put(item: ApiTest): void { this.items.set(item.id, item); }
  get(id: ApiTestId): ApiTest | undefined { return this.items.get(id); }
}

export const DEFAULT_API_TEST_FLAG = true;
export const api_test_limit = 100;
export const api_test_prefix = 'api-test';
