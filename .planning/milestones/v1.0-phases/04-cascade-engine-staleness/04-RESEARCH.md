# Phase 4: Cascade Engine + Staleness - Research

**Researched:** 2026-03-17
**Domain:** BFS dependency graph walk, SQLite staleness writes, per-field stale timestamps, priority-tiered job queue, MCP response injection
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Cascade Depth and Propagation
- Transitive cascade — not just direct dependents, but dependents-of-dependents
- BFS (breadth-first) walk from the changed file using getDependents() at each hop
- Depth cap of 10 (real TS dependency chains rarely exceed 5-6 hops)
- Visited set terminates cycles (CASC-04) — a file is only processed once per cascade

#### Staleness in MCP Responses
- Add optional staleness fields directly to the FileNode response shape (backward compatible)
- Fields present only when non-null: summaryStale, conceptsStale, changeImpactStale (ISO timestamps or ms-since-epoch)
- Null/omitted = fresh; timestamp = stale since that time
- No opt-in flag — always include when stale. LLMs see staleness inline with metadata in a single response

#### Job Priority Behavior
- Priority ordering in the queue, no preemption of in-progress jobs
- All 3 staleness fields (summary, concepts, change_impact) marked on cascade dependents — all three reference the changed file's API surface
- Changed file itself also gets all 3 fields marked stale + its own LLM jobs queued at tier 2
- Job deduplication: before inserting a pending job, check for existing pending job with same (file_path, job_type) — skip insert if one exists

#### Cascade Trigger Scope
- Change events with affectsDependents=true: primary trigger — cascade to transitive dependents
- File deletion: cascade to dependents (their imports now point to nothing)
- File addition: no cascade (new files have zero dependents)
- Body-only changes (affectsDependents=false): no cascade to dependents, BUT mark the changed file's own summary_stale_since and concepts_stale_since (its summary describes its implementation, which changed)

### Claude's Discretion
- Exact BFS implementation details (queue data structure, batch vs per-node DB writes)
- Whether to batch SQLite staleness writes in a transaction for performance
- Log verbosity and format for cascade events
- Whether CascadeEngine is a class or a set of functions

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CASC-01 | When a file's API surface changes, all direct dependents in the dependency graph have their metadata marked stale | BFS walk using existing getDependents(); staleness written to files table columns summary_stale_since / concepts_stale_since / change_impact_stale_since — already in schema |
| CASC-02 | Staleness is tracked per semantic field: summary, concepts, and change_impact each have independent staleSince timestamps | Three independent integer columns already exist in schema.ts: summary_stale_since, concepts_stale_since, change_impact_stale_since — needs repository function to write them without touching other columns |
| CASC-03 | MCP query responses include staleness timestamps alongside metadata so LLMs can decide whether to trust the data | getSqlite() raw query can read staleness columns; mcp-server.ts tool handlers (get_file_summary, get_file_importance) need augmented responses — no schema change |
| CASC-04 | Cascade propagation detects and handles circular dependencies without infinite loops | Visited Set<string> in BFS loop; depth counter capped at 10 — pure algorithmic, no external library needed |
| CASC-05 | Cascade jobs are queued with priority ordering: interactive queries (tier 1) > file-change cascades (tier 2) > background sweeps (tier 3) | llm_jobs table already has priority_tier column with index on (status, priority_tier); insertLlmJob() already accepts priority_tier; deduplication check needed via raw SQL before insert |
</phase_requirements>

---

## Summary

Phase 4 implements the CascadeEngine — the bridge between Phase 3's semantic change detection and Phase 5's LLM pipeline. When ChangeDetector returns a SemanticChangeSummary with `affectsDependents=true`, CascadeEngine does a BFS walk through the dependency graph (using existing `getDependents()` from repository.ts) and writes staleness timestamps to three independent columns on each affected file row. The schema, repository, and LLM jobs table are already built in Phase 1. This phase is mostly algorithmic with a small surface area of new code.

