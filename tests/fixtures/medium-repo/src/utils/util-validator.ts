export type UtilValidatorId = string;

export interface UtilValidator {
  id: UtilValidatorId;
  name: string;
  active: boolean;
}

export enum UtilValidatorStatus {
  Pending = 'pending',
  Active = 'active',
  Retired = 'retired',
}

export function makeUtilValidator(id: UtilValidatorId, name: string): UtilValidator {
  return { id, name, active: true };
}

export class UtilValidatorService {
  constructor(private readonly prefix: string) {}
  label(id: UtilValidatorId): string {
    return this.prefix + ':' + id;
  }
}

export class UtilValidatorStore {
  private readonly items = new Map<UtilValidatorId, UtilValidator>();
  put(item: UtilValidator): void { this.items.set(item.id, item); }
  get(id: UtilValidatorId): UtilValidator | undefined { return this.items.get(id); }
}

export const DEFAULT_UTILS_VALIDATOR_FLAG = true;
export const utils_validator_limit = 100;
export const utils_validator_prefix = 'utils-validator';
