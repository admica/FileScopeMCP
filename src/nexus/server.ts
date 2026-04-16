// src/nexus/server.ts
// Fastify HTTP server with JSON API routes and static file serving for Nexus.
// Exports: createServer

import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import * as net from 'node:net';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SOCK_PATH, CONFIG_PATH } from '../broker/config.js';
import type { StatusResponse } from '../broker/types.js';
import { readStats } from '../broker/stats.js';
import { getRecentLines, addSseClient } from './log-tailer.js';
import { readRegistry, writeRegistry } from './discover.js';
import { getRepos, getDb, getRepoState, getStaleCount, removeRepo, openRepo, getRepoStats, getTreeEntries, getFileDetail, getDirDetail, getGraphData } from './repo-store.js';
import type { RepoState } from './repo-store.js';

// ─── Broker socket query ──────────────────────────────────────────────────────

/**
 * Opens a fresh connection to broker.sock, sends a status request,
 * and resolves with the response or null on timeout/error.
 */
async function queryBrokerStatus(): Promise<StatusResponse | null> {
  return new Promise<StatusResponse | null>((resolve) => {
    const sock = net.createConnection(SOCK_PATH);
    const timer = setTimeout(() => { sock.destroy(); resolve(null); }, 2000);
    timer.unref();

    sock.on('error', () => { clearTimeout(timer); resolve(null); });

    const rl = readline.createInterface({ input: sock, terminal: false });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'status_response') {
          clearTimeout(timer);
          sock.destroy();
          resolve(msg as StatusResponse);
        }
      } catch { /* ignore malformed */ }
    });

    const id = randomUUID();
    sock.on('connect', () => {
      sock.write(JSON.stringify({ type: 'status', id }) + '\n');
    });
  });
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Create and configure the Fastify server instance.
 * Does NOT call listen() — caller is responsible for starting the server.
 */
