# Phase 31: Test Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 31-test-infrastructure
**Areas discussed:** Test organization, Broker lifecycle testing, Coverage enforcement, CI smoke test design

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Test organization | Where new tests live — consolidate or keep split? | |
| Broker lifecycle testing | Real binary vs mocked, WSL2 signal concern | |
| Coverage enforcement | Threshold gates vs advisory vs gap report only | |
| CI smoke test design | Where stdout pollution check runs | |

**User's choice:** "you let me know whats best" — deferred all decisions to Claude's judgment
**Notes:** User selected "Other" and asked Claude to make all decisions. No specific preferences expressed.

---

## Claude's Discretion

All four gray areas were deferred to Claude's judgment:

1. **Test organization** — Keep existing split pattern (src/ co-located, tests/unit/, tests/integration/)
2. **Broker lifecycle testing** — Real binary with pool: 'forks', spike first per STATE.md
3. **Coverage enforcement** — Advisory only, no CI gate, per-subsystem gap report
4. **CI smoke test** — Vitest test in tests/integration/, runs with npm test

## Deferred Ideas

None — discussion stayed within phase scope.
