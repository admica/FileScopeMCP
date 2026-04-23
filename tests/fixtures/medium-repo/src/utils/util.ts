export type UtilBaseId = string;

export interface UtilBase {
  id: UtilBaseId;
  name: string;
  active: boolean;
}

export enum UtilBaseStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilBase(id: UtilBaseId, name: string): UtilBase {
  return { id, name, active: true };
}

export class UtilBaseService {
  constructor(private readonly prefix: string) {}
  label(id: UtilBaseId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilBaseStore {
  private readonly items = new Map<UtilBaseId, UtilBase>();
  put(item: UtilBase): void { this.items.set(item.id, item); }
  get(id: UtilBaseId): UtilBase | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_BASE_FLAG = true;
export const utils_base_limit = 100;
export const utils_base_prefix = 'utils-base';
