export type UtilStoreId = string;

export interface UtilStore {
  id: UtilStoreId;
  name: string;
  active: boolean;
}

export enum UtilStoreStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilStore(id: UtilStoreId, name: string): UtilStore {
  return { id, name, active: true };
}

export class UtilStoreService {
  constructor(private readonly prefix: string) {}
  label(id: UtilStoreId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilStoreStore {
  private readonly items = new Map<UtilStoreId, UtilStore>();
  put(item: UtilStore): void { this.items.set(item.id, item); }
  get(id: UtilStoreId): UtilStore | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_STORE_FLAG = true;
export const utils_store_limit = 100;
export const utils_store_prefix = 'utils-store';
