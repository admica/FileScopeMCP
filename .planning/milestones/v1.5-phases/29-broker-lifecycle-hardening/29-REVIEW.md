---
phase: 29-broker-lifecycle-hardening
reviewed: 2026-04-17T17:21:28Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/broker/client.ts
  - src/broker/config.ts
  - src/broker/main.ts
  - src/broker/server.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-04-17T17:21:28Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the four broker lifecycle files: client, config, main, and server. The code is well-structured with clear separation of concerns, proper error handling patterns, and good defensive programming (PID guards, stale socket cleanup, graceful shutdown). The main concerns are: (1) a TOCTOU race in `spawnBrokerIfNeeded` mitigated by the server-side PID guard but worth documenting, (2) the `close` event handler in `attemptConnect` shadowing the outer `resolve` variable, (3) `socket!` non-null assertions that bypass TypeScript safety, (4) `process.exit(1)` in `loadBrokerConfig` preventing testability, and (5) loose `catch (e: any)` typing in `isPidRunning` that could mask bugs. No critical issues found -- the server-side PID guard in `main.ts` prevents the TOCTOU race from causing actual damage.

## Warnings

### WR-01: TOCTOU Race Window in spawnBrokerIfNeeded

**File:** `src/broker/client.ts:124-157`
**Issue:** There is a time-of-check-to-time-of-use race between `spawnBrokerIfNeeded` checking `existsSync(SOCK_PATH)` / reading the PID file and spawning a new broker. If two MCP instances call `connect()` simultaneously, both can pass the PID liveness check, both clean up the "stale" socket, and both spawn a new broker. The server-side PID guard in `main.ts:33-48` prevents actual damage (the second broker exits cleanly with code 0), but the race wastes a process spawn and adds startup latency under heavy concurrent startup (e.g., opening 5+ repos simultaneously).

**Fix:** The race is benign due to the server-side guard. Minimal fix is to document the accepted race:
```typescript
// NOTE: Race between concurrent clients is handled server-side by the PID guard
// in main.ts -- worst case is a redundant spawn that exits immediately.
```

### WR-02: Variable Shadowing of `resolve` in `attemptConnect` Close Handler

**File:** `src/broker/client.ts:191`
**Issue:** The `close` event handler on line 191 iterates `pendingStatusRequests.values()` using `for (const resolve of ...)` which shadows the outer Promise `resolve` from line 164. This works correctly today because the outer `resolve` is called before `close` fires (it is called in the `connect` or `error` handler first), but the shadowing makes the code fragile. If future changes move logic around, the wrong `resolve` could be called, silently breaking the Promise contract.

**Fix:** Rename the inner variable to avoid shadowing:
```typescript
for (const resolver of pendingStatusRequests.values()) {
  resolver(null);
}
```

### WR-03: `socket!` Non-null Assertion After `isConnected()` Check Without Atomicity

**File:** `src/broker/client.ts:88, 113`
**Issue:** Both `submitJob` (line 88) and `requestStatus` (line 113) check `isConnected()` then use `socket!.write(...)`. The non-null assertion `socket!` bypasses TypeScript's null safety. While currently safe due to Node.js single-threaded execution within a synchronous tick, if a future refactor introduces an `await` between the check and the write, this becomes a null dereference at runtime with no compile-time warning.

**Fix:** Capture the socket reference locally to let TypeScript narrow the type:
```typescript
export function submitJob(...): void {
  const sock = socket;
  if (!sock || sock.destroyed) return;

  const msg: SubmitMessage = { ... };
  sock.write(JSON.stringify(msg) + '\n');
}
```
Same pattern for `requestStatus`.

### WR-04: `process.exit(1)` in `loadBrokerConfig` Prevents Composability

**File:** `src/broker/config.ts:62`
**Issue:** When config validation fails, `loadBrokerConfig` calls `process.exit(1)` directly. This makes the function impossible to unit test (tests would terminate the process) and prevents callers from handling the error gracefully. The error message is logged to `console.error` rather than through the logger module, which is inconsistent with the rest of the codebase.

**Fix:** Throw an error instead. The caller (`main.ts:144`) already has a catch handler that logs and exits:
```typescript
if (!result.success) {
  throw new Error(`Invalid broker config at ${CONFIG_PATH}:\n${result.error.message}`);
}
```

### WR-05: `catch (e: any)` Loose Typing in `isPidRunning`

**File:** `src/broker/main.ts:27`
**Issue:** The catch clause uses `e: any` to access `e.code`. This bypasses TypeScript's type checking entirely. A typo like `e.cod` would silently produce `undefined`, causing the comparison `e.cod !== 'ESRCH'` to evaluate to `true`, making `isPidRunning` return `true` for a dead process. This would cause `checkPidGuard` to exit prematurely (line 38), preventing the broker from starting when it should.

**Fix:** Use a type guard for safety:
```typescript
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e) {
      return (e as NodeJS.ErrnoException).code !== 'ESRCH';
    }
    return false; // Unknown error shape -- assume not running
  }
}
```

## Info

### IN-01: Reconnect Timer Calls Both `spawnBrokerIfNeeded` and `attemptConnect` Sequentially

**File:** `src/broker/client.ts:302-306`
**Issue:** Every 10-second reconnect tick calls `spawnBrokerIfNeeded()` then `attemptConnect()`. If the broker is running but the connection just failed transiently, `spawnBrokerIfNeeded` still performs `existsSync` + `readFileSync` + `process.kill(pid, 0)` checks every tick. This is correct but slightly wasteful.

**Fix:** No action needed -- the overhead is negligible (3 syscalls every 10s). Noting for awareness.

### IN-02: `handleMessage` Uses Untyped `msg: any`

**File:** `src/broker/server.ts:147`
**Issue:** The `handleMessage` method accepts `msg: any` after JSON parsing. The parsed message is not validated against the `ClientMessage` type before routing. A malformed message with `type: 'submit'` but missing required fields would be cast to `SubmitMessage` on line 150 without validation, potentially creating a `QueueJob` with undefined fields that propagate silently through the system.

**Fix:** Add a basic type guard at the entry point:
```typescript
private handleMessage(msg: unknown, socket: net.Socket): void {
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
    log('Invalid message: missing type field');
    return;
  }
  // ... rest of switch
}
```

### IN-03: Default Config Copy Uses Relative Path That Depends on Dist Layout

**File:** `src/broker/config.ts:51-53`
**Issue:** The path `../broker.default.json` is resolved relative to the compiled `dist/broker/config.js` location. This couples the config module to the specific build output directory structure. If the build changes (e.g., flat output), `copyFileSync` will throw `ENOENT`, crashing the broker on first run with a confusing error.

**Fix:** Add an existence check before copying with a clear error message:
```typescript
if (!fs.existsSync(defaultPath)) {
  throw new Error(`Default broker config not found at ${defaultPath}. Ensure the package is built correctly.`);
}
fs.copyFileSync(defaultPath, CONFIG_PATH);
```

---

_Reviewed: 2026-04-17T17:21:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
