# Phase 38: MCP Surface — Verification

**Phase exit gate** — every requirement has test evidence.

## Requirements Coverage

### MCP-01: find_callers tool registration and response contract

| Test File | Describe Block | Test Name |
|-----------|----------------|-----------|
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > basic caller resolution` | `returns callers with correct envelope shape when edges exist` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > basic caller resolution` | `returns {items:[], total:0, unresolvedCount:0} for unknown symbol` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > filePath filter (D-04)` | `restricts target to the specified defining file` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > self-loop exclusion` | `excludes recursive self-calls from getCallers results` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > maxItems clamping` | `clamps maxItems=0 to 1 — does not throw` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > maxItems clamping` | `clamps maxItems=1000 to 500` |
| `tests/unit/find-callers-callees.test.ts` | `getCallers — Phase 38-01 > unresolvedCount (D-06)` | `reports dangling caller references when caller symbol is deleted` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `returns correct envelope shape for a known callee` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `clamps maxItems 0 to 1` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `clamps maxItems 1000 to 500` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `excludes self-loops (recursive call not in callers)` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `returns empty result for non-existent symbol` |

### MCP-02: find_callees tool registration and response contract

| Test File | Describe Block | Test Name |
|-----------|----------------|-----------|
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > basic callee resolution` | `returns callees with correct envelope shape when edges exist` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > basic callee resolution` | `returns {items:[], total:0, unresolvedCount:0} for unknown symbol` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > filePath filter (D-04)` | `restricts caller lookup to the specified file` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > self-loop exclusion` | `excludes recursive self-calls from getCallees results` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > maxItems clamping` | `clamps maxItems=0 to 1 — does not throw` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > maxItems clamping` | `clamps maxItems=1000 to 500` |
| `tests/unit/find-callers-callees.test.ts` | `getCallees — Phase 38-01 > unresolvedCount (D-06, reversed direction)` | `reports dangling callee references when callee symbol is deleted` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `returns correct envelope shape for a known caller` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `clamps maxItems 0 to 1` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `clamps maxItems 1000 to 500` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `returns empty result for non-existent symbol` |

### MCP-03: Tool descriptions document Ruby limitations

| Evidence | Location |
|----------|----------|
| `grep 'attr_accessor' src/mcp-server.ts` returns 3 matches | `find_symbol`, `find_callers`, and `find_callees` description arrays |
| `grep 'Reopened Ruby' src/mcp-server.ts` returns 5 matches | `find_symbol`, `find_callers`, and `find_callees` description arrays (multiple sentences) |

Verification commands:

```bash
grep -c 'attr_accessor' src/mcp-server.ts   # expect >= 3
grep -c 'Reopened Ruby' src/mcp-server.ts   # expect >= 3
```

### MCP-04: InMemoryTransport integration tests

| Test File | Describe Block | Test Name |
|-----------|----------------|-----------|
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `returns correct envelope shape for a known callee` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `clamps maxItems 0 to 1` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `clamps maxItems 1000 to 500` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `excludes self-loops (recursive call not in callers)` |
| `tests/integration/mcp-transport.test.ts` | `find_callers` | `returns empty result for non-existent symbol` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `returns correct envelope shape for a known caller` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `clamps maxItems 0 to 1` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `clamps maxItems 1000 to 500` |
| `tests/integration/mcp-transport.test.ts` | `find_callees` | `returns empty result for non-existent symbol` |

## Verification Commands

```bash
# Unit tests (MCP-01, MCP-02)
npx vitest run tests/unit/find-callers-callees.test.ts --reporter=verbose

# Integration tests (MCP-04)
npx vitest run tests/integration/mcp-transport.test.ts --reporter=verbose

# MCP-03: Ruby limitation in descriptions
grep -c 'attr_accessor' src/mcp-server.ts   # expect >= 3 (find_symbol + find_callers + find_callees)
grep -c 'Reopened Ruby' src/mcp-server.ts   # expect >= 3

# Build check
npm run build
```

**Phase 38 exit gate: PASS**
