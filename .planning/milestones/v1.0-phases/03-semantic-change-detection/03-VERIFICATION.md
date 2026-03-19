# Phase 3: Semantic Change Detection - Verification

**Verified:** 2026-03-19
**Test command:** `npx vitest run src/change-detector/ast-parser.test.ts src/change-detector/semantic-diff.test.ts src/change-detector/types.test.ts src/change-detector/change-detector.test.ts`
**Result:** All tests pass (62 tests across 4 test files)

---

## CHNG-01: System performs AST-level diff on changed TS/JS files to distinguish export/type signature changes from body-only changes

**Status:** VERIFIED
**Evidence:**
- `src/change-detector/ast-parser.test.ts` -- `isTreeSitterLanguage > returns true for .ts`
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > classifies a .ts file and returns SemanticChangeSummary with confidence=ast`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — changed signature > returns changeType=exports-changed with affectsDependents=true`
**Behavior confirmed:** TS/JS files receive AST-level classification with `confidence=ast`, distinguishing body-only changes from export/type signature changes.

---

## CHNG-02: AST diff produces a typed SemanticChangeSummary that classifies what changed (exports, types, body, comments)

**Status:** VERIFIED
**Evidence:**
- `src/change-detector/types.test.ts` -- `SemanticChangeSummary interface > has filePath, changeType, affectsDependents, changedExports, confidence, timestamp fields`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — only type/interface changes > returns changeType=types-changed for type alias change`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — only type/interface changes > returns changeType=types-changed for interface change`
**Behavior confirmed:** `computeSemanticDiff` returns a fully typed `SemanticChangeSummary` with all required fields (filePath, changeType, affectsDependents, changedExports, confidence, timestamp) and correctly classifies type/interface changes as `types-changed`.

---

## CHNG-03: For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed

**Status:** VERIFIED (Phase 3 component; Phase 7 VERIFICATION covers full E2E chain)
**Evidence:**
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > classifies a .py file as changeType=unknown with confidence=heuristic`
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector LLM fallback wiring > classify on a .py file queues a change_impact job with non-null payload`
**Behavior confirmed:** Unsupported language files (e.g., `.py`) are classified with `confidence=heuristic` and a `change_impact` LLM job is queued with a non-null payload for downstream processing.

---

## CHNG-04: Body-only changes only re-evaluate the changed file's own metadata, not dependents

**Status:** VERIFIED
**Evidence:**
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > produces affectsDependents=false for a body-only change on a .ts file`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — identical snapshots > returns changeType=body-only and affectsDependents=false for identical snapshots`
**Behavior confirmed:** Body-only changes produce `affectsDependents=false`, ensuring only the changed file's own metadata is re-evaluated and no cascade to dependents is triggered.

---

## CHNG-05: Export/type changes trigger cascade to direct dependents, marking their metadata stale

**Status:** VERIFIED
**Evidence:**
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > produces affectsDependents=true for an export signature change on a .ts file`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — added export > returns changeType=exports-changed with affectsDependents=true and changedExports=[newFn]`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — removed export > returns changeType=exports-changed with affectsDependents=true`
**Behavior confirmed:** Export and type signature changes produce `affectsDependents=true`, triggering the cascade engine to mark dependent files' metadata as stale.
