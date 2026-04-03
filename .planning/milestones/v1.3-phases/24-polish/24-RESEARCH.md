# Phase 24: Polish - Research

**Researched:** 2026-04-02
**Domain:** Svelte 5 UI polish, Fastify backend extension, nexus.json blacklist management
**Confidence:** HIGH

## Summary

Phase 24 is entirely within the existing codebase. All five requirements are frontend or thin backend additions to an already-working Nexus stack. The data (`importance`, `isStale`) already flows through the API to every `FileTreeNode` — no new API work is needed for NEXUS-31 or NEXUS-32. The Navbar already receives `repos: RepoListItem[]` — only the dot logic needs adding for NEXUS-33. The Settings stub needs a full rewrite backed by two new Fastify routes and a blacklist field added to `nexus.json`. Responsive layout (NEXUS-35) is a CSS/Svelte change in `Project.svelte` only.

Every task is a contained surgical edit to one file, with the backend work isolated to `server.ts`, `discover.ts`, `repo-store.ts`, and `main.ts`. No new libraries are needed. No new data sources are needed. The phase can be planned as five independent waves, each aligned to one requirement.

**Primary recommendation:** Implement requirements in order NEXUS-31 → NEXUS-32 → NEXUS-33 → NEXUS-34 → NEXUS-35. Each is independent; ordering by risk (backend change last) is ideal.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Left-edge color bar — 2px vertical bar on the left edge of each FileTreeNode row, colored by importance. VS Code problem indicator style.
**D-02:** 5-bucket discrete color mapping: 0-1 gray (`gray-600`), 2-3 blue (`blue-500`), 4-5 green (`green-500`), 6-7 yellow (`yellow-500`), 8-10 red (`red-500`). Exact Tailwind shades are Claude's discretion.
**D-03:** `TreeEntry.importance` already in API response — no new API work needed, purely frontend.
**D-04:** Small orange refresh arrow (⟳) displayed after the filename text for stale files. Fresh files show nothing.
**D-05:** `TreeEntry.isStale` already in API response — purely frontend work.
**D-06:** Small colored dot displayed before the repo name on each navbar tab.
**D-07:** Color logic: green if repo has had recent MCP activity (data.db mtime within last 5 minutes or presence in broker's `repoTokens`), orange if `staleCount > 0`, gray if offline or no recent activity.
**D-08:** Status data polled alongside existing data — don't add heavy polling overhead.
**D-09:** No manual "add repo" form — repos appear automatically via the existing 60s recheck auto-discovery cycle.
**D-10:** Remove = blacklist. Removing a repo adds its path to an ignore/blacklist array in `~/.filescope/nexus.json`, closes the DB connection, tab disappears immediately. Future auto-discovery skips blacklisted paths.
**D-11:** Table layout with inline actions — repos listed as rows (name, path, online status) with a delete/remove button per row.
**D-12:** Confirm dialog on remove — "Remove {repo} from Nexus? This won't delete any data." Confirm/Cancel.
**D-13:** Always-visible blacklist section below the active repos table. Blacklisted repos shown with a "Restore" button to unblacklist and re-add.
**D-14:** Changes take effect immediately — DB opened/closed, tab appears/disappears, nexus.json updated — no server restart.
**D-15:** Collapsible tree panel — below ~1280px viewport width, the tree panel collapses behind a toggle/hamburger. Detail panel gets full width. Tree still accessible on demand.
**D-16:** Full width always at wide viewports — no max-width cap. Tree and detail panels stretch to use all available space at 2560px. Dashboard fills the screen.
**D-17:** System view and Settings page should also remain usable at 1024px — Claude's discretion on exact responsive behavior.

### Claude's Discretion

- Exact Tailwind color shades for heat color buckets
- Tab dot implementation approach (extend `/api/repos` response vs separate lightweight poll)
- Collapsible tree toggle mechanism (hamburger icon, sidebar button, etc.)
- How the graph view adapts at narrow widths (same collapse behavior as tree, or different)
- Confirm dialog implementation (native browser confirm vs custom modal component)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEXUS-31 | Importance displayed as heat-colored indicator on file tree entries (gray→blue→green→yellow→red for 0→10) | `entry.importance` already in `TreeEntry` type and passed to `FileTreeNode` props. Pure CSS/Svelte addition. |
| NEXUS-32 | Per-file staleness icon in tree (⟳ stale, ✓ fresh — but D-04 says fresh shows nothing) | `entry.isStale` already in `TreeEntry` type and passed to `FileTreeNode` props. One conditional span addition. |
| NEXUS-33 | Tab status indicators on navbar: green dot (MCP connected), gray dot (no active instance), orange dot (stale files pending) | Requires backend to extend `/api/repos` with `staleCount` and `dbMtime`; frontend derives dot color. |
| NEXUS-34 | Settings page: blacklist-based remove, restore, immediate DB open/close, nexus.json update | Requires two new Fastify routes (DELETE /api/repos/:repoName, POST /api/repos/:repoName/restore), blacklist field in nexus.json schema, `removeRepo`/`restoreRepo` functions in repo-store.ts, updates to discover.ts blacklist filter. |
| NEXUS-35 | Responsive layout adapting to different screen widths (1024px–2560px) | Pure `Project.svelte` change: Svelte `$state` boolean for panel collapsed state, breakpoint detection via `window.innerWidth` or CSS media query approach. |
</phase_requirements>

---

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Svelte 5 | existing | Component UI with runes | Already in use; `$state`, `$derived`, `$effect` patterns established |
| Tailwind CSS v4 | existing | Dark-only utility classes | All existing components use `bg-gray-*`, `text-gray-*` palette |
| Fastify | existing | HTTP API server | Backend server established in `server.ts` |
| better-sqlite3 | existing | SQLite read queries | All DB access goes through `repo-store.ts` |
| Node.js fs | existing | File mtime check for NEXUS-33 | `fs.statSync` gives `mtimeMs` for data.db activity heuristic |

### No New Dependencies

Phase 24 adds zero npm packages. All features are implementable with what is already installed.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure (what gets touched)

```
src/nexus/
├── ui/
│   ├── components/
│   │   ├── FileTreeNode.svelte   # NEXUS-31, NEXUS-32: add heat bar + stale icon
│   │   └── Navbar.svelte         # NEXUS-33: add status dots
│   ├── routes/
│   │   └── Settings.svelte       # NEXUS-34: full rewrite
│   ├── lib/
│   │   └── api.ts                # NEXUS-33/34: extend RepoListItem, add fetch wrappers
│   └── App.svelte                # NEXUS-35: collapse state, no route changes needed
├── repo-store.ts                 # NEXUS-34: add removeRepo, restoreRepo
├── discover.ts                   # NEXUS-34: extend NexusRegistry with blacklist, filter in discoverRepos
├── server.ts                     # NEXUS-33, NEXUS-34: extend /api/repos, add DELETE/POST routes
└── main.ts                       # NEXUS-35: no changes; NEXUS-34: recheck uses filter already
```

### Pattern 1: Heat Color Bar (NEXUS-31)

**What:** A 2px absolute-positioned left border on each FileTreeNode row communicates importance without consuming layout space.
**When to use:** Always on every tree row (files and dirs).

The existing `FileTreeNode.svelte` button uses `padding-left` for depth indentation via inline style. The color bar must be layered OUTSIDE this padding. Use `position: relative` on the button and an absolutely-positioned inner element:

```svelte
<!-- Source: FileTreeNode.svelte (current structure, extended) -->
<script lang="ts">
  function importanceColor(importance: number): string {
    if (importance <= 1) return 'bg-gray-600';
    if (importance <= 3) return 'bg-blue-500';
    if (importance <= 5) return 'bg-green-500';
    if (importance <= 7) return 'bg-yellow-500';
    return 'bg-red-500';
  }
</script>

<button
  class="relative w-full flex items-center gap-1.5 py-0.5 px-2 text-left ..."
  style="padding-left: {depth * 20 + 8}px"
  onclick={() => onToggle(entry)}
>
  <!-- 2px heat bar anchored to left edge, full row height -->
  <span class="absolute left-0 top-0 bottom-0 w-0.5 {importanceColor(entry.importance)}"></span>
  <!-- existing chevron, icon, name ... -->
</button>
```

Key: `w-0.5` in Tailwind = 2px. The bar uses `absolute left-0 top-0 bottom-0` so it always pins to the row's left edge regardless of depth indentation.

### Pattern 2: Staleness Icon (NEXUS-32)

**What:** Unicode refresh arrow appended after filename for stale files. Nothing shown for fresh files.
**When to use:** Files only (not dirs) where `entry.isStale === true`.

```svelte
<!-- After the <span class="font-mono text-sm truncate">{entry.name}</span> -->
{#if !entry.isDir && entry.isStale}
  <span class="text-orange-400 text-xs flex-shrink-0" title="Stale — metadata outdated">&#x27F3;</span>
{/if}
```

`&#x27F3;` is ⟳ (clockwise open circle arrow). Alternative: `&#x21BB;` (↻). The `flex-shrink-0` prevents the icon from being squashed in narrow rows.

### Pattern 3: Tab Status Dots (NEXUS-33)

**What:** Colored dot before repo name in each Navbar tab.
**How:** Extend the `/api/repos` response to include `staleCount` and `dbMtimeMs`. Frontend derives dot color from these fields.

**Backend extension to `/api/repos`:**

```typescript
// In server.ts GET /api/repos — extend response
app.get('/api/repos', async (_req, _reply) => {
  const now = Date.now();
  return getRepos().map((r) => {
    let dbMtimeMs: number | null = null;
    if (r.online) {
      try {
        const dbPath = path.join(r.path, '.filescope', 'data.db');
        dbMtimeMs = fs.statSync(dbPath).mtimeMs;
      } catch { /* offline or missing */ }
    }
    // staleCount from DB — use getRepoStats but only if online
    let staleCount = 0;
    const db = getDb(r.name);
    if (db) {
      const row = db.prepare(
        'SELECT COUNT(*) AS n FROM files WHERE is_directory=0 AND summary_stale_since IS NOT NULL'
      ).get() as { n: number };
      staleCount = row.n;
    }
    return { name: r.name, path: r.path, online: r.online, staleCount, dbMtimeMs };
  });
});
```

**Frontend dot color derivation:**

```typescript
// In Navbar.svelte
function dotColor(repo: RepoListItem): string {
  if (!repo.online) return 'bg-gray-500';
  const FIVE_MIN = 5 * 60 * 1000;
  const isRecent = repo.dbMtimeMs != null && (Date.now() - repo.dbMtimeMs) < FIVE_MIN;
  if (isRecent) return 'bg-green-500';
  if (repo.staleCount > 0) return 'bg-orange-400';
  return 'bg-gray-500';
}
```

**Update `RepoListItem` type in `api.ts`:**

```typescript
export type RepoListItem = {
  name: string;
  path: string;
  online: boolean;
  staleCount: number;
  dbMtimeMs: number | null;
};
```

**Dot HTML in Navbar tab:**

```svelte
<a href={`#/project/${repo.name}`} class="...flex items-center gap-1.5...">
  <span class="inline-block w-2 h-2 rounded-full flex-shrink-0 {dotColor(repo)}"></span>
  {repo.name}
</a>
```

The existing App.svelte polls `fetchRepos()` once on load. For NEXUS-33, status dots need periodic refresh. Add a 30s interval in `App.svelte`:

```svelte
// In App.svelte, extend the repos fetch
$effect(() => {
  function loadRepos() {
    fetchRepos().then(r => { repos = r; loading = false; ... });
  }
  loadRepos();
  const interval = setInterval(loadRepos, 30_000);
  return () => clearInterval(interval);
});
```

### Pattern 4: Settings Page (NEXUS-34)

**What:** Full rewrite of `Settings.svelte`. Backed by two new Fastify routes. nexus.json schema extended with a `blacklist` array.

**nexus.json schema extension:**

```typescript
// In discover.ts
export type NexusRegistry = {
  repos: NexusRepo[];
  blacklist?: string[];  // repo paths to hide
};
```

**New Fastify routes in server.ts:**

```typescript
// DELETE /api/repos/:repoName — blacklist and close DB
app.delete<{ Params: { repoName: string } }>(
  '/api/repos/:repoName',
  async (req, reply) => {
    const { repoName } = req.params;
    const removed = removeRepo(repoName);  // closes DB, removes from map
    if (!removed) { reply.code(404); return { error: 'Repo not found' }; }
    // Update nexus.json
    const registry = readRegistry() ?? { repos: [], blacklist: [] };
    registry.repos = registry.repos.filter(r => r.name !== repoName);
    registry.blacklist = [...(registry.blacklist ?? []), removed.path];
    writeRegistry(registry);
    return { ok: true };
  }
);

// POST /api/repos/:repoName/restore — remove from blacklist, re-open DB
app.post<{ Params: { repoName: string }; Body: { path: string } }>(
  '/api/repos/:repoName/restore',
  async (req, reply) => {
    const { path: repoPath } = req.body;
    const name = req.params.repoName;
    const registry = readRegistry() ?? { repos: [], blacklist: [] };
    registry.blacklist = (registry.blacklist ?? []).filter(p => p !== repoPath);
    registry.repos.push({ name, path: repoPath });
    writeRegistry(registry);
    openRepo(name, repoPath);  // re-open DB connection
    return { ok: true };
  }
);
```

**New repo-store.ts functions:**

```typescript
// Remove repo from in-memory map, close DB, return removed state
export function removeRepo(name: string): RepoState | null {
  const state = repos.get(name);
  if (!state) return null;
  if (state.db) { try { state.db.close(); } catch {} }
  repos.delete(name);
  return state;
}
```

**Settings.svelte structure:**

```
Settings page layout:
├── H1: "Settings"
├── Active Repos table (name | path | status | action)
│   └── Each row: "Remove" button → confirm dialog → DELETE /api/repos/:name
├── Blacklisted Repos section (always visible, empty state message if empty)
│   └── Each row: name, path + "Restore" button → POST /api/repos/:name/restore
└── After remove/restore: re-fetch repos list from App parent via shared state
```

Settings needs to trigger `repos` refresh in `App.svelte` after mutation. The cleanest approach with the existing hash router: pass an `onRefresh` callback prop from `App.svelte` down to `<Settings>`.

**App.svelte change:**

```svelte
<!-- Pass refresh callback to Settings -->
{:else if route.type === 'settings'}
  <Settings onRefresh={() => fetchRepos().then(r => repos = r)} />
```

**Confirm dialog:** Use native `confirm()` — it's one line, needs no component, and D-12 only says "confirm dialog" without specifying custom. Native is simplest.

```typescript
function handleRemove(repo: RepoListItem) {
  if (!confirm(`Remove ${repo.name} from Nexus? This won't delete any data.`)) return;
  fetch(`/api/repos/${encodeURIComponent(repo.name)}`, { method: 'DELETE' })
    .then(() => onRefresh());
}
```

**blacklist filter in discover.ts:**

```typescript
// discoverRepos() should filter out blacklisted paths
export async function discoverRepos(blacklist: string[] = []): Promise<NexusRepo[]> {
  // ... existing glob logic ...
  // After collecting repos:
  return repos.filter(r => !blacklist.includes(r.path));
}
```

And in `main.ts`, pass blacklist when calling `discoverRepos`:

```typescript
const registry = readRegistry();
if (!registry) {
  const discovered = await discoverRepos([]);
  ...
} else {
  // recheckOffline already exists — update to also skip blacklisted
}
```

The 60s `recheckOffline()` in main.ts also needs to skip blacklisted paths. Simplest: filter the repos map (only non-blacklisted repos are in the map after remove).

### Pattern 5: Responsive Layout (NEXUS-35)

**What:** Collapsible left panel in `Project.svelte` below ~1280px. Panel state tracked with `$state`. Toggle button shown only at narrow widths.

**Breakpoint detection in Svelte 5:** Use `window.innerWidth` at mount plus a `resize` event listener. No CSS-only approach needed since we need to conditionally render the panel.

```svelte
// In Project.svelte
let treeCollapsed = $state(false);
let viewportWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1920);

