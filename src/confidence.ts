// src/confidence.ts
// Named confidence constants for dependency edge metadata.
// All extractors MUST use these constants instead of raw float literals.
// AST-extracted edges get EXTRACTED (1.0); regex-parsed edges get INFERRED (0.8).

export const EXTRACTED = 1.0;
export const INFERRED  = 0.8;

export const CONFIDENCE_SOURCE_EXTRACTED = 'extracted' as const;
export const CONFIDENCE_SOURCE_INFERRED  = 'inferred'  as const;

export type ConfidenceSource = typeof CONFIDENCE_SOURCE_EXTRACTED | typeof CONFIDENCE_SOURCE_INFERRED;
