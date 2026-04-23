export type UtilTypesId = string;

export interface UtilTypes {
  id: UtilTypesId;
  name: string;
  active: boolean;
}

export enum UtilTypesStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilTypes(id: UtilTypesId, name: string): UtilTypes {
  return { id, name, active: true };
}

export class UtilTypesService {
  constructor(private readonly prefix: string) {}
  label(id: UtilTypesId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilTypesStore {
  private readonly items = new Map<UtilTypesId, UtilTypes>();
  put(item: UtilTypes): void { this.items.set(item.id, item); }
  get(id: UtilTypesId): UtilTypes | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_TYPES_FLAG = true;
export const utils_types_limit = 100;
export const utils_types_prefix = 'utils-types';
