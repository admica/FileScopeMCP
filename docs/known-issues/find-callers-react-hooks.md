# Bug: `find_callers` misses callers via tsconfig-aliased imports (originally surfaced as "missing React hook callers")

**Surfaced:** 2026-05-10 during the with-rig invocation-baseline run on `tradewarrior` (see `docs/invocation-baseline.md` Run 2026-05-10 with-rig, Scenario 3).

**FileScopeMCP version at time of report:** `dec4778`

**Resolved:** 2026-05-10 — root cause was tsconfig path-alias resolution in `resolveTsJsImport`. The "React hook" framing in this doc's original title is misleading: the bug affected **every** TS/JS project using tsconfig `paths` (i.e., most modern Vite/Next/Webpack codebases). The "React hooks" symptom was an artifact of the test repo (tradewarrior's frontend imports hooks via the `@/` alias). See "Resolution" below; the root-cause analysis section is preserved as written for historical context.

## Resolution

Root cause: in `src/language-config.ts:resolveTsJsImport`, the package-vs-local heuristic was `(!importPath.startsWith('.') && !importPath.startsWith('/'))`. An import like `@/hooks/useSports` matches that condition and got classified as an npm scoped package (treated like `@anthropic-ai/sdk`), so the resolver:
- Returned an `EdgeResult` with `isPackage: true` and a non-existent `node_modules` target.
- Never populated the `specToTargetPath` map (which is gated on `!edge.isPackage`).
- Therefore the consumer's `import { useSportsGames } from '@/hooks/useSports'` never produced an entry in `importedSymbolIndex`.
- And the resolver's call-site pass silently discarded `useSportsGames(...)` candidates (D-12 step 3 — "unresolvable → silent discard").

Fix: a new module `src/tsconfig-paths.ts` reads `compilerOptions.baseUrl` + `compilerOptions.paths` from `<projectRoot>/tsconfig.json` (with JSONC comment stripping and per-projectRoot caching). `resolveTsJsImport` now attempts alias resolution **before** the package heuristic; if the importPath matches a configured alias pattern (e.g., `@/*`), the alias-resolved absolute path is probed for `.ts`/`.tsx`/`.js`/`.jsx` and returned as a local edge (`isPackage: false`). The original heuristic is unchanged when no alias matches, preserving behavior for genuine npm-scoped imports.

Tests:
- `src/tsconfig-paths.test.ts` — 16 tests covering tsconfig parsing (missing file, malformed JSON, JSONC comments, default baseUrl, multiple replacements, caching) and alias resolution (wildcard, exact match, longer-prefix, npm-scoped negative control).
- `src/language-config.tsconfig-paths-integration.test.ts` — 3 end-to-end tests reproducing the original tradewarrior symptom and verifying both the import edge and the call-site edge form correctly through the alias.

Scope NOT covered (defer until needed):
- `extends` chains in tsconfig.json.
- `compilerOptions.baseUrl` other than `.`.
- Multiple replacements per pattern (only the first is used).

Stopgap shipped earlier in the same session (commit `d44ddfd`): `find_callers` / `find_callees` now return a `warning` field when the queried symbol IS indexed but has zero edges. This compensates for any *other* parser miss the alias fix doesn't cover, and remains useful as defense-in-depth even after the root-cause fix lands.

## Symptom

`find_callers("useSportsGames")` returned **0** results despite:

- The symbol being indexed at `frontend/src/hooks/useSports.ts:20` as `export function useSportsGames(sport?: string)`.
- The hook having two real, statically-resolvable call sites elsewhere in the same indexed tree:
  - `frontend/src/components/sports/GameScoreboard.tsx:162` — `useSportsGames(sport)`
  - `frontend/src/pages/TownSquarePage.tsx:42` — `useSportsGames()`
- A plain `grep -rn "useSportsGames"` finding all three locations immediately.

The agent under test (Claude Code) recognized the failure mid-task and fell back to grep, noting in its own response: *"FileScopeMCP find_callers returned 0 results despite the symbol being indexed at useSports.ts:20. The call graph is missing edges for this hook — grep was the reliable path. Worth a re-scan_all later if you want the call graph trustworthy for React hooks."*

## Suspected scope

The pattern that failed is `export function useFoo(...)` (named export, function declaration, hook naming convention). It's plausible — but unverified — that the call-graph builder's caller-edge resolution doesn't handle one or more of:

- Named function exports (vs. `export const useFoo = (...) => ...` arrow forms)
- React hook usage inside JSX/TSX component bodies
- Cross-file imports of named hook exports without explicit type annotations
- TSX vs TS file extension handling (both call sites are `.tsx`; the definition is `.ts`)

A targeted reproduction would isolate which of these factors breaks the edge.

## Reproduction

1. Index a TS/JS project that defines `export function useX(...)` in a `.ts` file and consumes it from a `.tsx` file via `import { useX } from '...'`.
2. Call `find_callers("useX")`.
3. Compare the result count to `grep -rn "useX(" --include="*.ts" --include="*.tsx"`.

Expected: matching counts (modulo grep false positives in strings/comments).
Actual (in the tradewarrior reproduction): FileScope returns 0; grep returns 2.

## Impact on the invocation-baseline measurement

This bug *did not change the bar outcome* for the with-rig run — Scenario 3 still scored Axis A = 1 because the agent reached for `find_callers` first (the right tool by primer rules) before discovering it returned nothing useful. So the primer worked; the underlying tool failed. But:

- Future agents who hit this and *don't* fall back gracefully will produce wrong answers.
- The primer instructs agents to "try `find_callers(name)` before falling back to `grep`" — which is correct guidance, but assumes the tool returns the truth. When it returns 0 silently, an agent that trusts the result is worse off than one that started with grep.

## Suggested fixes (in priority order)

1. **Diagnose first**: instrument the call-graph builder's TS/JS module to log when an `export function` declaration is registered as a callable target but no incoming edges are resolved against it. Confirm whether the issue is on the *target registration* side or the *call-site discovery* side.
2. **If call-site discovery is the gap**: verify that the parser handles named-import call expressions inside TSX function bodies. The likely culprit is a missed traversal path through JSX-containing function bodies.
3. **If target registration is the gap**: ensure named function exports get the same call-target metadata as arrow-form exports.
4. **In the meantime, surface the limitation**: when `find_callers` returns 0 results for a symbol that is otherwise indexed (e.g., appears in `find_symbol`), include a one-line warning in the response: *"No callers found via static analysis. If unexpected, fall back to grep."* This nudges the agent toward the right behavior even before the underlying parser fix lands.

## Cross-references

- `docs/invocation-baseline.md` — the run record where this surfaced.
- `tradewarrior` repo (external) — the test repo. Specific files: `frontend/src/hooks/useSports.ts`, `frontend/src/pages/TownSquarePage.tsx`, `frontend/src/components/sports/GameScoreboard.tsx`.
