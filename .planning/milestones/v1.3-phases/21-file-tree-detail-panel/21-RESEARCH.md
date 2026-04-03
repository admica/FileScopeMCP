# Phase 21: File Tree + Detail Panel - Research

**Researched:** 2026-04-01
**Domain:** Svelte 5 two-panel UI, Fastify SQLite API, hash-router extension
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Resizable divider between tree and detail panel. Default ~30/70 split. Drag handle to resize. No minimum width constraint needed.
- **D-02:** Stats card (StatsCard.svelte from Phase 20) as default detail view when no file/directory selected. Clicking a file replaces it with file detail.
- **D-03:** Scrollable detail panel with collapsible sections. Open by default: Summary, Concepts. Collapsed by default: Change Impact, Dependencies, Dependents, Package Deps, Exports, Staleness.
- **D-04:** Clickable dependency links navigate the tree — clicking a dep/dependent selects that file in the tree (expanding parents) and loads its detail.
- **D-05:** File path encoded in URL hash for bookmarkability. Format: `/#/project/:repoName/file/:filePath` for files, `/#/project/:repoName/dir/:dirPath` for dirs, `/#/project/:repoName` for stats card default. Browser back/forward works.
- **D-06:** Lazy per-directory tree loading. Root children loaded via `GET /api/project/:repo/tree`. Expanding a directory fetches children via `GET /api/project/:repo/tree/:path`. Expanded state tracked in component memory.
- **D-07:** Icons + chevrons in tree. Folder emoji (📂) for directories, file-type emoji for files (🟦 TypeScript, 🟡 JSON, etc.). Chevron (▸/▼) for expand/collapse. Monospace text.
- **D-08:** Background highlight for selected file — subtle blue/accent background. Hover gets lighter gray highlight.
- **D-09:** Muted placeholder text for LLM-pending fields. "Awaiting LLM analysis" in gray italic for missing summary/concepts/change_impact. Sections still visible.
- **D-10:** Directory detail shows: total files, average importance, % with summaries, % stale, and top 10 files by importance (clickable).
- **D-11:** Colored tag pills grouped by kind. Purpose as text paragraph, then Functions (blue), Classes (purple), Interfaces (green), Exports (gray) as pill/badge groups.
- **D-12:** Risk badge + summary + lists. Colored badge: green LOW, yellow MEDIUM, red HIGH. Bullet lists for affected areas and breaking changes.
- **D-13:** Exports grouped by kind with monospace signatures. Like a mini API reference.
- **D-14:** Tree endpoint: `GET /api/project/:repoName/tree/:path?` → `{ entries: [{ name, path, isDir, importance, hasSummary, isStale }] }`
- **D-15:** File detail endpoint: `GET /api/project/:repoName/file/:path` → full file object with all metadata fields.
- **D-16:** Directory detail endpoint: `GET /api/project/:repoName/dir/:path` → aggregate stats + topFiles.
- **D-17:** NEXUS-16 "htmx partial swaps" is superseded by Phase 20's Svelte-JSON-API architecture. Lazy-load and panel-update use Svelte reactivity + fetch calls. No htmx.

### Claude's Discretion

- Resizable divider implementation approach (CSS resize, pointer events, library)
- File-type icon mapping (which extensions get which emoji/icon)
- Exact Tailwind classes for pill colors, badge colors, section headers
- Whether empty concept groups are hidden or show "(none)"
- Tree indentation depth in pixels
- Loading skeleton vs spinner while tree/detail data loads

### Deferred Ideas (OUT OF SCOPE)

None from discussion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEXUS-15 | Collapsible directory tree in left panel — directories first, then files alphabetically, lazy-load on expand | SQLite query pattern for tree entries documented; lazy-load with per-dir fetch; D-06/D-07/D-08 locked |
| NEXUS-16 | "htmx partial swaps" superseded — implemented via Svelte reactivity + fetch (D-17). No full-page reloads. | Svelte 5 `$state()` + `$effect()` covers reactive panel updates; App.svelte hash-router extended for /file/ and /dir/ segments |
| NEXUS-17 | File detail panel renders all metadata fields | All data sources confirmed in schema.ts; JSON parsing patterns from existing repo-store.ts; type shapes from llm/types.ts and change-detector/types.ts |
| NEXUS-18 | Directory detail panel renders aggregate stats + top files | SQL aggregation query pattern documented; top files = ORDER BY importance DESC LIMIT 10 within path prefix |
</phase_requirements>

