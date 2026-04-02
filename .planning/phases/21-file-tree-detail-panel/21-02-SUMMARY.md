---
phase: 21-file-tree-detail-panel
plan: 02
subsystem: ui
tags: [svelte5, vite, tailwind, typescript, nexus, file-tree, detail-panel]

# Dependency graph
requires:
  - phase: 21-01
    provides: fetchTree, fetchFileDetail, fetchDirDetail API wrappers and all TypeScript types (TreeEntry, FileDetail, DirDetail, ConceptsResult, ChangeImpactResult, ExportSnapshot)
  - phase: 20-server-skeleton-repo-discovery
    provides: Fastify server, Svelte 5 SPA scaffold, hash router pattern, StatsCard component

provides:
  - FileTree.svelte — collapsible lazy-loaded directory tree with Svelte 5 snippet recursion
  - FileTreeNode.svelte — single tree row with file icons, chevrons, depth indentation
  - DetailPanel.svelte — switches between StatsCard / FileDetail / DirDetail based on selection
  - FileDetail.svelte — 8 collapsible sections (summary, concepts, change impact, deps, dependents, package deps, exports, staleness)
  - DirDetail.svelte — aggregate stats grid and top files list for directories
  - ConceptsPills.svelte — colored pill groups for functions, classes, interfaces, exports
  - ChangeImpactBadge.svelte — risk level badge with color coding, summary, affected areas, breaking changes
  - ExportsTable.svelte — exports grouped by kind with monospace signatures
  - Extended App.svelte hash router with project-file and project-dir route types
  - Rewritten Project.svelte with two-panel layout and draggable resizable divider

