# Phase 20: Server Skeleton + Repo Discovery - Research

**Researched:** 2026-04-01
**Domain:** Fastify HTTP server + Svelte 5 SPA + Vite + Tailwind CSS v4 + better-sqlite3 read-only + repo discovery
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tech Stack (applies to ALL Nexus phases)**
- **D-01:** Frontend framework is **Svelte 5** (runes: `$state()`, `$derived()`, `$effect()`), compiled as a client-side SPA. No SvelteKit — plain Svelte with Vite.
- **D-02:** Graph visualization uses **Cytoscape.js** for the main dependency map (Phase 22) and **D3.js** for auxiliary charts/sparklines (Phase 23). Neither is installed in Phase 20.
- **D-03:** Styling via **Tailwind CSS** with Vite plugin integration. **Dark mode only** — no light theme, no toggle. Developer dashboard aesthetic.
- **D-04:** Backend is **Fastify** serving JSON API endpoints + static files. No server-rendered HTML partials — Fastify is a pure API server.
- **D-05:** Build pipeline: **Vite** compiles Svelte SPA to `dist/nexus/static/`. **esbuild** compiles Fastify server to `dist/nexus/main.js`. Two separate build commands.
- **D-06:** **Hash router** (`/#/project/wtfij`, `/#/system`, `/#/settings`). No server-side catch-all needed. Fastify serves `index.html` at `/`, Svelte handles routing from there.
- **D-07:** Development uses two processes: Vite dev server (port 5173) with HMR for Svelte, Fastify (port 1234) for the API. Vite proxies `/api/*` requests to Fastify. Production: Fastify serves the Vite-built bundle from `dist/nexus/static/`.
- **D-08:** Registry file is `~/.filescope/nexus.json` (not dashboard.json).
- **D-09:** Auto-discovery scans **2 levels deep** from home: `~/*/` and `~/*/*/` for `.filescope/data.db`. Results written to nexus.json on first discovery.
- **D-10:** Each project tab shows a **stats summary card** from data.db: total files, % summarized, % with concepts, stale count, total dependencies.
- **D-11:** Read-only `better-sqlite3` with WAL mode, re-query per request (~1ms sync reads), no caching. Long-lived connections closed on shutdown.
- **D-12:** `filescope-nexus` via package.json `bin` field. Default `0.0.0.0:1234`, override with `--port` and `--host` flags. CLI args parsed from `process.argv` (no dependency).
- **D-13:** New deps: Runtime: `fastify`. Build/dev: `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `tailwindcss`, `@tailwindcss/vite`.

### Claude's Discretion
- Svelte component file structure within `src/nexus/ui/`
- Fastify plugin organization
- Exact Tailwind color palette for dark theme
- Hash router implementation (lightweight library vs hand-rolled)
- Vite proxy configuration specifics

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEXUS-01 | Fastify HTTP server binds to 0.0.0.0:1234 by default with --port and --host CLI flag overrides | Fastify 5.x `listen()` API; CLI args via `process.argv` |
| NEXUS-02 | `filescope-nexus` CLI entry point registered via package.json bin field | Standard Node.js `bin` field; shebang in main.ts |
| NEXUS-03 | esbuild builds src/nexus/main.ts → dist/nexus/main.js alongside existing MCP and broker entry points | Existing esbuild pattern (no --bundle flag, --outdir, --format=esm) |
| NEXUS-04 | Static files (CSS, JS) served from dist/nexus/static/ | @fastify/static plugin; Vite build output config |
| NEXUS-05 | Reads repo list from ~/.filescope/nexus.json on startup | JSON file read; FILESCOPE_DIR constant from broker/config.ts |
| NEXUS-06 | Auto-discovers repos by scanning ~ children for .filescope/data.db when nexus.json doesn't exist; writes discovered list | Node.js 22 `fs.promises.glob()` natively available; 2-level scan pattern |
| NEXUS-07 | Validates each repo's data.db on startup; missing repos marked "offline" (not removed) | `fs.existsSync()` or `fs.access()`; offline state in repo registry |
| NEXUS-08 | Periodic recheck (60s) reconnects repos whose data.db becomes available mid-session | `setInterval` + re-open logic in repo-store |
| NEXUS-09 | Opens each repo's .filescope/data.db read-only via better-sqlite3 with WAL mode | `new Database(path, { readonly: true })`; `createRequire` pattern from db.ts |
| NEXUS-10 | Re-queries SQLite on every HTTP request — no caching layer | Direct better-sqlite3 `.prepare().all()` calls in route handlers |
| NEXUS-11 | DB connections are long-lived (opened once on startup, closed on shutdown) | Map<repoName, Database> in repo-store.ts |
| NEXUS-12 | HTML shell page (Svelte SPA entry point) with top navbar per-repo tabs, System tab, Settings gear | Svelte 5 + App.svelte + Navbar.svelte; @fastify/static serves index.html at GET / |
| NEXUS-13 | Route structure: GET / (shell), GET /project/:repoName (SPA handles via hash), plus JSON API endpoints | Hash router — Fastify only needs GET / and /api/*; no server-side route per project tab |
| NEXUS-14 | Graceful shutdown on SIGTERM/SIGINT: close DB connections, stop HTTP server, process exits cleanly | `process.on('SIGTERM')` + `await fastify.close()` + close all better-sqlite3 instances |
</phase_requirements>

---

## Summary

Phase 20 builds the foundation for the Nexus dashboard: a Fastify 5 HTTP server that discovers FileScopeMCP repos, opens their databases read-only, and serves a Svelte 5 SPA with per-repo tabs and stats summary cards. The technology stack is well-established, all decisions are locked, and the project already has most dependencies in place.

The two-process build pipeline is the key complexity: esbuild transpiles the Fastify backend (following the existing project pattern — no `--bundle` flag, files transpiled individually), and Vite compiles the Svelte SPA. During development, Vite proxies `/api/*` to Fastify. In production, Fastify serves both the API and the built SPA bundle via `@fastify/static`.

The biggest integration challenge is the `createRequire` pattern for loading `better-sqlite3` (a CJS native addon) in the project's ESM context. This pattern is already established in `src/db/db.ts` and must be replicated in the Nexus `repo-store.ts`.

**Primary recommendation:** Follow the established project patterns exactly — esbuild without `--bundle`, `createRequire` for better-sqlite3, FILESCOPE_DIR from broker/config.ts, ESM throughout — and add only what's new: Fastify, @fastify/static, Svelte 5 + Vite + Tailwind v4.

---

## Standard Stack

### Core (Phase 20 additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fastify | 5.6.2 | HTTP server, JSON API, static file host | Fastest Node.js web framework; built-in TypeScript types; plugin ecosystem |
| @fastify/static | 8.3.0 | Serve dist/nexus/static/ (Vite SPA bundle) | Official Fastify plugin; required for production static serving |
| svelte | 5.x | Frontend SPA framework | Locked decision D-01; compiles away at build time |
| @sveltejs/vite-plugin-svelte | 5.x or latest | Svelte compilation in Vite | Official plugin; required for Svelte + Vite integration |
| vite | 6.x | Frontend build tool + dev server with HMR | Locked decision D-05; standard for Svelte SPA |
| tailwindcss | 4.2.x | Utility-first CSS | Locked decision D-03; v4 has Vite plugin, zero config |
| @tailwindcss/vite | 4.2.x | Vite plugin for Tailwind v4 | Replaces PostCSS config; single import in CSS |

### Already Present (reused by Nexus)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| better-sqlite3 | 12.6.2 | Read-only SQLite access | Already in dependencies; use `createRequire` pattern |
| esbuild | 0.27.3 | Transpile Nexus backend TypeScript | Already in devDependencies; follow existing build pattern |

### Supporting (hash router — Claude's discretion)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| svelte-spa-router | latest | Hash-based SPA routing | If library preferred over hand-rolled; minimal footprint, Svelte 5 compatible |
| (hand-rolled) | — | ~50-line hash router using `$state` + `hashchange` event | Acceptable; Phase 20 only has 3 routes; no nested routes needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @tailwindcss/vite (v4) | tailwindcss v3 + postcss | v3 requires tailwind.config.js + postcss.config.js; v4 is simpler — one import |
| svelte-spa-router | SvelteKit | SvelteKit is explicitly excluded (D-01); adds server-side complexity |
| @fastify/static | Express static / serve-static | Not Fastify plugins; incompatible with Fastify plugin system |

**Installation:**
```bash
# Runtime
npm install fastify @fastify/static

# Build/dev tools
npm install --save-dev svelte @sveltejs/vite-plugin-svelte vite tailwindcss @tailwindcss/vite
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/nexus/
├── main.ts              # Entry: parse CLI args, startup sequence, SIGTERM handler
├── server.ts            # Fastify instance: register plugins, routes, static serving
├── repo-store.ts        # Per-repo DB connections: open, validate, recheck, close
├── discover.ts          # nexus.json read/write + 2-level home scan
└── ui/                  # Svelte SPA (compiled by Vite to dist/nexus/static/)
    ├── vite.config.ts   # Vite config: svelte plugin, tailwind plugin, /api proxy
    ├── app.css          # @import "tailwindcss"; global dark theme vars
    ├── main.ts          # SPA entry: mount App.svelte
    ├── App.svelte        # Root: hash router, layout shell
    ├── routes/
    │   ├── Project.svelte  # Per-repo view: stats card
    │   ├── System.svelte   # (stub) system view
    │   └── Settings.svelte # (stub) settings view
    ├── components/
    │   ├── Navbar.svelte   # Top nav with repo tabs + System + Settings
    │   └── StatsCard.svelte # Repo stats summary card
    └── lib/
        ├── api.ts          # fetch() wrappers for /api/* endpoints
        └── stores.ts       # $state / shared reactive state

dist/nexus/
├── main.js              # esbuild output: Fastify server
├── server.js
├── repo-store.js
├── discover.js
└── static/              # Vite output: Svelte SPA bundle
    ├── index.html
    └── assets/
        ├── index-[hash].js
        └── index-[hash].css
```

### Pattern 1: Fastify Server Startup
**What:** Initialize Fastify, register static plugin, register API routes, listen on configured host/port.
**When to use:** `main.ts` startup sequence.
```typescript
// Source: https://fastify.dev/docs/latest/Guides/Getting-Started/
import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastifyStatic from '@fastify/static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: true });

// Serve Svelte SPA bundle — production only (Vite dev server handles dev)
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'static'),
  prefix: '/',
});

// All /api/* routes handled separately (see server.ts)
// GET / falls through to index.html via @fastify/static
await fastify.listen({ port: 1234, host: '0.0.0.0' });
```

### Pattern 2: Read-Only better-sqlite3 (ESM project — CRITICAL)
**What:** Load better-sqlite3 (CJS native addon) in ESM context using `createRequire`. Open in `readonly` mode.
**When to use:** `repo-store.ts` — opening each discovered repo's data.db.
**IMPORTANT:** This is IDENTICAL to the pattern in `src/db/db.ts` — do not deviate.
```typescript
// Source: src/db/db.ts (existing project pattern)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

// Open read-only — WAL mode for concurrent reads while MCP writes
function openReadOnly(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  // Note: readonly DBs can still set read pragmas
  db.pragma('cache_size = -32000');  // 32MB cache
  return db;
}
```
**WAL caveat:** WAL mode is set by the MCP writer — the read-only connection does not set `journal_mode = WAL`. It only benefits from WAL being already active. Do NOT call `pragma('journal_mode = WAL')` on a read-only connection — it will fail.

### Pattern 3: Repo Discovery — 2-Level Scan
**What:** Use native `fs.promises.glob()` (Node.js 22+) to scan for `.filescope/data.db` at 1 and 2 levels under home.
**When to use:** `discover.ts` when `nexus.json` doesn't exist.
```typescript
// Source: Node.js 22 docs — https://nodejs.org/api/fs.html
import { glob } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function discoverRepos(): Promise<string[]> {
  const home = os.homedir();
  const found: string[] = [];
  // Scan 2 levels: ~/*/  and  ~/*/*/
  for await (const match of glob('*/.filescope/data.db', { cwd: home })) {
    found.push(path.join(home, path.dirname(match)));
  }
  for await (const match of glob('*/*/.filescope/data.db', { cwd: home })) {
    found.push(path.join(home, path.dirname(match)));
  }
  return [...new Set(found)];
}
```
Note: `path.dirname` strips the `/.filescope/data.db` suffix to get the repo root.

### Pattern 4: Graceful Shutdown
**What:** Handle SIGTERM/SIGINT — close all DB connections, stop Fastify, exit cleanly.
**When to use:** `main.ts`.
```typescript
// Source: https://fastify.dev/docs/latest/ + project pattern
async function shutdown(signal: string) {
  console.log(`Nexus: received ${signal}, shutting down...`);

  // Force-exit after 10s if graceful shutdown hangs
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();

  // Close all read-only DB connections
  repoStore.closeAll();

  // Stop accepting connections, drain in-flight requests
  await fastify.close();

  clearTimeout(timeout);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

### Pattern 5: Tailwind v4 + Svelte in Vite
**What:** Minimal Tailwind v4 setup — no config file, single CSS import.
**When to use:** `src/nexus/ui/vite.config.ts` and `app.css`.
```typescript
// Source: https://tailwindcss.com/docs (v4) + @sveltejs/vite-plugin-svelte docs
// vite.config.ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: '../../../dist/nexus/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:1234',
        changeOrigin: true,
      },
    },
  },
});
```
```css
/* app.css */
@import "tailwindcss";
```

### Pattern 6: Nexus JSON Registry
**What:** Read/write `~/.filescope/nexus.json` for the repo registry. Import FILESCOPE_DIR from existing broker/config.
**When to use:** `discover.ts`.
```typescript
// Source: src/broker/config.ts (existing project constant)
import { FILESCOPE_DIR } from '../broker/config.js';
import path from 'node:path';
import fs from 'node:fs';

export const NEXUS_JSON_PATH = path.join(FILESCOPE_DIR, 'nexus.json');

export type NexusRepo = { path: string; name: string };
export type NexusRegistry = { repos: NexusRepo[] };

export function readRegistry(): NexusRegistry | null {
  try {
    return JSON.parse(fs.readFileSync(NEXUS_JSON_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeRegistry(registry: NexusRegistry): void {
  fs.writeFileSync(NEXUS_JSON_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}
```

### Pattern 7: esbuild Build Command for Nexus Backend
**What:** Extend the existing build script to transpile Nexus backend files. Follow the EXACT existing pattern — no `--bundle`, individual files, `--outdir=dist/nexus`.
**When to use:** `package.json` scripts.
```json
{
  "scripts": {
    "build:nexus-api": "esbuild src/nexus/main.ts src/nexus/server.ts src/nexus/repo-store.ts src/nexus/discover.ts --format=esm --target=es2020 --outdir=dist/nexus --platform=node",
    "build:nexus-ui": "vite build --config src/nexus/ui/vite.config.ts",
    "dev:nexus-ui": "vite dev --config src/nexus/ui/vite.config.ts",
    "nexus": "node dist/nexus/main.js"
  },
  "bin": {
    "filescope-nexus": "dist/nexus/main.js"
  }
}
```

### Pattern 8: Stats Query (NEXUS-10, NEXUS-12 — stats card)
**What:** Per-repo aggregate stats from data.db using raw better-sqlite3 (not Drizzle — Nexus opens DBs independently).
**When to use:** `GET /api/project/:repoName/stats` route.
```typescript
// Source: src/db/schema.ts (existing schema)
// All columns: path, name, is_directory, importance, summary,
//   summary_stale_since, concepts_stale_since, change_impact_stale_since,
//   exports_snapshot, concepts, change_impact

function getRepoStats(db: Database) {
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE is_directory = 0) AS total_files,
      COUNT(*) FILTER (WHERE is_directory = 0 AND summary IS NOT NULL) AS with_summary,
      COUNT(*) FILTER (WHERE is_directory = 0 AND concepts IS NOT NULL) AS with_concepts,
      COUNT(*) FILTER (WHERE is_directory = 0 AND summary_stale_since IS NOT NULL) AS stale_count
    FROM files
  `).get();
  const dep_count = db.prepare(
    `SELECT COUNT(*) AS cnt FROM file_dependencies WHERE dependency_type = 'local_import'`
  ).get() as { cnt: number };
  return { ...row, total_deps: dep_count.cnt };
}
```

### Anti-Patterns to Avoid
- **Don't use Drizzle ORM in Nexus:** Nexus opens DBs independently (not via `openDatabase()` from db.ts). Drizzle adds migration overhead not needed for read-only access. Use raw better-sqlite3 `.prepare().get()` / `.all()` directly.
- **Don't set `journal_mode = WAL` on read-only connections:** WAL mode is set by the MCP writer. Read-only connections inherit it; calling the pragma on a readonly connection throws an error.
- **Don't use `--bundle` in esbuild for Nexus backend:** The existing project pattern transpiles files individually without bundling. This preserves Node's native module resolution and avoids CJS/ESM interop issues with native addons.
- **Don't put vite.config.ts at the project root:** The Vite config for the Nexus UI must be co-located at `src/nexus/ui/vite.config.ts` and referenced explicitly: `vite build --config src/nexus/ui/vite.config.ts`. This keeps Nexus build tooling isolated from any future root-level Vite use.
- **Don't remove repos from nexus.json on offline:** If `data.db` is missing, mark the repo as `offline: true` in the runtime state — never remove it from `nexus.json`. The user must explicitly remove via settings.
- **Don't use process.argv[1] path for static serving in production:** `import.meta.url` resolves relative to the compiled `.js` file in `dist/nexus/`. Use `fileURLToPath(new URL('.', import.meta.url))` to get `dist/nexus/`, then join `static` from there.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Static file serving with ETags, range requests, content-type detection | Custom file server | @fastify/static | Handles all HTTP static serving edge cases; integrates with Fastify lifecycle |
| TypeScript compilation | Custom transform pipeline | esbuild (existing) | Already in project; same flags, same output pattern |
| Svelte compilation | Manual rollup config | @sveltejs/vite-plugin-svelte | Official plugin; handles HMR, TypeScript preprocessor, runes mode |
| Hash routing | Manual window.location parsing | svelte-spa-router (or minimal hand-rolled using `hashchange`) | 3-route app is simple enough to hand-roll, but svelte-spa-router is 1 import |
| WAL concurrent read handling | Manual lock/retry | better-sqlite3 + WAL (existing) | WAL mode already set by MCP writer; reads never block |

**Key insight:** The project already has all the hard pieces (better-sqlite3, esbuild, ESM patterns). Phase 20 adds Fastify and the Svelte toolchain — both are straightforward installations with official documentation.

---

## Common Pitfalls

### Pitfall 1: WAL Pragma on Read-Only Connection
**What goes wrong:** Calling `db.pragma('journal_mode = WAL')` on a `{ readonly: true }` better-sqlite3 connection throws: `SqliteError: attempt to write a readonly database`.
**Why it happens:** WAL mode is a write operation on the database file. Read-only connections cannot modify journaling mode.
**How to avoid:** Never set `journal_mode` pragma on Nexus read-only connections. WAL is already set by the MCP writer process. Set only read-safe pragmas: `cache_size`, `mmap_size`, `temp_store`.
**Warning signs:** Startup crash with `attempt to write a readonly database`.

### Pitfall 2: `__dirname` Not Defined in ESM
**What goes wrong:** Using `__dirname` in `server.ts` when configuring @fastify/static root path — crashes with `ReferenceError: __dirname is not defined`.
**Why it happens:** `__dirname` is a CommonJS-only global. The project uses `"type": "module"`.
**How to avoid:** Always use `fileURLToPath(new URL('.', import.meta.url))` to get the current directory. This is already the established pattern in `src/db/db.ts`.
**Warning signs:** `ReferenceError: __dirname is not defined in ES module scope`.

### Pitfall 3: Vite Build Output Lands in Wrong Directory
**What goes wrong:** Vite builds to the default `dist/` adjacent to `vite.config.ts` (i.e., `src/nexus/ui/dist/`) instead of `dist/nexus/static/`.
**Why it happens:** Default Vite outDir is `dist` relative to the config file location, not the project root.
**How to avoid:** Explicitly set `build.outDir` in `src/nexus/ui/vite.config.ts`:
```typescript
build: { outDir: '../../../dist/nexus/static', emptyOutDir: true }
```
**Warning signs:** `dist/nexus/static/` is empty after `npm run build:nexus-ui`; check `src/nexus/ui/dist/` instead.

### Pitfall 4: Serving index.html for Hash Routes in Production
**What goes wrong:** GET `/` works (serves index.html), but direct navigation to `/#/project/foo` works fine (hash routing is client-side). HOWEVER, if any non-asset GET to a non-API path returns 404, the SPA breaks.
**Why it happens:** @fastify/static only serves files that exist. If configured with `wildcard: false`, directory navigation returns 404.
**How to avoid:** Use @fastify/static default config (which handles `index.html` at root). Hash routing means only GET `/` and GET `/assets/*` need to resolve — no server-side catch-all needed. This is explicitly covered by D-06.
**Warning signs:** Browser console shows 404 on SPA asset requests.