## Summary

Phase 21 builds the core interactive UI of the Nexus dashboard — replacing the Phase 20 placeholder in `Project.svelte` with a full two-panel layout. The left panel is a lazy-loaded, collapsible directory tree; the right panel is a scrollable metadata viewer that responds to file/directory selection.

The codebase is already well-scaffolded: Fastify with a JSON API pattern, Svelte 5 runes throughout, Tailwind v4 dark-mode-only, a hash router in `App.svelte`, and `repo-store.ts` with the `getDb(repoName)` pattern for SQLite access. Phase 21 adds three new API routes, three query functions, three fetch wrappers, three to five new Svelte components, and extends the hash router to parse `/file/` and `/dir/` path segments. No new dependencies are required.

The one design nuance worth flagging: the resizable panel divider (D-01) can be implemented with native CSS (`resize`) or with pointer-event-based drag logic — both are zero-dependency approaches compatible with the project's lean dependency philosophy. The CSS `resize` property is simplest but limited to right/bottom handles; pointer-event drag gives full control. Recommendation: pointer-event drag on a thin divider element — 20 lines of JS, no library needed.

**Primary recommendation:** Build from the inside out — API routes and query functions first (testable with curl), then tree component, then detail panel sections, then hash-router extension and deep-link integration last.

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 | ^5.55.1 | UI components with runes | Project-locked (Phase 20) |
| Tailwind CSS v4 | ^4.2.2 | Styling, dark-mode-only | Project-locked (Phase 20) |
| Fastify | ^5.8.4 | JSON API server | Project-locked (Phase 20) |
| better-sqlite3 | ^12.6.2 | SQLite reads | Project-locked (Phase 20) |
| Vite | ^8.0.3 | SPA build | Project-locked (Phase 20) |

### No New Dependencies Needed

All capabilities required for Phase 21 are already available:
- Resizable divider: pointer-event JS (20 lines, no library)
- File-type icons: emoji literals in a lookup object (no icon library)
- Lazy tree loading: native `fetch()` + Svelte `$state()`
- Collapsible sections: Svelte `$state(open)` + conditional render or CSS `max-height` transition
- Hash-router extension: regex change to existing `$derived.by()` in App.svelte

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pointer-event divider | `split.js` or `allotment` | Library adds 5-10KB for a 20-line problem; avoid |
| Emoji file icons | `lucide-svelte` or `@tabler/icons-svelte` | Adds dependency and build overhead; emoji sufficient for v1.3 |
| CSS `max-height` collapse | `<details>/<summary>` HTML element | `<details>` has no open/close animation control; `$state` + CSS is more controllable |

## Architecture Patterns

### Recommended File Structure (new files only)

```
src/nexus/
  server.ts          — add 3 routes: tree, file detail, dir detail
  repo-store.ts      — add 3 query functions: getTreeEntries, getFileDetail, getDirDetail
  ui/
    lib/
      api.ts         — add fetchTree, fetchFileDetail, fetchDirDetail wrappers
    routes/
      Project.svelte — replace placeholder with two-panel layout
    components/
      FileTree.svelte        — collapsible tree, lazy-loads children per dir
      FileTreeNode.svelte    — single tree row (dir or file) with icon + chevron
      DetailPanel.svelte     — right panel, switches between StatsCard / FileDetail / DirDetail
      FileDetail.svelte      — all file metadata sections (collapsible)
      DirDetail.svelte       — aggregate stats + top files list
      ConceptsPills.svelte   — colored pill groups for ConceptsResult
      ChangeImpactBadge.svelte — risk badge + summary + bullet lists
      ExportsTable.svelte    — grouped by kind, monospace signatures
```

### Pattern 1: Fastify Route with Path Wildcard

Fastify v5 uses `*` suffix for wildcard path params. The tree, file, and dir endpoints use `path*` to capture paths with slashes.

