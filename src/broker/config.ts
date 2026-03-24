// src/broker/config.ts
// BrokerConfig Zod schema, loadBrokerConfig function, and path constants for the FileScopeMCP LLM broker.
// Exports: BrokerConfigSchema, BrokerConfig, loadBrokerConfig, FILESCOPE_DIR, SOCK_PATH, PID_PATH, LOG_PATH

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// ─── Path constants ───────────────────────────────────────────────────────────

export const FILESCOPE_DIR = path.join(os.homedir(), '.filescope');
export const SOCK_PATH = path.join(FILESCOPE_DIR, 'broker.sock');
export const PID_PATH = path.join(FILESCOPE_DIR, 'broker.pid');
export const LOG_PATH = path.join(FILESCOPE_DIR, 'broker.log');
export const CONFIG_PATH = path.join(FILESCOPE_DIR, 'broker.json');

// ─── Zod schema ───────────────────────────────────────────────────────────────

const BrokerLLMSchema = z.object({
  provider: z.enum(['anthropic', 'openai-compatible']).default('openai-compatible'),
  model: z.string().default('FileScopeMCP-brain'),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  maxTokensPerCall: z.number().int().positive().default(1024),
});

export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
});

export type BrokerConfig = z.infer<typeof BrokerConfigSchema>;

// ─── Load function ────────────────────────────────────────────────────────────

export async function loadBrokerConfig(): Promise<BrokerConfig> {
  // BROKER-02: create ~/.filescope/ if it doesn't exist
  fs.mkdirSync(FILESCOPE_DIR, { recursive: true });

  // BROKER-03: auto-copy broker.default.json if broker.json missing
  if (!fs.existsSync(CONFIG_PATH)) {
    // At runtime, import.meta.url resolves to dist/broker/config.js.
    // ../broker.default.json from dist/ reaches the repo root where the file ships.
    const brokerDir = fileURLToPath(new URL('.', import.meta.url));
    const defaultPath = path.resolve(brokerDir, '../broker.default.json');
    fs.copyFileSync(defaultPath, CONFIG_PATH);
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const result = BrokerConfigSchema.safeParse(raw);
  if (!result.success) {
    // Fail-fast with clear error pointing to config file path (per CONTEXT.md locked decision)
    console.error(`Invalid broker config at ${CONFIG_PATH}:\n${result.error.message}`);
    process.exit(1);
  }

  // Resolve wsl-host placeholder to the actual Windows host IP
  const config = result.data;
  if (config.llm.baseURL?.includes('wsl-host')) {
    const hostIp = resolveWslHostIp();
    if (hostIp) {
      config.llm.baseURL = config.llm.baseURL.replace('wsl-host', hostIp);
    }
  }

  return config;
}

/**
 * Resolves the Windows host IP from inside WSL2.
 * Returns null if not running in WSL or if detection fails.
 */
function resolveWslHostIp(): string | null {
  try {
    // ip route is the most reliable method — gateway is always the Windows host
    const out = execSync('ip route show default', { encoding: 'utf-8', timeout: 2000 });
    const match = out.match(/via\s+([\d.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
