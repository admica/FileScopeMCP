import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { Config, FileWatchingConfig } from './types.js';
import { LLMConfigSchema } from './llm/types.js';
import { error as logError, info as logInfo, debug as logDebug } from './logger.js';

// Define the FileWatchingConfig schema
const FileWatchingSchema = z.object({
  enabled: z.boolean().default(false),
  ignoreDotFiles: z.boolean().default(true),
  autoRebuildTree: z.boolean().default(true),
  maxWatchedDirectories: z.number().int().positive().default(1000),
  watchForNewFiles: z.boolean().default(true),
  watchForDeleted: z.boolean().default(true),
  watchForChanged: z.boolean().default(true)
}).optional();

// Define the config schema
const ConfigSchema = z.object({
  baseDirectory: z.string(),
  excludePatterns: z.array(z.string()),
  fileWatching: FileWatchingSchema,
  version: z.string(),
  llm: LLMConfigSchema,
});

// Verify the schema matches our Config type
type ValidateConfig = z.infer<typeof ConfigSchema> extends Config ? true : false;

/** Per-repo runtime directory for config, database, and PID files. */
export const FILESCOPE_DIR = '.filescope';
export const CONFIG_FILENAME = 'config.json';

const DEFAULT_EXCLUDES: string[] = [
  // Version control
  "**/.git",
  "**/.svn",
  "**/.hg",
  // Node / JS / TS
  "**/node_modules",
  "**/package-lock.json",
  "**/.next",
  "**/.nuxt",
  "**/.angular",
  "**/.expo",
  "**/.parcel-cache",
  "**/.turbo",
  "**/.vercel",
  "**/.svelte-kit",
  "**/.storybook",
  "**/jspm_packages",
  "**/.npm",
  "**/.pnpm-store",
  "**/.yarn",
  "**/*.js.map",
  "**/*.ts.map",
  // Python
  "**/__pycache__",
  "**/*.pyc",
  "**/*.pyo",
  "**/venv",
  "**/.venv",
  "**/venv_*",
  "**/.venv_*",
  "**/.tox",
  "**/.pytest_cache",
  "**/.eggs",
  "**/*.egg-info",
  "**/.ipynb_checkpoints",
  // Rust
  "**/target",
  "**/*.rlib",
  "**/.cargo",
  "**/Cargo.lock",
  "**/.rustup",
  // Go
  "**/vendor",
  // C / C++
  "**/cmake-build-*",
  "**/CMakeFiles",
  "**/CMakeCache.txt",
  "**/*.o",
  "**/*.obj",
  "**/*.so",
  "**/*.a",
  "**/*.out",
  "**/obj/**",
  // Java / Kotlin / Gradle
  "**/*.class",
  "**/*.gradle",
  "**/.gradle",
  // C# / .NET
  "**/bin",
  "**/obj",
  "**/*.dll",
  // Zig
  "**/zig-cache",
  "**/zig-out",
  // Build outputs
  "**/dist",
  "**/build",
  "**/coverage",
  // Logs and temp files
  "**/*.log",
  "**/*.lock",
  "**/*.bak",
  "**/*.tmp",
  "**/*.temp",
  "**/*.swp",
  "**/*.swo",
  // OS files
  "**/.DS_Store",
  "**/Thumbs.db",
  // IDE / editor
  "**/.vscode",
  "**/.idea",
  "**/.cursor",
  "**/.cursorrules",
  // Environment / secrets
  "**/.env*",
  // Caches
  "**/cache",
  "**/.cache",
  "**/.cache-loader",
  "**/.firebase",
  "**/.output",
  "**/.local",
];

const DEFAULT_CONFIG: Config = {
  baseDirectory: "",
  excludePatterns: DEFAULT_EXCLUDES,
  fileWatching: {
    enabled: true,
    ignoreDotFiles: true,
    autoRebuildTree: true,
    maxWatchedDirectories: 1000,
    watchForNewFiles: true,
    watchForDeleted: true,
    watchForChanged: true
  },
  llm: {
    enabled: true,
  },
  version: "1.0.0"
};

export async function loadConfig(configPath: string = path.join(FILESCOPE_DIR, CONFIG_FILENAME)): Promise<Config> {
  logDebug(`Loading config from ${configPath}`);
  logDebug(`Current working directory: ${process.cwd()}`);

  try {
    const fullPath = path.resolve(configPath);
    logDebug(`Resolved full path: ${fullPath}`);

    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    logDebug(`Config file exists: ${exists ? 'YES' : 'NO'}`);

    if (!exists) {
      logInfo(`Using default config (${configPath} not found)`);
      logDebug(`Default config:`, JSON.stringify(DEFAULT_CONFIG, null, 2));
      return DEFAULT_CONFIG;
    }

    const configContent = await fs.readFile(configPath, 'utf-8');
    logDebug(`Read ${configContent.length} bytes from config file`);

    try {
      const parsedConfig = JSON.parse(configContent);
      logDebug(`Parsed config successfully`);

      // Check for exclude patterns
      if (parsedConfig.excludePatterns && Array.isArray(parsedConfig.excludePatterns)) {
        logDebug(`Found ${parsedConfig.excludePatterns.length} exclude patterns`);
        if (parsedConfig.excludePatterns.length > 0) {
          logDebug(`First 5 patterns:`, parsedConfig.excludePatterns.slice(0, 5));
        }
      } else {
        logDebug(`No exclude patterns found in config`);
      }

      // Validate config
      const validatedConfig = ConfigSchema.parse(parsedConfig);
      logInfo(`Config loaded successfully from ${configPath}`);
      logDebug(`Base directory: ${validatedConfig.baseDirectory}`);
      logDebug(`Version: ${validatedConfig.version}`);

      return validatedConfig;
    } catch (parseError) {
      logError(`Error parsing config JSON:`, parseError);
      logDebug(`Raw config content:`, configContent);
      logInfo(`Using default config (parse error)`);
      return DEFAULT_CONFIG;
    }
  } catch (err) {
    logError(`Error loading config:`, err);
    logInfo(`Using default config (load error)`);
    logDebug(`Default config:`, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config, configPath: string = path.join(FILESCOPE_DIR, CONFIG_FILENAME)): Promise<void> {
  try {
    const dir = path.dirname(path.resolve(configPath));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    logError('Error saving config:', err);
    throw err;
  }
}