export async function createServer(options: {
  staticDir: string;
  startupTokenSnapshot: Record<string, number>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Serve static Svelte SPA bundle from dist/nexus/static/
  await app.register(fastifyStatic, {
    root: options.staticDir,
    prefix: '/',
  });

  // ─── Broker model name (read once at server creation time) ───────────────

  let brokerModelName = 'unknown';
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    brokerModelName = parsed?.llm?.model ?? 'unknown';
  } catch { /* broker.json may not exist */ }

  // ─── Shared repo resolver ─────────────────────────────────────────────────

  function resolveRepo(repoName: string): { db: NonNullable<RepoState['db']>; basePath: string } | null {
    const state = getRepoState(repoName);
    if (!state?.db || !state.online) return null;
    return { db: state.db, basePath: state.path };
  }

  // ─── API Routes ───────────────────────────────────────────────────────────

  // GET /api/repos — list all repos with online status, stale count, and db mtime
  app.get('/api/repos', async (_req, _reply) => {
    return getRepos().map((r) => {
      let dbMtimeMs: number | null = null;
      let staleCount = 0;

      if (r.online && r.db) {
        // Check data.db mtime for activity heuristic
        try {
          const dbPath = path.join(r.path, '.filescope', 'data.db');
          dbMtimeMs = fs.statSync(dbPath).mtimeMs;
        } catch { /* file may be inaccessible */ }

        // Count stale files for orange dot
        staleCount = getStaleCount(r.db);
      }

      return {
        name: r.name,
        path: r.path,
        online: r.online,
        staleCount,
        dbMtimeMs,
      };
    });
  });

  // GET /api/repos/blacklist — return blacklisted repo paths (NEXUS-34, D-13)
  app.get('/api/repos/blacklist', async (_req, _reply) => {
    const registry = readRegistry();
    const blacklist = registry?.blacklist ?? [];
    // Return with derived names for display
    return blacklist.map(p => ({
      path: p,
      name: p.split('/').pop() ?? p,
    }));
  });

  // DELETE /api/repos/:repoName — blacklist a repo (NEXUS-34, D-10)
  app.delete<{ Params: { repoName: string } }>(
    '/api/repos/:repoName',
    async (req, reply) => {
      const { repoName } = req.params;
      const removed = removeRepo(repoName);
      if (!removed) {
        reply.code(404);
        return { error: 'Repo not found' };
      }
      // Update nexus.json: remove from repos, add path to blacklist
      const registry = readRegistry() ?? { repos: [] };
      registry.repos = registry.repos.filter(r => r.name !== repoName);
      const blacklist = registry.blacklist ?? [];
      if (!blacklist.includes(removed.path)) {
        blacklist.push(removed.path);
      }
      registry.blacklist = blacklist;
      writeRegistry(registry);
      return { ok: true };
    }
  );

  // POST /api/repos/:repoName/restore — un-blacklist and re-open a repo (NEXUS-34, D-13)
  app.post<{ Params: { repoName: string }; Body: { path: string } }>(
    '/api/repos/:repoName/restore',
    async (req, reply) => {
      const repoName = req.params.repoName;
      const repoPath = (req.body as { path: string }).path;
      if (!repoPath) {
        reply.code(400);
        return { error: 'path is required in request body' };
      }
      // Update nexus.json: remove from blacklist, add to repos
      const registry = readRegistry() ?? { repos: [] };
      registry.blacklist = (registry.blacklist ?? []).filter(p => p !== repoPath);
      // Only add if not already in repos
      if (!registry.repos.some(r => r.path === repoPath)) {
        registry.repos.push({ name: repoName, path: repoPath });
      }
      writeRegistry(registry);
      // Open DB connection
      openRepo(repoName, repoPath);
      return { ok: true };
    }
  );

  // GET /api/project/:repoName/stats — aggregate stats from repo's data.db
  app.get<{ Params: { repoName: string } }>(
    '/api/project/:repoName/stats',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getRepoStats(repo.db);
    }
  );

  // GET /api/project/:repoName/tree — root-level file tree entries
  app.get<{ Params: { repoName: string } }>(
    '/api/project/:repoName/tree',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getTreeEntries(repo.db, repo.basePath, '');
    }
  );

  // GET /api/project/:repoName/tree/* — children of a subdirectory
  app.get<{ Params: { repoName: string; '*': string } }>(
    '/api/project/:repoName/tree/*',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getTreeEntries(repo.db, repo.basePath, req.params['*']);
    }
  );

  // GET /api/project/:repoName/file/* — full metadata for a single file
  app.get<{ Params: { repoName: string; '*': string } }>(
    '/api/project/:repoName/file/*',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      const result = getFileDetail(repo.db, repo.basePath, req.params['*']);
      if (!result) {
        reply.code(404);
        return { error: 'File not found' };
      }
      return result;
    }
  );

  // GET /api/project/:repoName/dir/* — aggregate stats for a directory
  app.get<{ Params: { repoName: string; '*': string } }>(
    '/api/project/:repoName/dir/*',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getDirDetail(repo.db, repo.basePath, req.params['*']);
    }
  );

  // GET /api/project/:repoName/graph — dependency graph nodes and edges
  app.get<{ Params: { repoName: string }; Querystring: { dir?: string } }>(
    '/api/project/:repoName/graph',
    async (req, reply) => {
      const repo = resolveRepo(req.params.repoName);
      if (!repo) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      const dirFilter = req.query.dir;
      return getGraphData(repo.db, repo.basePath, dirFilter);
    }
  );

  // GET /api/system/broker — broker status with offline fallback (NEXUS-25, NEXUS-26)
  app.get('/api/system/broker', async (_req, _reply) => {
    const status = await queryBrokerStatus();
    if (!status) {
      return {
        online: false,
        pendingCount: 0,
        inProgressJob: null,
        connectedClients: 0,
        repoTokens: {},
        model: brokerModelName,
      };
    }
    return {
      online: true,
      pendingCount: status.pendingCount,
      inProgressJob: status.inProgressJob,
      connectedClients: status.connectedClients,
      repoTokens: status.repoTokens,
      model: brokerModelName,
    };
  });

  // GET /api/system/tokens — per-repo token totals with session delta (NEXUS-27)
  app.get('/api/system/tokens', async (_req, _reply) => {
    const current = readStats();
    const snapshot = options.startupTokenSnapshot;
    const entries = Object.entries(current.repoTokens)
      .map(([repo, total]) => ({
        repo,
        total,
        sessionDelta: total - (snapshot[repo] ?? total),
      }))
      .sort((a, b) => b.total - a.total);
    return entries;
  });

  // GET /api/stream/activity — SSE log stream with ring buffer history flush (NEXUS-28, NEXUS-29)
  app.get('/api/stream/activity', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    // Send ring buffer history immediately
    for (const line of getRecentLines()) {
      reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
    }

    // Register for live broadcast
    const cleanup = addSseClient(reply.raw);
    req.socket.on('close', cleanup);

    // Prevent Fastify from trying to serialize a response
    await reply.hijack();
  });

  return app;
}