```typescript
// Source: Fastify v5 docs — wildcard route params
app.get<{ Params: { repoName: string; path: string } }>(
  '/api/project/:repoName/tree/:path*',
  async (req, reply) => {
    const db = getDb(req.params.repoName);
    if (!db) { reply.code(404); return { error: 'Repo not found or offline' }; }
    return getTreeEntries(db, req.params.path ?? '');
  }
);

// When :path is omitted, provide a separate route for the root case
app.get<{ Params: { repoName: string } }>(
  '/api/project/:repoName/tree',
  async (req, reply) => {
    const db = getDb(req.params.repoName);
    if (!db) { reply.code(404); return { error: 'Repo not found or offline' }; }
    return getTreeEntries(db, '');
  }
);
```

**Confidence:** HIGH — matches existing route patterns in server.ts and Fastify v5 documentation.

### Pattern 2: Tree Entry Query (directories-first, alphabetical)

The `files` table stores both files and directories as flat rows. Tree entries for a given parent are rows whose path is a direct child of the parent — one level deep only (not recursive). The child detection uses SQLite path string logic.

```typescript
// Source: src/db/schema.ts — files table structure
// Directories sort first via CASE expression; then alphabetically by name
export function getTreeEntries(db: BetterSqlite3.Database, parentPath: string) {
  // Root level: no parent prefix. Sub-level: paths start with `${parentPath}/`
  // Direct children only: path has exactly one more segment than parent
  const sql = parentPath === ''
    ? `
      SELECT path, name, is_directory, importance,
             (summary IS NOT NULL) AS has_summary,
             (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
              OR change_impact_stale_since IS NOT NULL) AS is_stale
      FROM files
      WHERE path NOT LIKE '%/%'    -- no slash = root level entry
      ORDER BY is_directory DESC, name ASC
    `
    : `
      SELECT path, name, is_directory, importance,
             (summary IS NOT NULL) AS has_summary,
             (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
              OR change_impact_stale_since IS NOT NULL) AS is_stale
      FROM files
      WHERE path LIKE ? AND path NOT LIKE ?
      ORDER BY is_directory DESC, name ASC
    `;

  const rows = parentPath === ''
    ? db.prepare(sql).all()
    : db.prepare(sql).all(`${parentPath}/%`, `${parentPath}/%/%`);

  return { entries: rows.map(r => ({
    name: r.name,
    path: r.path,
    isDir: Boolean(r.is_directory),
    importance: r.importance ?? 0,
    hasSummary: Boolean(r.has_summary),
    isStale: Boolean(r.is_stale),
  })) };
}
```

**Confidence:** HIGH — derived directly from schema.ts column definitions and confirmed repo-store.ts SQLite usage patterns.

**Critical note on path structure:** The files table stores paths relative to the repo root (e.g., `src/nexus/server.ts`, `src`). Root-level entries have no slash in the path. This assumption must be verified against actual data.db contents before finalizing the query. The `NOT LIKE '%/%'` filter for root is fragile if paths include a leading slash — implementer must check.

### Pattern 3: File Detail Query

All data comes from a single `files` row plus two join queries for dependencies/dependents. JSON blobs are stored as text and parsed with `JSON.parse()`.

```typescript
export function getFileDetail(db: BetterSqlite3.Database, filePath: string) {
  const file = db.prepare(`
    SELECT path, name, importance, summary, mtime,
           summary_stale_since, concepts_stale_since, change_impact_stale_since,
           exports_snapshot, concepts, change_impact
    FROM files WHERE path = ? AND is_directory = 0
  `).get(filePath) as FileRow | undefined;

  if (!file) return null;

  const deps = db.prepare(`
    SELECT target_path AS path, dependency_type AS type
    FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'
  `).all(filePath) as { path: string; type: string }[];

  const dependents = db.prepare(`
    SELECT source_path AS path
    FROM file_dependencies WHERE target_path = ? AND dependency_type = 'local_import'
  `).all(filePath) as { path: string }[];

  const packageDeps = db.prepare(`
    SELECT package_name AS name, package_version AS version, is_dev_dependency AS isDev
    FROM file_dependencies WHERE source_path = ? AND dependency_type = 'package_import'
  `).all(filePath) as { name: string; version: string; isDev: boolean }[];

  return {
    path: file.path,
    name: file.name,
    importance: file.importance ?? 0,
    summary: file.summary ?? null,
    concepts: file.concepts ? JSON.parse(file.concepts) : null,
    changeImpact: file.change_impact ? JSON.parse(file.change_impact) : null,
    exportsSnapshot: file.exports_snapshot ? JSON.parse(file.exports_snapshot) : null,
    staleness: {
      summary: file.summary_stale_since ?? null,
      concepts: file.concepts_stale_since ?? null,
      changeImpact: file.change_impact_stale_since ?? null,
    },
    dependencies: deps,
    dependents,
    packageDeps,
  };
}
```