### Pitfall 5: nexus.json Scan Hits node_modules
**What goes wrong:** Auto-discovery scan finds `.filescope/data.db` files inside `node_modules` directories or other non-repo directories.
**Why it happens:** `glob('*/.filescope/data.db')` from home might match `~/some-project/node_modules/pkg/.filescope/data.db` if such a path exists.
**How to avoid:** The 2-level scan `~/*/` and `~/*/*/` is intentionally shallow (D-09). `node_modules` is typically 3+ levels deep from home. Additionally, validate that the discovered path is a directory and that `data.db` is a regular file > 0 bytes.
**Warning signs:** Nexus shows many unexpected tabs on first run.

### Pitfall 6: esbuild Copies Shared Imports Instead of Referencing Them
**What goes wrong:** `dist/nexus/main.js` imports `../broker/config.js` but that file doesn't exist at `dist/nexus/../broker/config.js` (it's at `dist/broker/config.js`).
**Why it happens:** esbuild without `--bundle` transpiles files individually and preserves import paths. `src/nexus/main.ts` importing `../broker/config.js` expects the same relative structure in `dist/`.
**How to avoid:** The existing project esbuild command puts ALL files into a flat `--outdir=dist`. The Nexus backend uses `--outdir=dist/nexus`. If Nexus files import from `../broker/config.js`, that resolves to `dist/broker/config.js` (one level up from `dist/nexus/`), which DOES exist. This works correctly — just verify the import path depth.
**Alternative:** Import FILESCOPE_DIR via a re-export, or inline the constant in `discover.ts` if cross-directory imports become confusing.
**Warning signs:** `Error: Cannot find module '../broker/config.js'` at runtime.

