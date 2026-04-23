export type UtilHelpersId = string;

export interface UtilHelpers {
  id: UtilHelpersId;
  name: string;
  active: boolean;
}

export enum UtilHelpersStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilHelpers(id: UtilHelpersId, name: string): UtilHelpers {
  return { id, name, active: true };
}

export class UtilHelpersService {
  constructor(private readonly prefix: string) {}
  label(id: UtilHelpersId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilHelpersStore {
  private readonly items = new Map<UtilHelpersId, UtilHelpers>();
  put(item: UtilHelpers): void { this.items.set(item.id, item); }
  get(id: UtilHelpersId): UtilHelpers | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_HELPERS_FLAG = true;
export const utils_helpers_limit = 100;
export const utils_helpers_prefix = 'utils-helpers';
