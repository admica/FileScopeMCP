# Phase 24: Polish - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Visual refinements that make the Nexus informative at a glance: importance heat colors on file tree entries, staleness icons, tab status dots on the navbar, a settings page for repo blacklisting, and responsive layout from 1024px to 2560px. No new data sources or APIs beyond what's needed for these visual features.

</domain>

<decisions>
## Implementation Decisions

### Importance Heat Colors (NEXUS-31)
- **D-01:** Left-edge color bar — 2px vertical bar on the left edge of each FileTreeNode row, colored by importance. Subtle but scannable (VS Code problem indicator style).
- **D-02:** 5-bucket discrete color mapping: 0-1 gray (`gray-600`), 2-3 blue (`blue-500`), 4-5 green (`green-500`), 6-7 yellow (`yellow-500`), 8-10 red (`red-500`). Exact Tailwind shades are Claude's discretion.
- **D-03:** `TreeEntry.importance` field already exists in the API response and is passed to FileTreeNode — no new API work needed, purely frontend.

### Staleness Icons (NEXUS-32)
- **D-04:** Small orange refresh arrow (⟳) displayed after the filename text for stale files. Fresh files show nothing (clean default — only stale stands out).
- **D-05:** `TreeEntry.isStale` boolean already exists in the API response — purely frontend work.

### Tab Status Dots (NEXUS-33)
- **D-06:** Small colored dot displayed before the repo name on each navbar tab.
- **D-07:** Color logic uses a recent activity heuristic: green if repo has had recent MCP activity (check data.db mtime within last 5 minutes or presence in broker's `repoTokens`), orange if repo has stale files (`staleCount > 0`), gray if repo offline or no recent activity.
- **D-08:** Status data polled alongside existing data — Claude's discretion on whether to use a new lightweight endpoint or combine with existing `/api/repos` response. The key is: don't add heavy polling overhead.

### Settings Page (NEXUS-34)
- **D-09:** No manual "add repo" form — repos appear automatically via the existing 60s recheck auto-discovery cycle when MCP instances create `.filescope/data.db`.
- **D-10:** Remove = blacklist. Removing a repo adds its path to an ignore/blacklist array in `~/.filescope/nexus.json`, closes the DB connection, and tab disappears immediately. Future auto-discovery skips blacklisted paths.
- **D-11:** Table layout with inline actions — repos listed as rows (name, path, online status) with a delete/remove button per row.
- **D-12:** Confirm dialog on remove — "Remove {repo} from Nexus? This won't delete any data." Confirm/Cancel.
- **D-13:** Always-visible blacklist section below the active repos table. Blacklisted repos shown with a "Restore" button to unblacklist and re-add.
- **D-14:** Changes take effect immediately — DB opened/closed, tab appears/disappears, nexus.json updated — no server restart.

### Responsive Layout (NEXUS-35)
- **D-15:** Collapsible tree panel — below ~1280px viewport width, the tree panel collapses behind a toggle/hamburger. Detail panel gets full width. Tree still accessible on demand.
- **D-16:** Full width always at wide viewports — no max-width cap. Tree and detail panels stretch to use all available space at 2560px. Dashboard fills the screen.
- **D-17:** System view and Settings page should also remain usable at 1024px — Claude's discretion on exact responsive behavior for these simpler layouts.

### Claude's Discretion
- Exact Tailwind color shades for heat color buckets
- Tab dot implementation approach (extend `/api/repos` response vs separate lightweight poll)
- Collapsible tree toggle mechanism (hamburger icon, sidebar button, etc.)
- How the graph view adapts at narrow widths (same collapse behavior as tree, or different)
- Confirm dialog implementation (native browser confirm vs custom modal component)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Nexus Design
- `.planning/NEXUS-PLAN.md` — Navigation, File Tree, UI Layout sections (referenced by ROADMAP canonical refs for this phase)

### Existing UI Components (modify in this phase)
- `src/nexus/ui/components/FileTreeNode.svelte` — Tree node component, add heat color bar and staleness icon
- `src/nexus/ui/components/Navbar.svelte` — Navbar with repo tabs, add status dots
- `src/nexus/ui/routes/Settings.svelte` — Placeholder stub, rewrite with repo management

### API and Data Sources
- `src/nexus/ui/lib/api.ts` — TreeEntry type (has importance + isStale), RepoListItem type, fetch wrappers
- `src/nexus/server.ts` — Backend routes, may need blacklist endpoint or extended repo response
- `src/nexus/discover.ts` — Auto-discovery logic, needs blacklist filtering
- `src/nexus/repo-store.ts` — Repo state management, DB open/close lifecycle

### Prior Phase Patterns
- `.planning/phases/21-file-tree-detail-panel/21-CONTEXT.md` — Panel layout, tree loading, detail panel decisions
- `.planning/phases/20-server-skeleton-repo-discovery/20-CONTEXT.md` — Tech stack, routing, registry decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FileTreeNode.svelte` — Already renders tree entries with icon, chevron, name. Has `importance` and `isStale` in props via `TreeEntry` type. Just needs visual indicators added.
- `Navbar.svelte` — Already renders per-repo tabs with online/offline state. Receives `repos: RepoListItem[]`. Needs status dot addition.
- `Settings.svelte` — Placeholder stub ("coming in Phase 24"). Full rewrite needed.
- `api.ts` — Has `fetchRepos()`, `fetchProjectStats()`, all needed types. May need extension for blacklist API.

### Established Patterns
- Svelte 5 runes (`$state`, `$derived`, `$effect`) used throughout all components
- Tailwind dark-only: `bg-gray-900`, `text-gray-100`, `border-gray-700` palette
- Hash router with `window.location.hash` changes
- `onDestroy` + `$effect` cleanup for intervals and subscriptions

### Integration Points
- `discover.ts` — Auto-discovery writes to `nexus.json`. Blacklist filter goes here.
- `repo-store.ts` — `getRepos()` returns current repo state. Add/remove repo lifecycle.
- `server.ts` — API routes. New endpoints for blacklist CRUD (POST/DELETE).
- `main.ts` — 60s recheck interval already exists. Blacklisted repos filtered during recheck.

</code_context>

<specifics>
## Specific Ideas

- Left-edge color bar inspired by VS Code's problem/gutter indicators — 2px vertical bar, not a dot or background wash
- Staleness icon is specifically the refresh/sync arrow (⟳) — communicates "needs update" rather than "warning"
- Tab dots use activity heuristic rather than direct broker query per-repo — keep it simple, avoid new broker protocol messages
- Settings is blacklist-based, not add-based — auto-discovery handles finding repos, settings handles hiding unwanted ones

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-polish*
*Context gathered: 2026-04-02*