### Pitfall 7: `filescope-nexus` bin Requires Shebang
**What goes wrong:** Running `filescope-nexus` from shell (after `npm link` or global install) fails with: `... unexpected token` or the file is not treated as executable.
**Why it happens:** The `bin` field in package.json registers the script as an executable. Node needs `#!/usr/bin/env node` at the top of the entry file, AND the file needs execute permission.
**How to avoid:** Add `#!/usr/bin/env node` as the FIRST line of `dist/nexus/main.js`. Since esbuild generates the output, add the shebang to `src/nexus/main.ts` as a comment — esbuild preserves `//` comments at the top. OR add a postbuild script to prepend the shebang.
**Warning signs:** `filescope-nexus: command not found` OR `SyntaxError` when running via global bin.

---

## Code Examples

Verified patterns from official sources and existing project code:

### CLI Arg Parsing (no dependencies — D-12)
```typescript
// Source: NEXUS-PLAN.md + D-12 decision
function parseArgs(): { port: number; host: string } {
  const args = process.argv.slice(2);
  let port = 1234;
  let host = '0.0.0.0';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    if (args[i] === '--host' && args[i + 1]) host = args[++i];
  }
  return { port, host };
}
```

### Repo Store: Map of Long-Lived Connections
```typescript
// Source: D-11 + NEXUS-PLAN.md Data Access section
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

type RepoState = {
  name: string;
  path: string;
  db: InstanceType<typeof Database> | null;
  online: boolean;
};

const repos = new Map<string, RepoState>();

export function openRepo(name: string, repoPath: string): RepoState {
  const dbPath = path.join(repoPath, '.filescope', 'data.db');
  if (!fs.existsSync(dbPath)) {
    repos.set(name, { name, path: repoPath, db: null, online: false });
    return repos.get(name)!;
  }
  const db = new Database(dbPath, { readonly: true });
  db.pragma('cache_size = -32000');
  repos.set(name, { name, path: repoPath, db, online: true });
  return repos.get(name)!;
}

export function closeAll(): void {
  for (const state of repos.values()) {
    if (state.db) { state.db.close(); state.db = null; }
  }
}
```