**Confidence:** HIGH — directly derived from schema.ts column names and existing `getRepoStats` pattern in repo-store.ts.

### Pattern 4: Directory Detail Query

Aggregate stats over all file rows whose path starts with the directory prefix.

```typescript
export function getDirDetail(db: BetterSqlite3.Database, dirPath: string) {
  const prefix = dirPath + '/';
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_files,
      AVG(importance) AS avg_importance,
      COUNT(*) FILTER (WHERE summary IS NOT NULL) AS with_summary,
      COUNT(*) FILTER (WHERE summary_stale_since IS NOT NULL
                       OR concepts_stale_since IS NOT NULL
                       OR change_impact_stale_since IS NOT NULL) AS stale_count
    FROM files
    WHERE is_directory = 0 AND path LIKE ?
  `).get(prefix + '%') as DirRow;

  const topFiles = db.prepare(`
    SELECT path, name, importance
    FROM files
    WHERE is_directory = 0 AND path LIKE ?
    ORDER BY importance DESC
    LIMIT 10
  `).all(prefix + '%') as { path: string; name: string; importance: number }[];

  const total = row.total_files ?? 0;
  return {
    path: dirPath,
    name: dirPath.split('/').pop() ?? dirPath,
    totalFiles: total,
    avgImportance: row.avg_importance ? Math.round(row.avg_importance * 10) / 10 : 0,
    pctWithSummary: total > 0 ? Math.round((row.with_summary / total) * 100) : 0,
    pctStale: total > 0 ? Math.round((row.stale_count / total) * 100) : 0,
    topFiles,
  };
}
```

**Confidence:** HIGH — follows existing `getRepoStats` aggregate query structure exactly.

### Pattern 5: Hash Router Extension

`App.svelte` `$derived.by()` block currently parses only `/project/:name`. It must be extended to parse `/file/` and `/dir/` sub-segments without breaking existing routes.

```typescript
// Extended Route type
type Route =
  | { type: 'project'; name: string }
  | { type: 'project-file'; name: string; filePath: string }
  | { type: 'project-dir'; name: string; dirPath: string }
  | { type: 'system' }
  | { type: 'settings' }
  | { type: 'home' };