The only significant new repository function needed is `markFilesStale(filePaths: string[], fields: StalenessFields, timestamp: number)` — a batched SQLite UPDATE that sets the three staleness columns without touching summary, mtime, or other fields. The current `upsertFile()` resets staleness to null on every call, which is a bug that must be fixed for this phase: upsertFile must PRESERVE existing staleness columns (not overwrite with null) during normal file metadata updates.

MCP response staleness injection is a two-step change: (1) add a raw SQL read of staleness columns in the repository's `getFile()` path (currently these columns are selected but stripped in rowToFileNode), and (2) augment the relevant mcp-server.ts tool response objects to include the non-null stale fields. This requires NO schema change — the columns exist, they just need to be read and forwarded.

**Primary recommendation:** Implement CascadeEngine as a module-level function set in `src/cascade/cascade-engine.ts` (not a class), wire it into coordinator.ts at lines 418-420, and add a batched `markStale()` repository function with transaction support.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 | Synchronous SQLite writes for staleness marks | Already in use; synchronous API is ideal for the coordinator's mutex-protected writes |
| drizzle-orm | ^0.45.1 | Typed SELECT queries for BFS node lookups | Already in use; `getDependents()` already uses it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.1.4 | Unit tests for BFS logic and staleness writes | All new module tests follow existing test file patterns |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SQL UPDATE for staleness marks | Drizzle update() | Drizzle update() is equally valid; raw SQL is slightly more readable for a targeted multi-column UPDATE without touching other columns; both work |
| In-memory BFS array queue | Recursive DFS | BFS with explicit queue is safer: no stack overflow risk for deep chains, easier depth-cap enforcement, easier visited-set management |

**Installation:** No new packages required — all dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cascade/
│   └── cascade-engine.ts     # BFS walk, staleness writes, job queuing
├── db/
│   └── repository.ts         # Add: markStale(), insertLlmJobIfNotPending(), fix upsertFile()
└── coordinator.ts            # Wire cascade at lines 418-420 and 424-427
```

### Pattern 1: BFS Walk with Visited Set and Depth Cap

**What:** Iterative BFS starting from the changed file's direct dependents, expanding one hop at a time, tracking visited paths and depth.

**When to use:** All cascade invocations with `affectsDependents=true` or file deletion events.

**Example:**
```typescript
// src/cascade/cascade-engine.ts
// Source: CONTEXT.md locked decisions + existing getDependents() in repository.ts

import { getDependents } from '../db/repository.js';
import { markStale, insertLlmJobIfNotPending } from '../db/repository.js';
import { log } from '../logger.js';

const CASCADE_DEPTH_CAP = 10;

export interface CascadeOptions {
  timestamp: number; // ms since epoch — the staleness timestamp to write
}

/**
 * Propagate staleness from changedFilePath to all transitive dependents.
 * Uses BFS with visited set to handle circular dependencies (CASC-04).
 * Must be called inside treeMutex.run() in the coordinator.
 */
export function cascadeStale(changedFilePath: string, opts: CascadeOptions): void {
  const { timestamp } = opts;
  const visited = new Set<string>();
  // Queue entries: [filePath, depth]
  const queue: Array<[string, number]> = [[changedFilePath, 0]];
  visited.add(changedFilePath);

  // Mark the changed file itself stale (all three fields)
  markStale([changedFilePath], timestamp);
  insertLlmJobIfNotPending(changedFilePath, 'summary', 2);
  insertLlmJobIfNotPending(changedFilePath, 'concepts', 2);
  insertLlmJobIfNotPending(changedFilePath, 'change_impact', 2);

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (depth >= CASCADE_DEPTH_CAP) continue;

    const dependents = getDependents(current);
    for (const dep of dependents) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      markStale([dep], timestamp);
      insertLlmJobIfNotPending(dep, 'summary', 2);
      insertLlmJobIfNotPending(dep, 'concepts', 2);
      insertLlmJobIfNotPending(dep, 'change_impact', 2);

      queue.push([dep, depth + 1]);
    }
  }

  log(`[CascadeEngine] Cascaded staleness from ${changedFilePath} to ${visited.size - 1} dependents`);
}

