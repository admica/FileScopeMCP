# Phase 24: Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 24-polish
**Areas discussed:** Heat color mapping, Staleness visual treatment, Tab status dots, Settings page UX, Responsive breakpoints, Repo validation

---

## Heat Color Mapping

### How should importance heat color appear on tree entries?

| Option | Description | Selected |
|--------|-------------|----------|
| Left-edge color bar | 2px vertical bar on the left edge of each file row, colored by importance. Subtle but scannable. | ✓ |
| Colored dot before name | Small circle dot between file icon and name | |
| Text color tinting | Filename text tinted by importance | |
| Background highlight | Subtle background color wash across entire row | |

**User's choice:** Left-edge color bar
**Notes:** Similar to VS Code problem indicators.

### How should the 0-10 importance map to colors?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-bucket discrete | 0-1 gray, 2-3 blue, 4-5 green, 6-7 yellow, 8-10 red | ✓ |
| Smooth CSS gradient | Continuous color interpolation from gray to red | |
| 3-tier simple | 0-3 gray, 4-6 blue/green, 7-10 yellow/red | |

**User's choice:** 5-bucket discrete
**Notes:** Simple, distinct boundaries.

---

## Staleness Visual Treatment

### How should staleness appear on tree file entries?

| Option | Description | Selected |
|--------|-------------|----------|
| Small icon after name | Stale files get indicator after filename. Fresh shows nothing. | ✓ |
| Overlay on file icon | Small orange dot overlay on file type icon | |
| Name opacity change | Stale files dimmed (opacity 0.6) | |

**User's choice:** Small icon after name

### What indicator for stale files?

| Option | Description | Selected |
|--------|-------------|----------|
| Orange dot | Small orange circle after filename | |
| Refresh arrow | Small ⟳ icon in orange/yellow, suggests "needs update" | ✓ |
| Warning triangle | Small ⚠ in yellow/orange | |

**User's choice:** Refresh arrow (⟳)
**Notes:** Communicates "needs update" rather than "error" or "warning".

---

## Tab Status Dots

### Per-repo MCP instance status detection

| Option | Description | Selected |
|--------|-------------|----------|
| Stale count heuristic | Green if staleCount==0, orange if staleCount>0, gray if offline | |
| New broker endpoint | Add broker protocol message returning connected repo paths | |
| Recent activity heuristic | Green if repo has had file changes processed recently (data.db mtime) | ✓ |

**User's choice:** Recent activity heuristic
**Notes:** Avoids new broker protocol messages. Claude noted that broker's repoTokens could also serve as activity signal.

### Where should the status dot appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Before repo name | Small dot left of tab text (● RepoName) | ✓ |
| After repo name | Small dot right of tab text | |
| Superscript corner | Tiny dot in top-right corner like notification badge | |

**User's choice:** Before repo name

---

## Settings Page UX

### Initial proposal: add/remove repo form

**User's feedback:** Rejected manual add entirely. Repos should be auto-discovered. Remove should be a blacklist — hide the repo from Nexus view, ignore it in future auto-discovery, but don't affect the MCP instance.

### Repo list layout

| Option | Description | Selected |
|--------|-------------|----------|
| Table with inline actions | Rows with name, path, status, delete button | ✓ |
| Card list | Each repo as a card | |
| Minimal list + toolbar | Text list with toolbar actions | |

**User's choice:** Table with inline actions

### Removal confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm dialog | Click delete → confirmation prompt → Confirm/Cancel | ✓ |
| Instant removal | Immediate, no confirmation | |
| Undo toast | Remove immediately, show undo toast for 5s | |

**User's choice:** Confirm dialog

### Blacklist visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Always visible section | Active + Blacklisted tables both always visible | ✓ |
| Collapsible section | Blacklist hidden under toggle | |
| You decide | Claude's discretion | |

**User's choice:** Always visible section

---

## Responsive Breakpoints

### Tree/detail panel at narrow widths (1024px)

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible tree panel | Below ~1280px, tree collapses behind toggle. Detail gets full width. | ✓ |
| Stacked layout | Tree above detail vertically | |
| Proportional shrink | Same side-by-side, just narrower | |

**User's choice:** Collapsible tree panel

### Wide viewport (2560px) behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Max-width container | Cap at ~1920px centered | |
| Full width always | Use all available width | ✓ |
| You decide | Claude's discretion | |

**User's choice:** Full width always

---

## Claude's Discretion

- Exact Tailwind color shades for heat buckets
- Tab dot implementation (extend /api/repos vs separate poll)
- Collapsible tree toggle mechanism
- Graph view responsive behavior
- Confirm dialog implementation style

## Deferred Ideas

None — discussion stayed within phase scope