affects: [future 21-03-dependency-graph, any phase consuming nexus UI components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Svelte 5 snippet for recursive tree rendering ({#snippet renderEntries}) — enables arbitrary depth without component self-reference"
    - "Hash router sub-routes: /project/{name}/file/{path} and /project/{name}/dir/{path} via indexOf() parsing"
    - "Pointer events for drag resize: pointerdown/pointermove/pointerup on document, no external library"
    - "Per-repo state reset in $effect by reading repoName — triggers reactive cleanup on tab switch"
    - "Auto-expand parents via $effect watching selectedPath with lastExpandedFor guard to prevent re-runs"

key-files:
  created:
    - src/nexus/ui/components/FileTree.svelte
    - src/nexus/ui/components/FileTreeNode.svelte
    - src/nexus/ui/components/DetailPanel.svelte
    - src/nexus/ui/components/FileDetail.svelte
    - src/nexus/ui/components/DirDetail.svelte
    - src/nexus/ui/components/ConceptsPills.svelte
    - src/nexus/ui/components/ChangeImpactBadge.svelte
    - src/nexus/ui/components/ExportsTable.svelte
  modified:
    - src/nexus/ui/App.svelte
    - src/nexus/ui/routes/Project.svelte

key-decisions:
  - "Svelte 5 {#snippet renderEntries} for recursive tree — avoids Svelte 4 self-referencing component pattern; snippets are first-class in Svelte 5"
  - "filePath/dirPath not encoded in URL — they contain forward slashes that must remain literal in hash URL path; only repoName (single segment) is encoded"
  - "treeWidth clamped 15-70% — prevents tree from being hidden or taking over full panel"
  - "lastExpandedFor guard in auto-expand effect — prevents infinite re-run when selectedPath is already expanded"
  - "ARIA role=separator on divider div — resolves Svelte a11y warning about interactive non-interactive elements"

patterns-established:
  - "Two-panel layout: flex row with left panel width%, 4px divider, flex-1 right panel inside height: calc(100vh - 3rem)"
  - "Collapsible sections: openSections Record<string, boolean> + toggleSection(key) pattern for FileDetail"
  - "Navigation from detail to tree: window.location.hash assignment triggers hashchange listener in App.svelte"

requirements-completed: [NEXUS-15, NEXUS-16, NEXUS-17, NEXUS-18]

# Metrics
duration: 4min
completed: 2026-04-02
---

# Phase 21 Plan 02: File Tree + Detail Panel UI Summary

**Two-panel Svelte 5 code explorer: lazy tree with recursive snippet rendering, 8-section file detail panel, directory stats view, and bidirectional URL hash navigation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-02T03:42:29Z
- **Completed:** 2026-04-02T03:47:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Built FileTree with lazy directory expansion via fetchTree, Svelte 5 `{#snippet renderEntries}` for arbitrary depth recursion, and auto-expand parents when selectedPath changes via URL hash navigation
- Created 6 detail panel components: DetailPanel (view switcher), FileDetail (8 collapsible sections), DirDetail (stats grid + top files), ConceptsPills (4 pill groups with distinct colors), ChangeImpactBadge (risk level + affected areas + breaking changes), ExportsTable ($derived.by grouping by kind)
- Extended App.svelte hash router to parse /file/ and /dir/ sub-routes; rewrote Project.svelte with pointer-based draggable divider (30% default, 15-70% clamped)
- `npm run build:nexus` (backend esbuild + Vite frontend) passes with zero errors and zero warnings

## Task Commits

Each task was committed atomically:

1. **Task 1: Create file tree components** - `315b570` (feat)
2. **Task 2: Create detail panel components** - `26c696e` (feat)
3. **Task 3: Wire router, Project layout, and resizable divider** - `9f7f279` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/nexus/ui/components/FileTree.svelte` - Collapsible lazy-loaded directory tree, Svelte 5 snippet recursion, auto-expand on selectedPath change
- `src/nexus/ui/components/FileTreeNode.svelte` - Single tree row: file icon map, chevron, depth indent via inline style, onclick handler, selected state highlight
- `src/nexus/ui/components/DetailPanel.svelte` - Switches between StatsCard/FileDetail/DirDetail; fetches data reactively via $effect
- `src/nexus/ui/components/FileDetail.svelte` - 8 collapsible sections with stalenessLabel, navigateToFile, imports ConceptsPills/ChangeImpactBadge/ExportsTable
- `src/nexus/ui/components/DirDetail.svelte` - Aggregate stats grid (totalFiles, avgImportance, pctWithSummary, pctStale), top files with click navigation
- `src/nexus/ui/components/ConceptsPills.svelte` - Pill groups: functions=blue, classes=purple, interfaces=green, exports=gray; renders purpose paragraph
- `src/nexus/ui/components/ChangeImpactBadge.svelte` - Risk badge (low=green, medium=yellow, high=red), summary, affected areas, breaking changes
- `src/nexus/ui/components/ExportsTable.svelte` - Exports grouped by kind (function/class/variable/type/interface/enum/default), font-mono signatures
- `src/nexus/ui/App.svelte` - Extended Route type with project-file/project-dir, updated $derived.by parser, passes filePath/dirPath to Project
- `src/nexus/ui/routes/Project.svelte` - Replaced placeholder with two-panel layout, pointer-based drag resize, handleSelectFile/handleSelectDir URL hash updates

## Decisions Made

- Used `{#snippet renderEntries}` for recursive tree rendering — Svelte 5 snippets support recursion naturally without needing a separate self-referencing component
- File/dir paths not encoded in URL hash — they contain literal forward slashes required for path structure; only repoName is encoded as a single segment
- Added `role="separator" aria-label="Resize panels"` to divider div — resolved Svelte a11y warning about pointerdown handlers on non-interactive elements

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 8 Svelte components exist and build cleanly
- URL hash navigation is bidirectional: tree clicks update hash, dependency link clicks navigate tree
- Ready for Phase 21 Plan 03 (dependency graph with Cytoscape.js) or Phase 21 completion

## Self-Check: PASSED

- All 10 files exist (8 created, 2 modified)
- All 3 task commits found: 315b570, 26c696e, 9f7f279
- `npm run build:nexus` passes with zero errors

---
*Phase: 21-file-tree-detail-panel*
*Completed: 2026-04-02*