/**
 * Mark only the changed file's own summary/concepts stale (body-only change).
 * No cascade to dependents — they are not affected by internal logic changes.
 */
export function markSelfStale(filePath: string, opts: CascadeOptions): void {
  const sqlite = getSqlite();
  const ts = opts.timestamp;
  sqlite
    .prepare('UPDATE files SET summary_stale_since = ?, concepts_stale_since = ? WHERE path = ?')
    .run(ts, ts, filePath);
  insertLlmJobIfNotPending(filePath, 'summary', 2);
  insertLlmJobIfNotPending(filePath, 'concepts', 2);
  log(`[CascadeEngine] Marked self-stale (body-only): ${filePath}`);
}
```

### Pattern 2: Repository Functions — markStale and insertLlmJobIfNotPending

**What:** Two new repository functions that CascadeEngine calls. Both use raw better-sqlite3 prepared statements for performance.

**When to use:** Called exclusively by CascadeEngine; never called directly from coordinator.

```typescript
// Add to src/db/repository.ts
// Source: better-sqlite3 prepared statement API (already used in setExportsSnapshot)

/**
 * Set all three staleness columns for a batch of file paths.
 * Uses a SQLite transaction for atomicity. Does NOT touch other columns.
 */
export function markStale(filePaths: string[], timestamp: number): void {
  const sqlite = getSqlite();
  const stmt = sqlite.prepare(
    'UPDATE files SET summary_stale_since = ?, concepts_stale_since = ?, change_impact_stale_since = ? WHERE path = ?'
  );
  const tx = sqlite.transaction((paths: string[]) => {
    for (const p of paths) {
      stmt.run(timestamp, timestamp, timestamp, p);
    }
  });
  tx(filePaths);
}

/**
 * Insert an LLM job ONLY if no pending job with the same (file_path, job_type) exists.
 * Prevents queue bloat when multiple rapid changes hit the same file.
 */
export function insertLlmJobIfNotPending(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  priorityTier: number
): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare("SELECT 1 FROM llm_jobs WHERE file_path = ? AND job_type = ? AND status = 'pending' LIMIT 1")
    .get(filePath, jobType);
  if (existing) return; // Skip — deduplication
  const db = getDb();
  db.insert(llm_jobs)
    .values({
      file_path: filePath,
      job_type: jobType,
      priority_tier: priorityTier,
      status: 'pending',
      created_at: new Date(Date.now()),
      payload: null,
    })
    .run();
}
```

### Pattern 3: Coordinator Wiring — cascade at lines 418-427

**What:** Replace the `void changeSummary` placeholder with real cascade calls. Handle deletion cascade BEFORE removeFileNode.

```typescript
// coordinator.ts — replace lines 418-420 (change case)
// Source: CONTEXT.md specifics — coordinator.ts:418 placeholder

// After updateFileNodeOnChange:
if (changeSummary) {
  if (changeSummary.affectsDependents) {
    cascadeStale(filePath, { timestamp: Date.now() });
  } else {
    // Body-only: mark self stale only, no cascade
    markSelfStale(filePath, { timestamp: Date.now() });
  }
}

// coordinator.ts — unlink case, BEFORE removeFileNode (lines 424-427)
// Source: CONTEXT.md specifics — deletion cascade before graph removal
case 'unlink':
  if (fileWatchingConfig.watchForDeleted) {
    // Cascade FIRST — while getDependents() can still find edges
    cascadeStale(filePath, { timestamp: Date.now() });
    await removeFileNode(filePath, tempTree, projectRoot);
  }
  break;
