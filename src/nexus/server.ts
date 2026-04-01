// src/nexus/server.ts
// Fastify HTTP server with JSON API routes and static file serving for Nexus.
// Exports: createServer

import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getRepos, getDb, getRepoStats } from './repo-store.js';

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

  return app;
}
