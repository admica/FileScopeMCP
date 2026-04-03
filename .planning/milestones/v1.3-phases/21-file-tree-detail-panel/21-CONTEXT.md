# Phase 21: File Tree + Detail Panel - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Clicking a repo tab shows a two-panel layout — a collapsible file tree on the left, and a metadata detail panel on the right that populates when you click a file or directory. This phase replaces the Phase 20 placeholder in Project.svelte with the full two-panel project view. No dependency graph (Phase 22), no importance heat colors or staleness icons in the tree (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Panel Layout
- **D-01:** **Resizable divider** between tree and detail panel. Default ~30/70 split. Drag handle to resize. No minimum width constraint needed — Claude's discretion on implementation.
- **D-02:** **Stats card as default** detail view when no file/directory is selected. The existing StatsCard from Phase 20 displays in the detail panel. Clicking a file replaces it with file detail.

### Detail Panel Organization
- **D-03:** **Scrollable with collapsible sections.** Each metadata section has a clickable header to collapse/expand. **Open by default:** Summary, Concepts. **Collapsed by default:** Change Impact, Dependencies, Dependents, Package Deps, Exports, Staleness.
- **D-04:** **Clickable dependency links** that navigate the tree. Clicking a dependency or dependent in the detail panel selects that file in the tree (expanding parent directories as needed) and loads its detail.

### URL Hash Binding
- **D-05:** **File path encoded in hash** for bookmarkability and deep linking. Format: `/#/project/:repoName/file/:filePath` for files, `/#/project/:repoName/dir/:dirPath` for directories. `/#/project/:repoName` alone shows the stats card default. Browser back/forward works for file navigation.

### Tree Loading Strategy
- **D-06:** **Lazy per-directory loading.** Only root children loaded initially via `GET /api/project/:repo/tree`. Expanding a directory fetches its children via `GET /api/project/:repo/tree/:path`. Expanded directory state tracked in component memory during session.

### Tree Visual Style
- **D-07:** **Icons + chevrons.** Folder emoji (📂) for directories, file-type indicators for files (🟦 TypeScript, 🟡 JSON, etc.). Chevron (▸/▼) for expand/collapse. Monospace text.
- **D-08:** **Background highlight** for selected file — subtle blue/accent background. Hover gets lighter gray highlight.

### Pending/Empty Metadata
- **D-09:** **Muted placeholder text** for LLM-pending fields. Show "Awaiting LLM analysis" in gray italic for missing summary/concepts/change_impact. Sections still visible. Dependencies, dependents, package deps, exports, and staleness are always available (from AST/DB, not LLM).

### Directory Detail Panel
- **D-10:** **Aggregate stats + top files.** Show: total files, average importance, % with summaries, % stale. Then a ranked list of top 10 files by importance (clickable, navigates tree + loads detail).

### Concepts Rendering
- **D-11:** **Colored tag pills grouped by kind.** Purpose as text paragraph, then Functions (blue), Classes (purple), Interfaces (green), Exports (gray) as pill/badge groups. Empty groups show "(none)" or are hidden — Claude's discretion.

### Change Impact Rendering
- **D-12:** **Risk badge + summary + lists.** Colored badge: green LOW, yellow MEDIUM, red HIGH. Summary text below. Affected areas and breaking changes as bullet lists (breaking changes only shown if non-empty).

### Exports Rendering
- **D-13:** **Grouped by kind with signatures.** Group exports by kind (functions, classes, variables, types, interfaces, enums). Show the signature in monospace font. Like a mini API reference.

### API Endpoint Shapes (locked)
- **D-14:** Tree endpoint:
  ```
  GET /api/project/:repoName/tree/:path?
  Response: { entries: [{ name, path, isDir, importance, hasSummary, isStale }] }
  ```
  When `:path` is omitted, returns root-level entries. When provided, returns children of that directory.

- **D-15:** File detail endpoint:
  ```
  GET /api/project/:repoName/file/:path
  Response: {
    path, name, importance, summary,
    concepts: ConceptsResult | null,
    changeImpact: ChangeImpactResult | null,
    exportsSnapshot: ExportSnapshot | null,
    staleness: { summary: number|null, concepts: number|null, changeImpact: number|null },
    dependencies: [{ path, type }],
    dependents: [{ path }],
    packageDeps: [{ name, version, isDev }]
  }
  ```

- **D-16:** Directory detail endpoint:
  ```
  GET /api/project/:repoName/dir/:path
  Response: {
    path, name, totalFiles, avgImportance,
    pctWithSummary, pctStale,
    topFiles: [{ path, name, importance }]  // top 10 by importance
  }
  ```