### Periodic Recheck (NEXUS-08)
```typescript
// Source: NEXUS-PLAN.md "Re-check periodically (every 60s)"
setInterval(() => {
  for (const [name, state] of repos.entries()) {
    if (!state.online) {
      const recheckState = openRepo(name, state.path);
      if (recheckState.online) {
        console.log(`Nexus: repo ${name} came online`);
      }
    }
  }
}, 60_000);
```

### Fastify JSON API Route Pattern
```typescript
// Source: https://fastify.dev/docs/latest/Reference/TypeScript/
import type { FastifyInstance } from 'fastify';
import { getRepos, getDb } from './repo-store.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/repos', async () => {
    return getRepos().map(r => ({
      name: r.name, path: r.path, online: r.online
    }));
  });

  app.get<{ Params: { repoName: string } }>(
    '/api/project/:repoName/stats',
    async (req, reply) => {
      const db = getDb(req.params.repoName);
      if (!db) return reply.code(404).send({ error: 'repo not found or offline' });
      // Re-query on every request — no caching (D-11)
      return getRepoStats(db);
    }
  );
}
```

### Svelte 5 App.svelte with Hash Router (hand-rolled — 3 routes only)
```svelte
<!-- Source: Svelte 5 docs + hash router pattern -->
<script lang="ts">
  import Navbar from './components/Navbar.svelte';
  import Project from './routes/Project.svelte';
  import System from './routes/System.svelte';
  import Settings from './routes/Settings.svelte';

  let hash = $state(window.location.hash || '#/');

  $effect(() => {
    const handler = () => { hash = window.location.hash || '#/'; };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  let route = $derived(parseHash(hash));

  function parseHash(h: string) {
    const path = h.replace(/^#/, '') || '/';
    if (path.startsWith('/project/')) return { type: 'project', name: path.slice(9) };
    if (path === '/system') return { type: 'system' };
    if (path === '/settings') return { type: 'settings' };
    return { type: 'home' };
  }
</script>

<Navbar {hash} />
{#if route.type === 'project'}
  <Project repoName={route.name} />
{:else if route.type === 'system'}
  <System />
{:else if route.type === 'settings'}
  <Settings />
{:else}
  <Project repoName="" />  <!-- default: first repo -->
{/if}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 (tailwind.config.js + postcss) | Tailwind v4 (@tailwindcss/vite, single CSS import) | Jan 2025 | Simpler config; no content glob needed; faster builds |
| `@sveltejs/vite-plugin-svelte` v3/v4 | v5.x for Svelte 5 | Oct 2024 (Svelte 5 GA) | Required for Svelte 5 runes support |
| `fastify` v4 | `fastify` v5 (5.6.2) | 2024 | TypeScript improvements; Node 18+ required |
| `__dirname` in Node ESM | `fileURLToPath(new URL('.', import.meta.url))` | Node 12+ ESM | Project already uses this pattern |
| `fs.promises.glob()` not available | Available natively in Node.js 22+ | Node.js 22 (2024) | Node v22.21.1 is installed — use native glob, no `fast-glob` dependency |

**Deprecated/outdated:**
- `fastify-static` (unprefixed): Deprecated. Use `@fastify/static` (scoped package).
- `tailwind.config.js` / postcss config: Not needed for Tailwind v4 + Vite. V4 uses `@import "tailwindcss"` in CSS.
- Svelte `export let` for props: Replaced by `$props()` rune in Svelte 5. Use `let { foo } = $props()`.
- Svelte reactive statements `$:`: Replaced by `$derived()` and `$effect()` runes.

---

## Open Questions

1. **Shebang preservation through esbuild**
   - What we know: esbuild without `--bundle` does TypeScript-to-JavaScript transpilation; comments at file top may be preserved
   - What's unclear: Whether esbuild preserves `#!/usr/bin/env node` at line 1 of the output without explicit configuration
   - Recommendation: Verify after first build; if stripped, add a `postbuild:nexus-api` script using `sed` or a tiny Node script to prepend the shebang to `dist/nexus/main.js`