// Extended $derived.by() block
let route: Route = $derived.by(() => {
  const path = hash.replace(/^#/, '') || '/';
  if (path.startsWith('/project/')) {
    const rest = path.slice(9); // strip '/project/'
    const fileIdx = rest.indexOf('/file/');
    const dirIdx = rest.indexOf('/dir/');
    if (fileIdx !== -1) {
      return {
        type: 'project-file',
        name: decodeURIComponent(rest.slice(0, fileIdx)),
        filePath: decodeURIComponent(rest.slice(fileIdx + 6)),
      };
    }
    if (dirIdx !== -1) {
      return {
        type: 'project-dir',
        name: decodeURIComponent(rest.slice(0, dirIdx)),
        dirPath: decodeURIComponent(rest.slice(dirIdx + 5)),
      };
    }
    return { type: 'project', name: decodeURIComponent(rest) };
  }
  if (path === '/system') return { type: 'system' };
  if (path === '/settings') return { type: 'settings' };
  return { type: 'home' };
});
```

**Confidence:** HIGH — direct extension of existing App.svelte code.

### Pattern 6: Resizable Panel Divider (pointer-event approach)

No library needed. A thin divider element between the two panels captures `pointerdown`, then tracks `pointermove` on the document to compute new widths.

```typescript
// In Project.svelte
let treeWidth = $state(30); // percent

function onDividerPointerDown(e: PointerEvent) {
  const container = (e.currentTarget as HTMLElement).parentElement!;
  const startX = e.clientX;
  const startWidth = treeWidth;

  function onMove(ev: PointerEvent) {
    const delta = ev.clientX - startX;
    const containerWidth = container.getBoundingClientRect().width;
    const newPct = startWidth + (delta / containerWidth) * 100;
    treeWidth = Math.max(15, Math.min(70, newPct)); // clamp 15%–70%
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  e.preventDefault();
}
```

```svelte
<div class="flex flex-1 overflow-hidden">
  <div class="overflow-y-auto" style="width: {treeWidth}%">
    <FileTree ... />
  </div>
  <!-- Divider -->
  <div
    class="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize flex-shrink-0 transition-colors"
    onpointerdown={onDividerPointerDown}
  ></div>
  <div class="flex-1 overflow-y-auto">
    <DetailPanel ... />
  </div>
</div>
```

**Confidence:** HIGH — standard pointer-event pattern; Svelte 5 uses `onpointerdown` (not `on:pointerdown`).

### Pattern 7: Lazy Tree with Per-Directory State

The FileTree component tracks expanded directories and their loaded children in `$state` maps.

```typescript
// FileTree.svelte
let expanded = $state<Record<string, boolean>>({});
let children = $state<Record<string, TreeEntry[]>>({});
let loading = $state<Record<string, boolean>>({});

async function toggleDir(entry: TreeEntry) {
  if (!entry.isDir) return;
  if (expanded[entry.path]) {
    expanded[entry.path] = false;
    return;
  }
  if (!children[entry.path]) {
    loading[entry.path] = true;
    const result = await fetchTree(repoName, entry.path);
    children[entry.path] = result.entries;
    loading[entry.path] = false;
  }
  expanded[entry.path] = true;
}
```

**Confidence:** HIGH — standard Svelte 5 runes pattern; aligns with D-06.

### Pattern 8: Collapsible Sections

Use `$state(open)` per section. CSS `max-height` transition or simple `{#if open}` block.

```svelte
<!-- DetailSection.svelte or inline in FileDetail.svelte -->
<script lang="ts">
  let { title, defaultOpen = false }: { title: string; defaultOpen?: boolean } = $props();
  let open = $state(defaultOpen);
</script>

<div class="border-b border-gray-700">
  <button
    class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors"
    onclick={() => open = !open}
  >
    <span>{title}</span>
    <span class="text-gray-500">{open ? '▼' : '▸'}</span>
  </button>
  {#if open}
    <div class="px-4 py-3">
      <slot />
    </div>
  {/if}
</div>
```

**Confidence:** HIGH — Svelte 5 `$props()` and slot pattern; aligns with D-03.

### Pattern 9: Dependency Link Navigation

Clicking a dep path in the detail panel sets the URL hash, which the `$derived.by()` router picks up, which causes FileTree to highlight/expand the target.

```typescript
// In FileDetail.svelte
function navigateToFile(filePath: string) {
  window.location.hash = `#/project/${encodeURIComponent(repoName)}/file/${encodeURIComponent(filePath)}`;
}
```

Tree expand-to-selected is handled by FileTree receiving the `selectedPath` prop and auto-expanding parent directories if they contain the selected path on mount/change.

```typescript
// FileTree.svelte — expand parents of selectedPath on prop change
$effect(() => {
  if (!selectedPath) return;
  // Split path into segments, expand each prefix
  const parts = selectedPath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (prefix && !expanded[prefix]) {
      toggleDir({ path: prefix, isDir: true, name: parts[i-1], importance: 0, hasSummary: false, isStale: false });
    }
  }
});
```

**Confidence:** HIGH — pure Svelte 5 reactivity; aligns with D-04 and D-05.

### Anti-Patterns to Avoid

- **Loading all tree entries at once on mount:** The full file table of a large repo (500+ files) returned in one response is wasteful. Lazy-load per directory (D-06).
- **Storing `expanded` state in URL:** URL hash carries only the selected file/dir, not which directories are open. Expand state is session-only component memory.
- **Using `on:click` Svelte 4 syntax:** Project uses Svelte 5. Event handlers are `onclick={handler}` (no colon).
- **Fetching file detail on every hash change without debounce/guard:** If the user clicks rapidly, fire-and-forget fetches pile up. Guard with an in-flight check or abort controller.
- **SQLite `path LIKE '%/foo/%'` for subtree membership:** This matches paths that contain the segment anywhere, not just as a parent. Use `path LIKE 'parent/%'` (prefix match).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Panel resize | Custom resize library | Pointer-event JS (20 lines) | Already solves it; a library adds no value |
| File icons | SVG icon set | Emoji literals in a map | No rendering pipeline, no font loading, zero bytes |
| Tree virtualization | Virtual scroll component | None needed | Repos under 500 files; lazy loading keeps the DOM shallow |
| Collapsible animation | CSS animation library | `{#if open}` or `max-height: 0/auto` transition | 2 lines of CSS, no dependency |
| Path encoding | Custom encoder | `encodeURIComponent` / `decodeURIComponent` | Built-in, handles all edge cases |

**Key insight:** This phase is pure composition of already-available primitives (Svelte 5 runes, Tailwind classes, better-sqlite3, native fetch). No new dependencies are justified.

## Common Pitfalls

### Pitfall 1: Fastify Wildcard Route Registration Order

**What goes wrong:** Registering `/api/project/:repoName/tree` after `/api/project/:repoName/tree/:path*` causes Fastify to never match the parameterless route — the wildcard greedily matches even empty-path requests.

**Why it happens:** Fastify v5 route matching is order-sensitive for wildcard params. The wildcard must be registered after the non-wildcard sibling.

**How to avoid:** Register `/api/project/:repoName/tree` first, then `/api/project/:repoName/tree/:path*` second.

**Warning signs:** `GET /api/project/myrepo/tree` returns 404 while `GET /api/project/myrepo/tree/src` works.

### Pitfall 2: SQLite `FILTER` Clause Availability

**What goes wrong:** The `COUNT(*) FILTER (WHERE ...)` syntax requires SQLite 3.23.0+. Older SQLite versions silently fail or error.

**Why it happens:** better-sqlite3 uses the system SQLite; WSL2 may have an older version bundled.

**How to avoid:** Use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` as the portable fallback, or verify SQLite version via `SELECT sqlite_version()` in the query function.

**Warning signs:** `getRepoStats` already uses `FILTER` successfully — if it works there, it will work in new queries too. Check `getRepoStats` test before assuming.

**Current status:** `getRepoStats` in repo-store.ts already uses `COUNT(*) FILTER (WHERE ...)` and is in production — HIGH confidence it works on this system.

### Pitfall 3: Path Separator Assumptions

**What goes wrong:** Tree queries using `NOT LIKE '%/%'` for root-level entries break if the stored paths include a leading `./` prefix or use backslash separators.

**Why it happens:** The path storage format is set by the MCP scanner, not the Nexus. The Nexus assumes forward-slash-separated paths without leading `./`.

**How to avoid:** Inspect actual `data.db` `files` rows before finalizing root query logic. Add a sanity check in the query function.

**Warning signs:** Root level returns zero entries, or returns deeply nested files as root entries.

### Pitfall 4: Svelte 5 Snippet vs Slot

**What goes wrong:** Using `<slot />` in Svelte 5 components triggers a deprecation warning or breaks in strict mode.

**Why it happens:** Svelte 5 prefers `{@render children()}` with snippet props. `<slot>` still works but is legacy syntax.

**How to avoid:** For simple cases (collapsible section wrapper), use snippets:
```svelte
<script lang="ts">
  let { children }: { children: Snippet } = $props();
</script>
{#if open}
  {@render children()}
{/if}
```

**Warning signs:** Console warnings "slot is deprecated in Svelte 5" during dev build.

### Pitfall 5: Hash Encoding of File Paths with Special Characters

**What goes wrong:** File paths containing `#`, `?`, or `%` characters corrupt the hash when not encoded. Paths with spaces display incorrectly.

**Why it happens:** `window.location.hash = '#/project/foo/file/src/my file.ts'` stores a space, but reading back `window.location.hash` may or may not decode it depending on browser.

**How to avoid:** Always `encodeURIComponent(filePath)` when writing to hash. Always `decodeURIComponent(segment)` when reading. The extended router pattern above does this correctly.

### Pitfall 6: `$effect` Runs on Every Reactive Dependency, Including Props

**What goes wrong:** FileTree's `$effect` that auto-expands parents runs on every render cycle if `selectedPath` is derived from hash and the hash changes frequently (e.g., while typing in an address bar).

**Why it happens:** `$effect` in Svelte 5 re-runs whenever any reactive variable it reads changes.

**How to avoid:** Guard the expansion effect with a check: only run if `selectedPath` actually changed from previous value, or use a local `$state` to track `lastExpandedFor` and skip if same.

## Code Examples

### File-Type Icon Map

```typescript
// Source: Claude's discretion per D-07; emoji chosen for zero-dependency rendering
const FILE_ICONS: Record<string, string> = {
  '.ts': '🟦',
  '.tsx': '🟦',
  '.js': '🟡',
  '.jsx': '🟡',
  '.json': '🟡',
  '.svelte': '🟠',
  '.css': '🎨',
  '.html': '🌐',
  '.md': '📄',
  '.py': '🐍',
  '.rs': '🦀',
  '.go': '🐹',
  '.sh': '⚙️',
  '.sql': '🗄️',
  '.toml': '⚙️',
  '.yaml': '⚙️',
  '.yml': '⚙️',
};

function getFileIcon(name: string): string {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] ?? '📄';
}
```

### Risk Badge Color Classes

```typescript
// Source: D-12 (locked); CSS custom properties from app.css
const RISK_COLORS: Record<string, string> = {
  low:    'bg-green-900 text-green-300 border border-green-700',
  medium: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
  high:   'bg-red-900 text-red-300 border border-red-700',
};
```

### ConceptsResult Pill Groups

```typescript
// Source: D-11 (locked); types from src/llm/types.ts ConceptsResult
// { functions: string[], classes: string[], interfaces: string[], exports: string[], purpose: string }
const PILL_GROUPS = [
  { key: 'functions',   label: 'Functions',   color: 'bg-blue-900 text-blue-300' },
  { key: 'classes',     label: 'Classes',     color: 'bg-purple-900 text-purple-300' },
  { key: 'interfaces',  label: 'Interfaces',  color: 'bg-green-900 text-green-300' },
  { key: 'exports',     label: 'Exports',     color: 'bg-gray-700 text-gray-300' },
] as const;
```

### Staleness Display

```typescript
// Staleness fields are integer (ms timestamp since staleness began) or null (fresh)
function stalenessLabel(since: number | null): string {
  if (since === null) return 'Fresh';
  const ageMs = Date.now() - since;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return 'Stale (< 1h)';
  if (hours < 24) return `Stale (${hours}h)`;
  return `Stale (${Math.floor(hours / 24)}d)`;
}
```

### Fetch Wrappers (api.ts additions)

```typescript
export type TreeEntry = {
  name: string; path: string; isDir: boolean;
  importance: number; hasSummary: boolean; isStale: boolean;
};
export type TreeResponse = { entries: TreeEntry[] };

export async function fetchTree(repoName: string, dirPath?: string): Promise<TreeResponse> {
  const url = dirPath
    ? `/api/project/${encodeURIComponent(repoName)}/tree/${encodeURIComponent(dirPath)}`
    : `/api/project/${encodeURIComponent(repoName)}/tree`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tree fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchFileDetail(repoName: string, filePath: string): Promise<FileDetail> {
  const res = await fetch(`/api/project/${encodeURIComponent(repoName)}/file/${encodeURIComponent(filePath)}`);
  if (!res.ok) throw new Error(`File detail fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDirDetail(repoName: string, dirPath: string): Promise<DirDetail> {
  const res = await fetch(`/api/project/${encodeURIComponent(repoName)}/dir/${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`Dir detail fetch failed: ${res.status}`);
  return res.json();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 `on:event` | Svelte 5 `onevent={handler}` | Svelte 5 (2024) | All event handlers in this phase use no-colon syntax |
| Svelte 4 `<slot>` | Svelte 5 `{@render children()}` with Snippet | Svelte 5 (2024) | Use snippets for wrapper components |
| Svelte 4 `export let x` | Svelte 5 `let { x } = $props()` | Svelte 5 (2024) | All props use runes syntax |
| Svelte 4 reactive store `$store` | Svelte 5 `$state()` / `$derived()` | Svelte 5 (2024) | No writable/readable stores needed |
| htmx partial HTML swaps | Svelte fetch + reactive state | Phase 20 D-04 (2026) | NEXUS-16 "htmx" requirement is superseded (D-17) |

**Deprecated/outdated:**
- htmx: Decided against in Phase 20. All panel updates are Svelte + fetch.
- `on:click` syntax: Svelte 4 only. Use `onclick={...}` in Svelte 5.
- `createEventDispatcher`: Svelte 4 only. Use callback props (`onselect={() => ...}`) in Svelte 5.

## Open Questions

1. **Path storage format in data.db**
   - What we know: Schema stores `path` as primary key text; scanner writes paths relative to repo root
   - What's unclear: Whether paths start with `./`, whether any path segments contain special characters, whether root-level entries truly have no `/`
   - Recommendation: Add a debug query in Wave 0 — `SELECT path FROM files LIMIT 10` — to confirm path format before writing tree queries

2. **Directory rows in files table**
   - What we know: `is_directory` column exists and is indexed; `getRepoStats` filters `WHERE is_directory = 0`
   - What's unclear: Whether the scanner always creates explicit directory rows, or only creates file rows (with directory rows being implied by path prefixes)
   - Recommendation: Check actual data.db with `SELECT path, is_directory FROM files WHERE is_directory = 1 LIMIT 5` before relying on directory rows for tree display. If no directory rows exist, tree must infer directories from file path prefixes.

3. **`encodeURIComponent` in Fastify wildcard routes**
   - What we know: The API wraps file paths with `encodeURIComponent` in fetch calls; Fastify decodes URL params automatically
   - What's unclear: Whether double-encoding occurs when a path like `src/foo bar.ts` is encoded in the URL and Fastify passes the decoded value to the handler
   - Recommendation: Test with a file path containing a space or special character in Wave 1 or via curl before relying on the encoding.

## Sources

### Primary (HIGH confidence)
- `src/db/schema.ts` — files table column names, types, and indexes; file_dependencies structure
- `src/llm/types.ts` — ConceptsResult and ChangeImpactResult type shapes
- `src/change-detector/types.ts` — ExportSnapshot and ExportedSymbol type shapes
- `src/nexus/repo-store.ts` — SQLite query patterns, getRepoStats as template
- `src/nexus/server.ts` — Fastify route registration patterns
- `src/nexus/ui/App.svelte` — Hash router implementation to extend
- `src/nexus/ui/lib/api.ts` — Fetch wrapper pattern
- `src/nexus/ui/components/StatsCard.svelte` — Component to reuse as default detail view
- `.planning/phases/21-file-tree-detail-panel/21-CONTEXT.md` — All locked decisions D-01 through D-17

### Secondary (MEDIUM confidence)
- `NEXUS-PLAN.md` — Project View UI layout diagram, API endpoint shapes, file structure
- `package.json` — Confirms all needed libraries are already installed; no new deps required

### Tertiary (LOW confidence)
- Svelte 5 runes API patterns — from training data (August 2025 cutoff); Svelte 5 was released 2024 so this is stable, but verify snippet syntax if warnings appear during build

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed and in use
- Architecture: HIGH — derived directly from existing codebase code, not speculation
- Pitfalls: HIGH (SQLite FILTER, Fastify route order) / MEDIUM (path format, encoding edge cases)

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable stack, no fast-moving dependencies)
