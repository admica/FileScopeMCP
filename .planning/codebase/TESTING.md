# Testing Patterns

**Analysis Date:** 2026-03-02

## Test Framework

**Runner:**
- Vitest 3.1.4
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in expect API (`expect()`)

**Run Commands:**
```bash
npm test                    # Run all tests
npm test -- --watch        # Watch mode (inferred from vitest capabilities)
npm run coverage           # Generate coverage report
```

**Configuration Details (`vitest.config.ts`):**
- Environment: Node.js
- Coverage provider: v8
- Coverage reporters: text, json, html
- Globals enabled: `true` (allows `describe`, `it`, `expect` without imports)

## Test File Organization

**Location:**
- Co-located with source: `src/file-utils.test.ts` next to `src/file-utils.ts`
- Test files live in `src/` directory alongside implementation

**Naming:**
- Pattern: `{module}.test.ts`
- Example: `file-utils.test.ts` tests `file-utils.ts`

**Structure:**
```
src/
  file-utils.ts
  file-utils.test.ts      # 269 lines
  {other modules}
  {other tests}           # Only one test file currently exists
```

## Test Structure

**Suite Organization:**
```typescript
import { normalizePath, toPlatformPath, globToRegExp } from './file-utils';
import { describe, it, expect } from 'vitest';
import * as path from 'path';

describe('normalizePath', () => {
  it('should return an empty string for empty input', () => {
    expect(normalizePath('')).toBe('');
  });

  it('should handle basic Unix paths', () => {
    expect(normalizePath('/usr/local/bin')).toBe('/usr/local/bin');
  });
});

describe('toPlatformPath', () => {
  it('should convert normalized path to current platform path', () => {
    const normalized = 'some/test/path';
    const expected = ['some', 'test', 'path'].join(path.sep);
    expect(toPlatformPath(normalized)).toBe(expected);
  });
});

describe('globToRegExp', () => {
  it('should convert basic wildcard *', () => {
    const regex = globToRegExp('*.ts');
    expect(regex.test('file.ts')).toBe(true);
  });
});
```

**Patterns:**
- Each `describe()` block tests one exported function
- Descriptive test names starting with "should": `'should handle basic Unix paths'`
- Inline comments for expected behavior and edge cases
- Simple arrange-act-assert pattern within each test
- No setup/teardown hooks found (not needed for utility testing)

## Mocking

**Framework:** Not detected

**Patterns:**
- No mocking framework configured or used
- Tests use real file system operations and RegExp objects
- Platform-dependent tests use `path.sep` for cross-platform compatibility

**What to Mock:**
- File system operations would require mocks in integration tests (not present)
- External APIs would need mocks (none currently tested)

**What NOT to Mock:**
- Utility functions like path normalization (tested directly)
- RegExp matching (tested directly)
- Path module functions (from Node.js stdlib, not mocked)

## Fixtures and Factories

**Test Data:**
```typescript
// Simple literal test data in tests
const normalized = 'some/test/path';
const expected = ['some', 'test', 'path'].join(path.sep);

// Platform-specific paths
const windowsPath = 'C:\\Users\\Default';
const unixPath = '/usr/local/bin';

// Glob patterns
const globPattern = '*.ts';
const filePath = 'file.ts';
```

**Location:**
- Test data defined inline within test functions
- No separate fixtures directory
- No factory functions for test object creation

## Coverage

**Requirements:** Not enforced

**View Coverage:**
```bash
npm run coverage
```

**Coverage Output Locations:**
- Text output: console
- JSON: `coverage/coverage-final.json`
- HTML: `coverage/index.html`

## Test Types

**Unit Tests:**
- Scope: Individual utility functions (`normalizePath`, `toPlatformPath`, `globToRegExp`)
- Approach: Direct function calls with input/output assertion
- All 269 lines of tests are unit tests

**Integration Tests:**
- Scope: Not present in codebase
- Comment in tests acknowledges complex glob patterns and their interactions with filesystem

**E2E Tests:**
- Framework: Not used
- The codebase does not contain end-to-end tests

## Common Patterns

**Basic Assertion Pattern:**
```typescript
it('should handle basic Windows paths', () => {
  expect(normalizePath('C:\\Users\\Default')).toBe('C:/Users/Default');
});
```

**Multiple Assertions Per Test:**
```typescript
it('should remove duplicate slashes', () => {
  expect(normalizePath('some//path///to////file.txt')).toBe('some/path/to/file.txt');
  expect(normalizePath('C:\\\\Users')).toBe('C:/Users');
});
```

**Platform-Aware Testing:**
```typescript
it('should convert normalized path to current platform path', () => {
  const normalized = 'some/test/path';
  const expected = ['some', 'test', 'path'].join(path.sep);  // platform-specific separator
  expect(toPlatformPath(normalized)).toBe(expected);
});
```

**Edge Case Comments in Tests:**
```typescript
it('should remove trailing slashes but not from root (actual behavior)', () => {
  expect(normalizePath('/some/path/')).toBe('/some/path');
  expect(normalizePath('C:\\Users\\Default\\')).toBe('C:/Users/Default');
  // Corrected expectations based on actual function behavior:
  expect(normalizePath('C:/')).toBe('C:');
  expect(normalizePath('/')).toBe('');
});
```

**Complex RegExp Testing with Comments:**
```typescript
it('should handle ** for directory globbing', () => {
  // Referring to the actual implementation in file-utils.ts:
  // If pattern starts with '**/', it's removed and prefix '(?:.*/)?' is added.
  // Then '**' is replaced by '.*'
  // So, '**/test/*.js' becomes regex /^(?:.*\/)?test\/[^/\\]*\.js$/i
  let regex = globToRegExp('**/test/*.js');
  expect(regex.test('some/other/test/file.js')).toBe(true);
  expect(regex.test('test/file.js')).toBe(true);
});
```

## Test Coverage Status

**Current Coverage:**
- Only `file-utils.ts` has comprehensive tests (269 test cases for path utilities)
- No tests for:
  - `mcp-server.ts` (1114 lines) - core MCP functionality
  - `storage-utils.ts` (268 lines) - persistence layer
  - `file-watcher.ts` (233 lines) - file watching
  - `config-utils.ts` (105 lines) - configuration
  - `global-state.ts` (74 lines) - state management
  - `logger.ts` (35 lines) - logging

**Gap Analysis:**
- File tree building and dependency analysis untested
- File watcher event handling untested
- Configuration loading/saving untested
- MCP server tools untested
- Error handling paths in most modules untested

## Future Testing Recommendations

**High Priority:**
- Add tests for `mcp-server.ts` tool implementations (set_project_path, build_tree, etc.)
- Add tests for `file-watcher.ts` event callbacks
- Add tests for `storage-utils.ts` save/load operations

**Medium Priority:**
- Add tests for error handling paths (malformed configs, missing files)
- Add tests for `config-utils.ts` with invalid JSON
- Integration tests for file tree building on real directory structure

**Low Priority:**
- Tests for logger output formatting
- Tests for global state management

---

*Testing analysis: 2026-03-02*
