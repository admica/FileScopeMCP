// src/nexus/server.ts
// Fastify HTTP server with JSON API routes and static file serving for Nexus.
// Exports: createServer

import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getRepos, getDb, getRepoStats, getTreeEntries, getFileDetail, getDirDetail } from './repo-store.js';

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Create and configure the Fastify server instance.
 * Does NOT call listen() — caller is responsible for starting the server.
 */
export async function createServer(options: { staticDir: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Serve static Svelte SPA bundle from dist/nexus/static/
  await app.register(fastifyStatic, {
    root: options.staticDir,
    prefix: '/',
  });

  // ─── API Routes ───────────────────────────────────────────────────────────

  // GET /api/repos — list all repos with online status
  app.get('/api/repos', async (_req, _reply) => {
    return getRepos().map((r) => ({
      name: r.name,
      path: r.path,
      online: r.online,
    }));
  });

  // GET /api/project/:repoName/stats — aggregate stats from repo's data.db
  app.get<{ Params: { repoName: string } }>(
    '/api/project/:repoName/stats',
    async (req, reply) => {
      const db = getDb(req.params.repoName);
      if (!db) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getRepoStats(db);
    }
  );

  // GET /api/project/:repoName/tree — root-level file tree entries
  app.get<{ Params: { repoName: string } }>(
    '/api/project/:repoName/tree',
    async (req, reply) => {
      const db = getDb(req.params.repoName);
      if (!db) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getTreeEntries(db, '');
    }
  );

  // GET /api/project/:repoName/tree/* — children of a subdirectory
  app.get<{ Params: { repoName: string; '*': string } }>(
    '/api/project/:repoName/tree/*',
    async (req, reply) => {
      const db = getDb(req.params.repoName);
      if (!db) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getTreeEntries(db, req.params['*']);
    }
  );

  // GET /api/project/:repoName/file/* — full metadata for a single file
  app.get<{ Params: { repoName: string; '*': string } }>(
    '/api/project/:repoName/file/*',
    async (req, reply) => {
      const db = getDb(req.params.repoName);
      if (!db) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      const result = getFileDetail(db, req.params['*']);
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
      const db = getDb(req.params.repoName);
      if (!db) {
        reply.code(404);
        return { error: 'Repo not found or offline' };
      }
      return getDirDetail(db, req.params['*']);
    }
  );

  return app;
}
