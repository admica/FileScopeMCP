export type UtilApiId = string;

export interface UtilApi {
  id: UtilApiId;
  name: string;
  active: boolean;
}

export enum UtilApiStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilApi(id: UtilApiId, name: string): UtilApi {
  return { id, name, active: true };
}

export class UtilApiService {
  constructor(private readonly prefix: string) {}
  label(id: UtilApiId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilApiStore {
  private readonly items = new Map<UtilApiId, UtilApi>();
  put(item: UtilApi): void { this.items.set(item.id, item); }
  get(id: UtilApiId): UtilApi | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_API_FLAG = true;
export const utils_api_limit = 100;
export const utils_api_prefix = 'utils-api';