```

### Pattern 4: MCP Response Staleness Injection

**What:** Read staleness columns from DB and include non-null values in tool response objects. No schema change required.

**When to use:** Any MCP tool that returns file metadata (get_file_summary, get_file_importance, list_files, etc.).

```typescript
// Add to repository.ts — reads staleness without full FileNode reconstruction
export function getStaleness(filePath: string): {
  summaryStale: number | null;
  conceptsStale: number | null;
  changeImpactStale: number | null;
} {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?')
    .get(filePath) as {
      summary_stale_since: number | null;
      concepts_stale_since: number | null;
      change_impact_stale_since: number | null;
    } | undefined;

  if (!row) return { summaryStale: null, conceptsStale: null, changeImpactStale: null };
  return {
    summaryStale: row.summary_stale_since ?? null,
    conceptsStale: row.concepts_stale_since ?? null,
    changeImpactStale: row.change_impact_stale_since ?? null,
  };
}

// In mcp-server.ts tool handlers, augment the response:
const stale = getStaleness(normalizedPath);
return createMcpResponse({
  path: node.path,
  summary: node.summary,
  // Include only non-null staleness fields (backward compatible)
  ...(stale.summaryStale !== null && { summaryStale: stale.summaryStale }),
  ...(stale.conceptsStale !== null && { conceptsStale: stale.conceptsStale }),
  ...(stale.changeImpactStale !== null && { changeImpactStale: stale.changeImpactStale }),
});
```

### Anti-Patterns to Avoid

- **Recursion for BFS:** Never implement the cascade walk with recursive function calls — circular dependencies cause stack overflow. Use an explicit queue array.
- **Calling upsertFile() from CascadeEngine:** upsertFile() currently resets all three staleness columns to null (line 53-55 in repository.ts, the fileNodeToRow function). CascadeEngine must use targeted UPDATE statements, not upsertFile().
- **Cascade inside addFileNode/removeFileNode:** These file-utils functions don't know about semantic change context. The cascade belongs in the coordinator, not inside file-utils.
- **Deleting the dependency row before cascading:** For file deletion, getDependents() queries file_dependencies.target_path. If removeFileNode() runs first and deletes dependency rows, getDependents() returns nothing. Always cascade first.
- **Un-scoped staleness writes:** Do not write staleness to ALL files or to files that weren't in the dependency graph walk. Staleness should propagate only to the visited set.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Priority-ordered job queue in memory | Custom heap / linked list priority queue | SQLite query with ORDER BY priority_tier, created_at | Phase 5 processes jobs; persistence across restarts is required (STOR-07). In-memory queues lose state on crash. |
| Cycle detection in graph walk | Custom mark/unmark DFS | Visited Set<string> in BFS | Set.has() is O(1) and requires zero additional state. Visited marks per-cascade not per-graph (correctly handles same file appearing in different cascades). |
| Dependency graph in memory | Adjacency list / Map<string, string[]> | getDependents() querying SQLite per hop | In-memory graph diverges from DB truth on hot reload / crash recovery. The dep_target_idx index makes per-hop lookups fast. |

**Key insight:** The dependency graph already lives in SQLite with proper indexes. BFS is 1-3 SQLite lookups per hop — no in-memory graph representation needed.

---

## Common Pitfalls

### Pitfall 1: upsertFile Clobbers Staleness
**What goes wrong:** upsertFile() is called during normal file-update processing (updateFileNodeOnChange path). It sets all three staleness columns to null unconditionally in the onConflictDoUpdate set clause (repository.ts lines 116-122). If cascade runs and sets staleness, then upsertFile() runs as part of the same change event, the staleness is erased.

**Why it happens:** fileNodeToRow() hardcodes null for all staleness fields (lines 53-55) because FileNode type doesn't have staleness fields yet.

**How to avoid:** Fix upsertFile() to not touch staleness columns in onConflictDoUpdate. Remove summary_stale_since, concepts_stale_since, and change_impact_stale_since from the `set` object in the conflict handler. These columns are owned exclusively by CascadeEngine and should never be reset by a file-metadata update.

**Warning signs:** Test that writes staleness then calls upsertFile() finds stale columns reset to null.

### Pitfall 2: Cascade Order in Change Handler
**What goes wrong:** The change event handler calls `updateFileNodeOnChange` before running the cascade. If updateFileNodeOnChange internally calls upsertFile() (resetting staleness), cascade writes are immediately overwritten.

**Why it happens:** The cascade is wired after the file update step in coordinator.ts.

**How to avoid:** Fix Pitfall 1 first (don't overwrite staleness in upsertFile). The cascade can safely run after the file update, since the targeted UPDATE from markStale() doesn't touch any other columns.

**Warning signs:** Staleness columns are null immediately after a cascade event when checked via raw SQLite.

### Pitfall 3: getDependents Returns Stale Graph After Deletion
**What goes wrong:** For a file deletion event, the coordinator calls removeFileNode() which calls deleteFile() in repository.ts. deleteFile() explicitly deletes all file_dependencies rows where source_path OR target_path matches the deleted file (lines 133-144). If cascade runs after this, getDependents() returns empty — no staleness propagates.

**Why it happens:** The coordinator's unlink handler (around line 424) runs removeFileNode first.

**How to avoid:** In the unlink case, call cascadeStale() BEFORE removeFileNode(). This is already documented in CONTEXT.md specifics.

**Warning signs:** Integration test: delete a file that has known dependents; query dependents — their staleness columns remain null.

### Pitfall 4: Job Deduplication Gap
**What goes wrong:** A file changes rapidly (editor autosave). The 2-second debounce fires twice. Each fires a cascade. Each cascade calls insertLlmJob for the same (file_path, job_type). The llm_jobs table accumulates duplicate pending jobs.

**Why it happens:** insertLlmJob() in repository.ts has no deduplication check — it always inserts.

**How to avoid:** Use insertLlmJobIfNotPending() which checks for an existing pending row before inserting. The check uses status='pending' so completed jobs don't block re-queuing.

**Warning signs:** After rapid file changes, llm_jobs table has > 3 pending rows for the same file_path.

### Pitfall 5: Cascade on Body-Only Change
**What goes wrong:** A body-only change (affectsDependents=false) incorrectly triggers cascadeStale() instead of markSelfStale(). Dependents are unnecessarily marked stale and LLM jobs are queued for them.

**Why it happens:** Forgetting to check the `affectsDependents` flag from SemanticChangeSummary before dispatching.

**How to avoid:** The coordinator branch must explicitly check changeSummary.affectsDependents. Body-only → markSelfStale(). Export-changed / types-changed → cascadeStale().

**Warning signs:** CASC-05 success criterion: "A body-only change in any file produces zero new stale marks on dependents and zero new LLM job queue entries." Test this directly.

---

## Code Examples

Verified patterns from the existing codebase:

### Existing getDependents usage
```typescript
// Source: src/db/repository.ts lines 190-198 — already implemented, BFS uses this directly
export function getDependents(filePath: string): string[] {
  const db = getDb();
  return db
    .select({ source: file_dependencies.source_path })
    .from(file_dependencies)
    .where(eq(file_dependencies.target_path, filePath))
    .all()
    .map((r: { source: string }) => r.source);
}
```

### Existing better-sqlite3 transaction pattern
```typescript
// Source: src/db/repository.ts setExportsSnapshot + db.ts — raw sqlite for targeted ops
const sqlite = getSqlite();
const stmt = sqlite.prepare('UPDATE files SET exports_snapshot = ? WHERE path = ?');
// Transaction pattern from better-sqlite3 (synchronous):
const tx = sqlite.transaction((items: Array<{json: string, path: string}>) => {
  for (const item of items) stmt.run(item.json, item.path);
});
tx(batch);
```

### Existing insertLlmJob pattern
```typescript
// Source: src/db/repository.ts lines 321-338 — extend for deduplication
export function insertLlmJob(params: {
  file_path: string;
  job_type: 'summary' | 'concepts' | 'change_impact';
  priority_tier: number;
  payload?: string;
}): void {
  const db = getDb();
  db.insert(llm_jobs).values({
    file_path: params.file_path,
    job_type: params.job_type,
    priority_tier: params.priority_tier,
    status: 'pending',
    created_at: new Date(Date.now()),
    payload: params.payload ?? null,
  }).run();
}
```

### Existing treeMutex.run() pattern
```typescript
// Source: src/coordinator.ts lines 386-434 — all cascade writes must be inside this
this.treeMutex.run(async () => {
  // ... file event handling ...
  // CascadeEngine calls go here — inside the mutex
});
```

### Test DB setup pattern (for cascade tests)
```typescript
// Source: src/change-detector/change-detector.test.ts — reuse this pattern verbatim
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  openDatabase(dbPath);
  const sqlite = getSqlite();
  sqlite.exec(`CREATE TABLE IF NOT EXISTS files (...); CREATE TABLE IF NOT EXISTS file_dependencies (...); CREATE TABLE IF NOT EXISTS llm_jobs (...);`);
});
afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory JSON tree for all state | SQLite with dep_target_idx index | Phase 1 | getDependents() is now a fast indexed lookup — BFS is viable without in-memory graph |
| No change classification | SemanticChangeSummary with affectsDependents | Phase 3 | CascadeEngine only fires when truly needed — body-only changes don't trigger cascade |
| LLM jobs not persisted | llm_jobs table in SQLite with priority_tier | Phase 1 (pre-built) | Phase 4 can queue jobs directly into the durable store — Phase 5 just dequeues |

