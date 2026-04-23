export type UtilMapperId = string;

export interface UtilMapper {
  id: UtilMapperId;
  name: string;
  active: boolean;
}

export enum UtilMapperStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilMapper(id: UtilMapperId, name: string): UtilMapper {
  return { id, name, active: true };
}

export class UtilMapperService {
  constructor(private readonly prefix: string) {}
  label(id: UtilMapperId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilMapperStore {
  private readonly items = new Map<UtilMapperId, UtilMapper>();
  put(item: UtilMapper): void { this.items.set(item.id, item); }
  get(id: UtilMapperId): UtilMapper | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_MAPPER_FLAG = true;
export const utils_mapper_limit = 100;
export const utils_mapper_prefix = 'utils-mapper';
