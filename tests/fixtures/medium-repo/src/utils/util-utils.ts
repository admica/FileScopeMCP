export type UtilUtilsId = string;

export interface UtilUtils {
  id: UtilUtilsId;
  name: string;
  active: boolean;
}

export enum UtilUtilsStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilUtils(id: UtilUtilsId, name: string): UtilUtils {
  return { id, name, active: true };
}

export class UtilUtilsService {
  constructor(private readonly prefix: string) {}
  label(id: UtilUtilsId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilUtilsStore {
  private readonly items = new Map<UtilUtilsId, UtilUtils>();
  put(item: UtilUtils): void { this.items.set(item.id, item); }
  get(id: UtilUtilsId): UtilUtils | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_UTILS_FLAG = true;
export const utils_utils_limit = 100;
export const utils_utils_prefix = 'utils-utils';