2. **Import path for `../broker/config.js` from `dist/nexus/`**
   - What we know: `dist/nexus/main.js` importing `../broker/config.js` resolves to `dist/broker/config.js` (correct)
   - What's unclear: Whether this cross-subdirectory import is idiomatic for the project or if the planner prefers self-contained Nexus constants
   - Recommendation: Import FILESCOPE_DIR from `../broker/config.js` — it works correctly and avoids duplicating the constant. Document the relative path convention.

3. **Tailwind v4 dark mode — CSS variables vs `dark:` prefix**
   - What we know: Tailwind v4 changed dark mode strategy; `dark:` variants still work but configuration differs
   - What's unclear: Whether `dark:` class variants or CSS variables + `:root` approach is preferred for a dark-mode-only app
   - Recommendation: For dark-mode-only (no toggle, D-03), use `:root` CSS custom properties for the color palette in `app.css`, and Tailwind v4's `@theme` block to define custom colors. Avoids the `dark:` prefix entirely since there's no light mode.

---

## Sources

### Primary (HIGH confidence)
- NEXUS-PLAN.md (project file) — Architecture, repo discovery, data access, lifecycle, file structure, API endpoints, build commands
- `src/db/db.ts` (project file) — `createRequire` pattern for better-sqlite3 in ESM
- `src/db/schema.ts` (project file) — SQLite table definitions for stats queries
- `src/broker/config.ts` (project file) — FILESCOPE_DIR constant, broker path constants
- `src/broker/stats.ts` (project file) — STATS_PATH, readStats() function
- `package.json` (project file) — existing esbuild command pattern, current dependencies
- https://fastify.dev/docs/latest/ — Fastify 5.6.2 documentation
- https://www.npmjs.com/package/@fastify/static — @fastify/static 8.3.0
- https://tailwindcss.com/docs — Tailwind CSS v4 documentation
- https://nodejs.org/api/fs.html — Node.js 22 fs.promises.glob()

### Secondary (MEDIUM confidence)
- https://github.com/sveltejs/vite-plugin-svelte — @sveltejs/vite-plugin-svelte v5 for Svelte 5
- https://www.npmjs.com/package/svelte-spa-router — hash router option for Svelte 5
- https://vite.dev/config/server-options — Vite proxy configuration
- https://github.com/fastify/fastify-static — @fastify/static ESM usage patterns

### Tertiary (LOW confidence — verify if used)
- WebSearch results on graceful shutdown patterns — multiple sources agree on `await fastify.close()` pattern
- WebSearch results on esbuild no-bundle mode — consistent with existing project's build command behavior

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via npm, official docs checked
- Architecture: HIGH — follows established project patterns exactly (db.ts, broker/config.ts); NEXUS-PLAN.md is authoritative
- Pitfalls: HIGH — WAL readonly pitfall and __dirname pitfall are well-documented; esbuild outdir pitfall confirmed by existing project pattern
- Stats queries: HIGH — schema.ts is the source of truth, queries are straightforward

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (Fastify, Svelte stable; Tailwind v4 recently released but API stable)