### NEXUS-16 Clarification
- **D-17:** Requirements NEXUS-16 references "htmx partial swaps" — this is **superseded** by Phase 20's D-04 (Fastify is a pure JSON API server, Svelte handles all rendering). The lazy-load and panel-update behavior is implemented via Svelte reactivity + fetch calls, not htmx. The requirement's intent (no full-page reloads) is preserved.

### Claude's Discretion
- Resizable divider implementation approach (CSS resize, pointer events, library)
- File-type icon mapping (which extensions get which emoji/icon)
- Exact Tailwind classes for pill colors, badge colors, section headers
- Whether empty concept groups are hidden or show "(none)"
- Tree indentation depth in pixels
- Loading skeleton vs spinner while tree/detail data loads

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Nexus Design
- `NEXUS-PLAN.md` — Full architecture. Read: UI Layout > Project View, File Tree, Detail Panel sections. API Endpoints section for route contracts.

### Database Schema
- `src/db/schema.ts` — SQLite table definitions. `files` table has: path, name, is_directory, importance, summary, mtime, summary_stale_since, concepts_stale_since, change_impact_stale_since, exports_snapshot (JSON), concepts (JSON), change_impact (JSON). `file_dependencies` table has: source_path, target_path, dependency_type, package_name, package_version, is_dev_dependency.

### LLM Result Types (for detail panel rendering)
- `src/llm/types.ts` — `ConceptsResult` (functions[], classes[], interfaces[], exports[], purpose) and `ChangeImpactResult` (riskLevel, affectedAreas[], breakingChanges[], summary). Both are Zod-inferred types stored as JSON blobs in the files table.

### Export Snapshot Types
- `src/change-detector/types.ts` — `ExportSnapshot` ({ filePath, exports: ExportedSymbol[], imports[], capturedAt }) and `ExportedSymbol` ({ name, kind, signature }). Stored as JSON blob in files.exports_snapshot.

### Phase 20 Existing Code
- `src/nexus/server.ts` — Current Fastify server with `/api/repos` and `/api/project/:repoName/stats` routes. New tree/file/dir routes added here.
- `src/nexus/repo-store.ts` — `getDb(repoName)` returns the better-sqlite3 instance for a repo. New query functions added here.
- `src/nexus/ui/lib/api.ts` — Current fetch wrappers. New tree/file/dir fetch functions added here.
- `src/nexus/ui/routes/Project.svelte` — Currently shows StatsCard + placeholder. Replaced with two-panel layout.
- `src/nexus/ui/App.svelte` — Hash router. Route parsing needs to handle `/file/` and `/dir/` path segments.

### Phase 20 Context (prior decisions)
- `.planning/phases/20-server-skeleton-repo-discovery/20-CONTEXT.md` — D-01 through D-13 carry forward (Svelte 5, Tailwind dark-only, Fastify JSON API, hash router, etc.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StatsCard.svelte` — existing component, becomes the default detail panel view
- `repo-store.ts` — `getDb()` and `getRepoStats()` already exist, new query functions follow the same pattern
- `api.ts` — `fetchRepos()` and `fetchProjectStats()` establish the fetch wrapper pattern
- `App.svelte` hash router — already parses `/#/project/:name`, needs extension for `/file/` and `/dir/` segments

### Established Patterns
- Svelte 5 runes throughout: `$state()`, `$derived()`, `$effect()`, `$props()`
- Tailwind dark-only classes: `bg-gray-900`, `text-gray-100`, `border-gray-700`
- Fastify route pattern: `app.get<{ Params: ... }>('/api/...', async (req, reply) => {...})`
- better-sqlite3 queries via `db.prepare().all()` / `.get()` in repo-store.ts
- JSON blob parsing: concepts, change_impact, exports_snapshot stored as text, parsed with `JSON.parse()`

### Integration Points
- `server.ts` — add 3 new routes: tree, file detail, directory detail
- `repo-store.ts` — add query functions for tree entries, file metadata, directory aggregates
- `api.ts` — add fetch wrappers for the 3 new endpoints
- `App.svelte` — extend route parsing to handle file/dir path segments
- `Project.svelte` — replace placeholder with two-panel layout component

</code_context>

<specifics>
## Specific Ideas

- User wants icons + chevrons in the tree (not minimal/plain), with file-type emoji indicators
- Colored tag pills for concepts (blue functions, purple classes, green interfaces, gray exports)
- Risk badges for change impact: green LOW, yellow MEDIUM, red HIGH
- Exports displayed like a mini API reference grouped by kind with monospace signatures
- Stats card stays as the default view in the detail panel — not removed, promoted
- "Modern cutting edge webapp feel" carries forward from Phase 20 — this is a visual code exploration tool

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 21-file-tree-detail-panel*
*Context gathered: 2026-04-01*
