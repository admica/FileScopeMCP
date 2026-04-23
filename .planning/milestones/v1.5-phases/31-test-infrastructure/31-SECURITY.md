---
phase: 31
slug: test-infrastructure
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-21
---

# Phase 31 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Phase 31 adds test infrastructure only — no new network endpoints, no new auth paths, no new production code paths beyond adding `export` to `registerTools` in `src/mcp-server.ts`. Threats are scoped to test lifecycle (temp dir cleanup, orphaned child processes, mocked watchers).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Test process → `os.tmpdir()` | Integration tests create SQLite DBs and JSON config files in throwaway temp dirs | SQLite DB files, synthetic `sample.ts`, malformed JSON fixtures |
| Test process → broker child process | Broker lifecycle tests spawn `dist/broker/main.js` | SIGTERM/SIGKILL signals, Unix socket `~/.filescope/broker.sock`, PID file `~/.filescope/broker.pid` |
| Test process → mcp-server child process | Stdout smoke test spawns `dist/mcp-server.js` with `cwd=os.tmpdir()` | JSON-RPC initialize message on stdin, stdout inspection |
| Test process → mocked chokidar | `vi.mock('chokidar')` replaces real watcher with in-memory EventEmitter | Synthetic event emissions (add/change/unlink) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-31-01 | I (Information Disclosure) | temp dir with test SQLite DB | mitigate | `afterAll` calls `fs.rm(tmpDir, {recursive: true, force: true})` — verified at `tests/integration/mcp-transport.test.ts:83` | closed |
| T-31-02 | D (Denial of Service) | unclosed DB / transport in test process | mitigate | `afterAll` explicitly closes client, server, coordinator, DB — verified at `tests/integration/mcp-transport.test.ts:70-80` | closed |
| T-31-03 | D (Denial of Service) | orphaned broker child process | mitigate | `afterEach` try/finally kills broker (SIGTERM) + `rmSync({force:true})` on socket and PID file — verified at `tests/integration/broker-lifecycle.test.ts:118-134,139-142` | closed |
| T-31-04 | D (Denial of Service) | orphaned mcp-server child process | mitigate | try/finally sends `proc.kill('SIGTERM')` with 3s fallback — verified at `tests/integration/mcp-stdout.test.ts:55` | closed |
| T-31-05 | I (Information Disclosure) | `~/.filescope/broker.sock` in user home dir | accept | Broker is local-only Unix socket; no credentials in flight; same path as production broker (already in product threat model) | closed |
| T-31-06 | E (Elevation of Privilege) | tests spawn child processes | accept | Tests run as same user; no elevated privileges; broker binary is project-owned code built from repo | closed |
| T-31-07 | I (Information Disclosure) | config-loading temp dir (JSON fixtures) | mitigate | `afterAll` calls `fs.rm(tmpDir, {recursive: true, force: true})` — verified at `tests/unit/config-loading.test.ts:17-18` | closed |
| T-31-08 | D (Denial of Service) | real chokidar watcher accidentally started in unit test | mitigate | `vi.mock('chokidar')` replaces module with controlled EventEmitter — verified at `tests/unit/file-watcher.test.ts:10`; `afterEach watcher.stop()` at line 64-65 | closed |
| T-31-09 | T (Tampering) | config test writes files to tmpdir | accept | Tests create controlled JSON files in `os.tmpdir()`; no production paths touched; temp dir removed in afterAll | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-31-01 | T-31-05 | Broker socket lives at production path `~/.filescope/broker.sock` — no feasible isolation without rewiring broker config; local-only Unix socket holds no credentials | admica | 2026-04-21 |
| R-31-02 | T-31-06 | Child process spawn inherits user's own privileges by design; broker binary is repo-built code already in trust boundary | admica | 2026-04-21 |
| R-31-03 | T-31-09 | Test fixtures intentionally write malformed JSON to `os.tmpdir()` to exercise loadConfig error paths; tmpdir is removed on teardown | admica | 2026-04-21 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-21 | 9 | 9 | 0 | /gsd-secure-phase (admica) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-21