$effect(() => {
  function onResize() {
    viewportWidth = window.innerWidth;
    if (viewportWidth >= 1280 && treeCollapsed) treeCollapsed = false; // auto-expand at wide
  }
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
});

let showCollapseToggle = $derived(viewportWidth < 1280);
```

**Layout change:**

```svelte
<div class="flex flex-1 overflow-hidden" style="height: calc(100vh - 3rem)">
  <!-- Hamburger toggle — only visible at narrow widths -->
  {#if showCollapseToggle}
    <button
      class="absolute top-2 left-2 z-10 p-1.5 bg-gray-800 rounded text-gray-400 hover:text-gray-200"
      onclick={() => treeCollapsed = !treeCollapsed}
      aria-label="Toggle file tree"
    >
      &#x2630;  <!-- hamburger ≡ -->
    </button>
  {/if}

  <!-- Left panel: hidden when collapsed -->
  {#if !treeCollapsed}
    <div class="flex flex-col overflow-hidden border-r border-gray-700" style="width: {treeWidth}%">
      <!-- existing tree/graph content -->
    </div>
    <!-- Resizable divider — only when tree is visible -->
    <div role="separator" ... ></div>
  {/if}

  <!-- Right panel: flex-1 always -->
  <div class="flex-1 overflow-y-auto">
    <DetailPanel ... />
  </div>
</div>
```

Graph view adapts the same way — same `treeCollapsed` state gates both tree and graph panel since they share the left panel slot.

### Anti-Patterns to Avoid

- **Don't add new polling intervals per-feature:** NEXUS-33 extends the existing `fetchRepos()` call in `App.svelte` with a single 30s interval. Don't add a separate polling mechanism.
- **Don't reach into the DB from Settings.svelte:** All data mutations go through API calls → server.ts → repo-store.ts. Never import server-side modules in Svelte components.
- **Don't use `position: absolute` for the heat bar without `position: relative` on the parent button:** The existing button needs `relative` added to its class list.
- **Don't put blacklist logic in recheckOffline():** Blacklisted repos are simply never in the `repos` map — `removeRepo()` deletes them from the map. `recheckOffline()` iterates only the map, so it naturally skips removed repos.
- **Don't encode file paths in the hash router for Settings actions:** Settings uses API fetch calls, not hash navigation, so no routing changes needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirm dialog | Custom modal component | `confirm()` native browser | D-12 doesn't require custom, native is one line |
| Responsive CSS breakpoints | JavaScript media query manager | `window.innerWidth` + resize listener | Simple state, no library needed for 1 breakpoint |
| Color mapping function | Complex interpolation | Simple if/else 5-bucket | Discrete buckets are the spec (D-02), not gradient |
| Repo removal persistence | Custom state sync | Read→mutate→write nexus.json pattern already in discover.ts | Pattern already established in writeRegistry() |

**Key insight:** All data needed for this phase already exists in API responses. The work is purely presentation and thin backend wiring.

## Common Pitfalls

### Pitfall 1: Heat bar pushed inside depth padding
**What goes wrong:** If the `<span>` for the color bar is inside the flex container, it gets pushed right by `padding-left` depth indentation.
**Why it happens:** The depth indentation is applied as `padding-left` on the button, which shifts all child content.
**How to avoid:** Use `position: absolute; left: 0` on the bar element, and `position: relative` on the button. The absolute bar ignores padding.
**Warning signs:** Bar appears at different x-positions for different tree depths.

### Pitfall 2: RepoListItem type mismatch after NEXUS-33 extension
**What goes wrong:** After adding `staleCount` and `dbMtimeMs` to the backend `/api/repos` response, the TypeScript `RepoListItem` type in `api.ts` must be updated too, or type errors appear in `Navbar.svelte`.
**Why it happens:** The type is referenced in both `App.svelte` (fetch) and `Navbar.svelte` (render).
**How to avoid:** Update `RepoListItem` in `api.ts` before touching `Navbar.svelte`. TypeScript will surface any missed callsites.
**Warning signs:** TypeScript error `Property 'staleCount' does not exist on type 'RepoListItem'`.

### Pitfall 3: Settings doesn't refresh App-level repos list after remove/restore
**What goes wrong:** After removing a repo from Settings, the tab still appears in Navbar because `repos` state in `App.svelte` isn't refreshed.
**Why it happens:** `Settings.svelte` is a child component with no direct access to `App.svelte`'s `repos` state.
**How to avoid:** Pass an `onRefresh` callback prop from `App.svelte` to `<Settings>`. Call it after each successful DELETE or restore POST.
**Warning signs:** Tab persists after remove; no visual feedback that action succeeded.

### Pitfall 4: Fastify v5 route order matters — DELETE before wildcard catch-alls
**What goes wrong:** If static file serving or a wildcard route is registered before the DELETE route, Fastify may match the wrong handler.
**Why it happens:** `@fastify/static` registers a wildcard catch-all. In Fastify v5, order-sensitive registration means more specific routes must come first.
**How to avoid:** Register all `/api/` routes before static serving (already the case in current `server.ts` — `createServer` registers static last via `fastifyStatic`). Keep the pattern.
**Warning signs:** DELETE /api/repos/myrepo returns 404 or serves a static file.

### Pitfall 5: Collapse toggle button positioning conflicts with tree toggle bar
**What goes wrong:** The hamburger button placed at `absolute top-2 left-2` may overlap the Tree/Graph toggle buttons in `Project.svelte`.
**Why it happens:** Both are at the top of the left panel area.
**How to avoid:** Render the hamburger button inside the Project layout as a visible icon on the detail panel's top-left edge when tree is collapsed (not absolute-positioned over the hidden panel). Or use a sidebar sliver/button at the edge of the right panel.
**Warning signs:** Button invisible or overlaps other controls.

### Pitfall 6: staleCount query in /api/repos route is per-request DB hit
**What goes wrong:** Every `/api/repos` request now runs a COUNT query per repo. With 10+ repos, this adds 10 synchronous SQLite queries to a previously trivial route.
**Why it happens:** D-07 requires stale count for dot color, and `/api/repos` is the natural place.
**How to avoid:** The queries are synchronous via better-sqlite3 and fast (~0.1ms each). 10 repos = ~1ms overhead. Acceptable. But don't add expensive queries here.
**Warning signs:** /api/repos response time grows with repo count.

## Code Examples

Verified patterns from existing codebase:

### Svelte 5 runes pattern (established in prior phases)
```typescript
// Source: Project.svelte (existing)
let treeWidth = $state(30);
let treeCollapsed = $state(false);  // add for NEXUS-35
let viewportWidth = $state(window.innerWidth);  // add for NEXUS-35
```

### Fastify DELETE route pattern
```typescript
// Source: server.ts (add for NEXUS-34)
app.delete<{ Params: { repoName: string } }>(
  '/api/repos/:repoName',
  async (req, reply) => { ... }
);
```

### nexus.json read-modify-write pattern (established in discover.ts)
```typescript
// Source: discover.ts writeRegistry (existing)
const registry = readRegistry() ?? { repos: [], blacklist: [] };
registry.blacklist = [...(registry.blacklist ?? []), removedPath];
writeRegistry(registry);
```

### better-sqlite3 query pattern (established in repo-store.ts)
```typescript
// Source: repo-store.ts getRepoStats (existing)
const row = db.prepare(`SELECT COUNT(*) AS n FROM files WHERE ...`).get() as { n: number };
```

### fs.statSync mtime check (Node.js built-in)
```typescript
// Source: Node.js stdlib — for NEXUS-33 activity heuristic
import * as fs from 'node:fs';
const stat = fs.statSync(dbPath);
const isRecent = (Date.now() - stat.mtimeMs) < 5 * 60 * 1000;
```

### Absolute-positioned indicator (CSS pattern)
```svelte
<!-- Heat bar pattern — position: relative on parent, absolute on indicator -->
<button class="relative w-full flex items-center ...">
  <span class="absolute left-0 top-0 bottom-0 w-0.5 bg-green-500"></span>
  <!-- content... -->
</button>
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Settings placeholder stub | Full settings page with blacklist CRUD | Users can hide unwanted repos without restart |
| Static `/api/repos` response (name/path/online only) | Extended with staleCount + dbMtimeMs | Enables tab status dots without new polling endpoint |
| No importance visual cue in tree | 2px left heat bar | Importance scannable at a glance |
| No staleness visual in tree | ⟳ icon after filename | Stale files immediately identifiable |
| Fixed-width panels at all viewports | Collapsible left panel at <1280px | Usable at 1024px laptop screens |

## Open Questions

1. **repoTokens heuristic vs mtime heuristic (D-07)**
   - What we know: D-07 says green if data.db mtime within 5 minutes OR presence in broker's `repoTokens`. The broker's repoTokens come from `/api/system/broker`, which is a separate 2s-timeout call.
   - What's unclear: Should NEXUS-33 dot logic call the broker status endpoint too, or only use mtime?
   - Recommendation: Use mtime only for `/api/repos` extension. The broker endpoint is already polled by System view. Avoid coupling the main repo list response to broker availability. If broker is offline, mtime alone is the activity signal. This stays within "don't add heavy polling overhead" (D-08).

2. **`onRefresh` prop vs re-architecting App.svelte state**
   - What we know: App.svelte owns `repos` state and polls it; Settings needs to trigger refresh after mutations.
   - What's unclear: Whether passing `onRefresh` as a prop is idiomatic for this codebase (no Svelte stores are used currently).
   - Recommendation: `onRefresh` callback prop is the simplest approach consistent with the existing component patterns. No stores needed.

3. **`discoverRepos` blacklist parameter**
   - What we know: `discoverRepos()` is called in `main.ts` only when `nexus.json` doesn't exist (first run). Blacklist is only relevant on subsequent runs.
   - What's unclear: Whether `discoverRepos` needs to filter at all, since on first run there's no blacklist.
   - Recommendation: Don't modify `discoverRepos` signature. Instead, filter the discovered list in `main.ts` after calling `discoverRepos`, using `registry.blacklist` if available. The 60s `recheckOffline()` naturally skips blacklisted repos because they aren't in the repos map.

## Sources

### Primary (HIGH confidence)
- Direct source code inspection: `FileTreeNode.svelte`, `Navbar.svelte`, `Settings.svelte`, `App.svelte`, `Project.svelte`, `FileTree.svelte`, `api.ts`, `server.ts`, `repo-store.ts`, `discover.ts`, `main.ts` — all read directly
- `24-CONTEXT.md` — all decisions are locked and specific
- `REQUIREMENTS.md` — NEXUS-31 through NEXUS-35 read directly

### Secondary (MEDIUM confidence)
- Svelte 5 runes patterns: inferred from existing usage across all components (`$state`, `$derived`, `$effect`) — consistent and proven in Phases 20-23
- Tailwind v4 dark-only pattern: confirmed from `STATE.md` decision log (Phase 20 decision)
- Fastify v5 route ordering: confirmed from `STATE.md` decision log (Phase 21 decision)

### Tertiary (LOW confidence)
- None — all claims are grounded in direct code inspection or locked CONTEXT.md decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all existing stack confirmed by reading source
- Architecture: HIGH — all integration points confirmed by reading the actual files being modified
- Pitfalls: HIGH — derived from actual code structure (e.g., depth padding mechanism, Fastify route order)

**Research date:** 2026-04-02
**Valid until:** This research describes specific files in a specific codebase — valid until those files change. No external dependency staleness concerns.
