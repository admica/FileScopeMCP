# Coding Conventions

**Analysis Date:** 2026-03-02

## Naming Patterns

**Files:**
- Lowercase with hyphens: `file-utils.ts`, `file-watcher.ts`, `config-utils.ts`, `global-state.ts`
- Test files: `{name}.test.ts` (co-located with source)
- Type definition files: `types.ts`
- Utility modules use descriptive suffixes: `-utils.ts`, `-state.ts`

**Functions:**
- camelCase for function names: `normalizePath()`, `buildFileTree()`, `saveFileTree()`, `loadFileTree()`
- Prefix helper functions with their context: `createFileTreeConfig()`, `ensureDirectoryExists()`, `getIgnoredPatterns()`
- Boolean functions use `is`, `has`, or `get` prefixes: `isWatching`, `isDirectory`, `existsSync()`

**Variables:**
- camelCase for local and module-level variables: `fileTree`, `currentConfig`, `baseDir`, `projectRoot`
- Use leading underscore for private module state: `_projectRoot`, `_config`, `_customExcludesLoaded`
- UPPERCASE_SNAKE_CASE for constants: `DEFAULT_FILE_WATCHING`, `DEBOUNCE_DURATION_MS`, `INTEGRITY_SWEEP_INTERVAL_MS`, `DEFAULT_CONFIG`
- Numeric constants with explicit units: `30_000` (not `30000`)

**Types:**
- PascalCase for classes: `FileNode`, `FileWatcher`, `PackageDependency`, `FileTreeConfig`
- PascalCase for interfaces: `Config`, `FileWatchingConfig`, `ToolResponse`
- camelCase for type aliases: `FileEventType` (when wrapping literal unions), `FileEventCallback`
- Descriptive names reflecting purpose: `FileTreeStorage`, `SimpleFileNode`

**Private Members:**
- Use `private` keyword for class properties and methods: `private watcher`, `private config`, `private getIgnoredPatterns()`
- Use `public` for class methods that are part of API: `public start()`, `public stop()`, `public addEventCallback()`
- Use `readonly` for immutable class properties: `private readonly maxRestartDelay`

## Code Style

**Formatting:**
- No explicit linter/formatter config found (no `.eslintrc`, `.prettierrc`, or `biome.json`)
- Uses TypeScript's `strict: true` for type safety (configured in `tsconfig.json`)
- Imports use `.js` extension for ESM modules: `import { log } from './logger.js'`
- Uses double quotes for strings: `"import"`, `"error"`, `"utf-8"`
- Method bodies use consistent indentation (2 spaces)

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- No formal linting rules enforced beyond TypeScript compilation

## Import Organization

**Order:**
1. Node.js built-in modules: `import * as fs from 'fs'`, `import * as path from 'path'`
2. Third-party packages: `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`, `import { z } from 'zod'`, `import * as chokidar from 'chokidar'`
3. Local modules: `import { FileNode } from "./types.js"`, `import { normalizePath } from './file-utils.js'`

**Path Aliases:**
- No path aliases configured
- Relative imports use `./` prefix: `from './types.js'`, `from './file-utils.js'`
- All imports include `.js` extension for ESM modules

## Error Handling

**Patterns:**
- Try-catch blocks wrap potentially failing operations
- Errors logged via `log()` function or `console.error()` for debugging
- Fallback values returned on error: `return filepath;` (in `normalizePath`), `return DEFAULT_CONFIG` (in `loadConfig`)
- Specific error handling for EEXIST codes in async operations: `if ((error as NodeJS.ErrnoException).code !== 'EEXIST')`
- Error casting pattern: `error as NodeJS.ErrnoException`, `error as Error`

**Example from `file-utils.ts`:**
```typescript
try {
  const decoded = filepath.includes('%') ? decodeURIComponent(filepath) : filepath;
  // ... processing
  return deduped.endsWith('/') ? deduped.slice(0, -1) : deduped;
} catch (error) {
  log(`Failed to normalize path: ${filepath} - ${error}`);
  return filepath;  // Fallback to original
}
```

**Example from `storage-utils.ts`:**
```typescript
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}
```

## Logging

**Framework:** Custom logger module at `src/logger.ts`

**Patterns:**
- Use `log()` function for debug/info messages: `log('Initializing project at: ' + projectPath)`
- Use `console.error()` for startup/diagnostic output in config-utils: `console.error('🔧 LOADING CONFIG')`
- Include timestamps in logged messages (via `log()`)
- Log to file optionally via `enableFileLogging(enable, filePath)`
- Log objects via JSON.stringify: `JSON.stringify(arg)` in logger

**Log Levels:** Single unified `log()` function; no separate debug/warn/error levels

## Comments

**When to Comment:**
- JSDoc comments for exported functions and classes with parameters/return types
- Inline comments for complex logic or edge cases
- Comments explain *why*, not *what*

**JSDoc/TSDoc Pattern:**
```typescript
/**
 * Normalizes a file path for consistent comparison across platforms
 * Handles Windows and Unix paths, relative and absolute paths
 */
export function normalizePath(filepath: string): string {
```

**Inline Comments:**
- Used for clarification of complex conditions: `// Handle absolute imports (from project root)`
- Used for edge cases: `// EEXIST is fine - directory already exists`
- Used for state management: `// Invalidate the in-memory cache so next loadFileTree reads fresh from disk`

## Function Design

**Size:**
- Utility functions range from 10-50 lines
- Complex functions use nested helper functions: `findAndUpdate()` within `updateFileNode()`
- Large files (`file-utils.ts` 1395 lines, `mcp-server.ts` 1114 lines) use clear section separation via comments

**Parameters:**
- Keep parameter lists short (1-3 params typical)
- Use optional parameters for configuration: `loadConfig(configPath?: string)`
- Use object parameters for multiple related values: `createFileTreeConfig(filename: string, baseDirectory: string)`

**Return Values:**
- Typed return values required (strict TypeScript)
- Promise-based returns for async operations: `Promise<FileNode>`, `Promise<void>`
- Nullable returns explicitly typed: `FileNode | null`, `Config | null`
- Union return types for responses: `FileTreeStorage | null`

## Module Design

**Exports:**
- Each module exports specific functions/classes needed by consumers
- No barrel files (no `index.ts` re-exporting)
- Direct imports from source files: `from './file-utils.js'`, `from './types.js'`

**Barrel Files:**
- Not used in this codebase
- Single-purpose modules preferred

**Module Responsibilities:**
- `types.ts`: Type definitions and data classes
- `file-utils.ts`: Path utilities, file tree building, dependency analysis
- `storage-utils.ts`: File tree persistence (save/load), node querying
- `file-watcher.ts`: File system event watching
- `config-utils.ts`: Configuration loading/saving with schema validation
- `global-state.ts`: Singleton state management for project root and config
- `logger.ts`: Centralized logging
- `mcp-server.ts`: MCP server implementation and orchestration

---

*Convention analysis: 2026-03-02*
