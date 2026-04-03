# Phase 21: File Tree + Detail Panel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 21-file-tree-detail-panel
**Areas discussed:** Panel layout, Detail panel sections, File path in URL, Tree visual treatment, Pending states, Directory detail, Concepts rendering, Change impact display, API shapes, Exports layout

---

## Panel Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Resizable divider | Draggable divider, default ~30/70 split, user can adjust | ✓ |
| Fixed 25/75 split | No resize, tree always 25%, detail 75% | |
| Collapsible sidebar | Toggle open/closed, detail takes full width when closed | |

**User's choice:** Resizable divider
**Notes:** None

## Default Detail View

| Option | Description | Selected |
|--------|-------------|----------|
| Stats card | Show existing StatsCard as default, file detail replaces it | ✓ |
| Empty with hint | Just a "Select a file" prompt | |
| Directory overview of root | Root directory aggregate stats | |

**User's choice:** Stats card
**Notes:** None

## Detail Panel Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Scrollable with collapsible sections | All sections visible, each can collapse/expand, smart defaults | ✓ |
| All expanded, just scroll | Everything visible, no toggles | |
| Tabbed sections | Tabs within panel: Overview / Code Intel / Dependencies / Exports | |

**User's choice:** Scrollable with collapsible sections
**Notes:** None

## Dependency Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Click navigates tree + loads detail | Clicking a dep selects file in tree (expanding parents) and loads detail | ✓ |
| Click loads detail only | Loads detail but doesn't move tree selection | |
| Display only | Plain text paths, no navigation | |

**User's choice:** Click navigates tree + loads detail
**Notes:** None

## URL Hash Binding

| Option | Description | Selected |
|--------|-------------|----------|
| Encode file path in hash | /#/project/Repo/file/path — bookmarkable, browser back/forward works | ✓ |
| Component state only | URL stays at /#/project/RepoName, no deep linking | |
| Query param approach | /#/project/RepoName?file=path | |

**User's choice:** Encode file path in hash
**Notes:** None

## Tree Loading Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy per-directory | Only root children initially, expand fetches children via API | ✓ |
| Full tree upfront | One API call returns entire tree, client-side expand/collapse | |
| Hybrid threshold | Full tree for small repos, lazy for large ones | |

**User's choice:** Lazy per-directory
**Notes:** None

## Tree Visual Style

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal with chevrons | Chevrons only, no icons, monospace | |
| Icons + chevrons | File-type emoji icons alongside chevrons | ✓ |
| VS Code style | Indentation guides, file-type icons, hover highlight | |

**User's choice:** Icons + chevrons
**Notes:** None

## Selection Highlighting

| Option | Description | Selected |
|--------|-------------|----------|
| Background highlight | Subtle blue/accent background for selected, lighter gray for hover | ✓ |
| Left border accent | Left blue border line | |
| Bold text + accent | Bold name with accent color text | |

**User's choice:** Background highlight
**Notes:** None

## Pending Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| Muted placeholder text | "Awaiting LLM analysis" in gray italic, sections still visible | ✓ |
| Hide empty sections | Only show sections with data | |
| Section headers with badge | Headers visible with "pending" badge, collapsed | |

**User's choice:** Muted placeholder text
**Notes:** None

## Directory Detail

| Option | Description | Selected |
|--------|-------------|----------|
| Aggregate stats + top files | Stats + ranked top 10 files by importance (clickable) | ✓ |
| Stats only | Just aggregate numbers | |
| Full file listing | Every file with mini-stats | |

**User's choice:** Aggregate stats + top files
**Notes:** None

## Concepts Rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Colored tag pills by group | Purpose as text, then Functions(blue), Classes(purple), Interfaces(green), Exports(gray) as pills | ✓ |
| Grouped plain lists | Bullet lists per group, no color coding | |
| Single flat list | All identifiers with kind prefix | |

**User's choice:** Colored tag pills by group
**Notes:** None

## Change Impact Display

| Option | Description | Selected |
|--------|-------------|----------|
| Risk badge + summary + lists | Colored badge (LOW/MED/HIGH), summary, affected areas and breaking changes as lists | ✓ |
| Compact one-liner | Badge + summary on one line, lists only if non-empty | |
| Card with color border | Full card with left color border | |

**User's choice:** Risk badge + summary + lists
**Notes:** None

## API Shapes

| Option | Description | Selected |
|--------|-------------|----------|
| Lock down key shapes now | Define tree, file, dir endpoint response types | ✓ |
| Claude's discretion | Let planner figure out shapes | |

**User's choice:** Lock down key shapes now
**Notes:** Shapes defined in CONTEXT.md D-14 through D-16

## Exports Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by kind with signatures | Group by kind (fn, class, var, type), show signature in monospace | ✓ |
| Flat table | Name / Kind / Signature table | |
| Code block style | Faux TypeScript declaration file | |

**User's choice:** Grouped by kind with signatures
**Notes:** None

## Claude's Discretion

- Resizable divider implementation approach
- File-type icon mapping
- Exact Tailwind classes
- Empty concept group handling
- Tree indentation depth
- Loading states

## Deferred Ideas

None — discussion stayed within phase scope.
