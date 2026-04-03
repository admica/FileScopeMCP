# Phase 23: System View + Live Activity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 23-system-view-live-activity
**Areas discussed:** Broker status display, Token usage visualization, Activity feed layout, Page layout composition

---

## Broker Status Display

| Option | Description | Selected |
|--------|-------------|----------|
| Status card with stats grid | Single card with green badge, model name, 2x2 grid | |
| Compact status bar | Horizontal bar with inline badges | ✓ |
| Dashboard gauges | Circular gauges, progress indicators | |

**User's choice:** Compact status bar
**Notes:** Horizontal layout with inline badges for pending/active/clients

---

| Option | Description | Selected |
|--------|-------------|----------|
| Same card, grayed out | Same layout, fields show '--', badge says 'Offline' | ✓ |
| Collapsed banner | Single-line 'Broker: Offline' banner | |

**User's choice:** Same card, grayed out
**Notes:** No error styling — offline is expected

---

| Option | Description | Selected |
|--------|-------------|----------|
| Subtle pulse on status badge | Badge briefly pulses on each poll | ✓ |
| Countdown timer | Small countdown next to status | |
| No indicator | Data updates silently | |

**User's choice:** Subtle pulse on status badge

---

| Option | Description | Selected |
|--------|-------------|----------|
| File path + job type | Full relative path + job type | |
| File name + type + repo | Short name + type + repo name | ✓ |
| Animated spinner + file name | Spinning icon + file name only | |

**User's choice:** File name + type + repo

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, show model name | Display Ollama model name in status bar | ✓ |
| No, skip it | Model name only in broker.json | |

**User's choice:** Yes, show model name

---

| Option | Description | Selected |
|--------|-------------|----------|
| Badge with count | "2 clients" as small badge/pill | ✓ |
| Count + repo names | Expand to show connected repo names | |
| You decide | Claude picks best approach | |

**User's choice:** Badge with count

---

## Token Usage Visualization

| Option | Description | Selected |
|--------|-------------|----------|
| D3 horizontal bar chart | Horizontal bars per repo, sorted by count | ✓ |
| Simple table with numbers | Repo name, token count, formatted | |
| Stacked cards per repo | One card per repo with proportional bar | |

**User's choice:** D3 horizontal bar chart

---

| Option | Description | Selected |
|--------|-------------|----------|
| Human-readable (1.2M, 450K) | Abbreviated with K/M suffixes | |
| Full numbers with commas | 1,234,567 tokens | |
| Both (hover for full) | Abbreviated default, hover for exact | ✓ |

**User's choice:** Both (hover for full)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Lifetime only | Just stats.json totals | |
| Lifetime + session delta | Lifetime total + '+X this session' | ✓ |

**User's choice:** Lifetime + session delta

---

## Activity Feed Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Monospace terminal-style | Dark bg, monospace, color-coded prefixes | |
| Structured list | Rows with timestamp column, prefix badge, message | ✓ |
| You decide | Claude picks best approach | |

**User's choice:** Structured list

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed palette per prefix | Each known prefix gets specific color | |
| Auto-assigned colors | Colors assigned dynamically by unique prefix | ✓ |

**User's choice:** Auto-assigned colors

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-scroll with pause | Auto-scrolls, pauses on user scroll up | ✓ |
| Always auto-scroll | New entries always scroll into view | |
| Manual scroll only | User must scroll down manually | |

**User's choice:** Auto-scroll with pause

---

| Option | Description | Selected |
|--------|-------------|----------|
| Prefix filter dropdown | Filter by log prefix | ✓ |
| Text search box | Free-text filter against full line | |
| No filtering | Show all 500 lines, keep simple | |

**User's choice:** Prefix filter dropdown

---

## Page Layout Composition

| Option | Description | Selected |
|--------|-------------|----------|
| Top bar + two columns | Broker bar top, token chart left, feed right | |
| Stacked sections | Three full-width sections stacked vertically | ✓ |
| Feed-dominant | Feed takes 70%, sidebar for broker+tokens | |

**User's choice:** Stacked sections
**Notes:** User confirmed after reviewing ASCII preview mockups

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fill remaining viewport | CSS calc(100vh - offset) | ✓ |
| Fixed height (400-500px) | Consistent height | |
| You decide | Claude picks best | |

**User's choice:** Fill remaining viewport

---

## Claude's Discretion

- D3 bar chart styling details
- Pulse animation timing
- Prefix badge visual design
- "Jump to latest" button placement
- Token chart section height
- Model name data source (broker.sock vs config read)
- Timestamp formatting
- Session delta display format

## Deferred Ideas

None — discussion stayed within phase scope.