**Deprecated/outdated:**
- `void changeSummary` in coordinator.ts line 420: This placeholder is removed in Plan 04-01 and replaced with real cascade dispatch.
- fileNodeToRow() setting staleness to null: Must be fixed so upsertFile() is safe to call after cascade has written stale marks.

---

## Open Questions

1. **Does rowToFileNode need to expose staleness fields on FileNode?**
   - What we know: FileNode type in types.ts has no staleness fields; rowToFileNode strips them. MCP responses read staleness separately via getStaleness().
   - What's unclear: Whether Phase 5's LLM processor needs to read staleness from a FileNode object or can call getStaleness() directly.
   - Recommendation: Do NOT add staleness to FileNode for Phase 4. Keep it as a separate DB read. This avoids changing the FileNode contract and all callers of rowToFileNode. Phase 5 can add it if needed.

2. **Batch size for markStale() transaction**
   - What we know: Typical cascade depth is 5-6 hops; a highly-imported utility file might have 20-50 transitive dependents.
   - What's unclear: Whether a single transaction for all visited nodes (collected after BFS) vs. write-per-hop matters for performance.
   - Recommendation: Collect all affected paths in the BFS, then write in a single transaction at the end. This avoids interleaving reads and writes and is slightly faster.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `src/db/repository.ts` — verified getDependents(), insertLlmJob(), upsertFile() implementations, the staleness null bug in fileNodeToRow()
- Direct codebase read: `src/db/schema.ts` — confirmed all three staleness columns exist as integers, dep_target_idx confirmed
- Direct codebase read: `src/coordinator.ts` lines 386-437 — confirmed exact placeholder location, mutex pattern, change/unlink handler structure
- Direct codebase read: `src/change-detector/types.ts` — confirmed SemanticChangeSummary.affectsDependents boolean contract
- Direct codebase read: `src/change-detector/change-detector.test.ts` — confirmed test setup pattern (temp DB, beforeAll/afterAll) to replicate for cascade tests
- Direct codebase read: `package.json` — confirmed vitest ^3.1.4, no p-queue in dependencies (SQLite-native queue is the design)

### Secondary (MEDIUM confidence)
- better-sqlite3 transaction API: synchronous `.transaction()` factory confirmed from existing usage in repository.ts setExportsSnapshot pattern (lines 293-311)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all libraries already installed and in active use
- Architecture: HIGH — BFS + visited set is standard graph traversal; all DB patterns verified from existing code
- Pitfalls: HIGH — upsertFile staleness bug identified by reading actual code (lines 53-55 + 116-122 repository.ts); deletion order confirmed from deleteFile() implementation

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable domain — no fast-moving dependencies)
