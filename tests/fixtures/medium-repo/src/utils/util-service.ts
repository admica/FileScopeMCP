export type UtilServiceId = string;

export interface UtilService {
  id: UtilServiceId;
  name: string;
  active: boolean;
}

export enum UtilServiceStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilService(id: UtilServiceId, name: string): UtilService {
  return { id, name, active: true };
}

export class UtilServiceService {
  constructor(private readonly prefix: string) {}
  label(id: UtilServiceId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilServiceStore {
  private readonly items = new Map<UtilServiceId, UtilService>();
  put(item: UtilService): void { this.items.set(item.id, item); }
  get(id: UtilServiceId): UtilService | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_SERVICE_FLAG = true;
export const utils_service_limit = 100;
export const utils_service_prefix = 'utils-service';
