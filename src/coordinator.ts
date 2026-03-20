import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import {
  FileNode,
  ToolResponse,
  FileTreeConfig,
  FileWatchingConfig,
  PackageDependency
} from './types.js';
import { scanDirectory, calculateImportance, buildDependentMap, normalizePath, addFileNode, removeFileNode, updateFileNodeOnChange, integrityCheck, resolveGoImports, resolveRubyImports, resolveImportPath, isUnresolvedTemplateLiteral, extractPackageVersion, readGoModuleName, IMPORT_PATTERNS, extractImportPath, getAllFileNodes } from './file-utils.js';
import { canonicalizePath } from './storage-utils.js';
import { extractSnapshot, isTreeSitterLanguage } from './change-detector/ast-parser.js';
import { setProjectRoot, getProjectRoot, setConfig, getConfig } from './global-state.js';
import { loadConfig } from './config-utils.js';
import { FileWatcher, FileEventType } from './file-watcher.js';
import { log } from './logger.js';
import { openDatabase, closeDatabase, getSqlite } from './db/db.js';
import { runMigrationIfNeeded } from './migrate/json-to-sqlite.js';
import { getAllFiles, upsertFile, loadLlmRuntimeState, saveLlmRuntimeState, getDependencies, setDependencies } from './db/repository.js';
import { ChangeDetector } from './change-detector/change-detector.js';
import type { SemanticChangeSummary } from './change-detector/types.js';
import { cascadeStale, markSelfStale } from './cascade/cascade-engine.js';
import { LLMPipeline } from './llm/pipeline.js';
import type { LLMConfig } from './llm/types.js';

// Module-private async mutex to serialize all tree mutations.
// Both the file-watcher callback and the integrity sweep mutate the SQLite state;
// running them concurrently can corrupt dependency lists or produce interleaved saves.
class AsyncMutex {
  private _queue: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(() => fn());
    // Keep the chain alive regardless of whether fn throws
    this._queue = result.then(() => {}, () => {});
    return result;
  }
}

// Default file-watching config used when none exists yet
const DEFAULT_FILE_WATCHING: FileWatchingConfig = {
  enabled: false,
  ignoreDotFiles: true,
  autoRebuildTree: true,
  maxWatchedDirectories: 1000,
  watchForNewFiles: true,
  watchForDeleted: true,
  watchForChanged: true
};

const DEBOUNCE_DURATION_MS = 2000; // 2 seconds
const INTEGRITY_SWEEP_INTERVAL_MS = 30_000; // 30 seconds

/**
 * ServerCoordinator encapsulates all orchestration state and lifecycle for
 * FileScopeMCP. It can be used by MCP transport (via registerTools) or directly
 * as a standalone coordinator without any MCP transport (daemon mode, tests).
 */
export class ServerCoordinator {
  private currentConfig: FileTreeConfig | null = null;
  private fileWatcher: FileWatcher | null = null;
  private treeMutex = new AsyncMutex();
  private fileEventDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private integritySweepInterval: NodeJS.Timeout | null = null;
  private _initialized = false;
  private _projectRoot: string | null = null;
  private changeDetector: ChangeDetector | null = null;
  private llmPipeline: LLMPipeline | null = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  isInitialized(): boolean {
    return this._initialized;
  }

  getProjectRoot(): string | null {
    return this._projectRoot;
  }

  getCurrentConfig(): FileTreeConfig | null {
    return this.currentConfig;
  }

  /**
   * Returns a nested FileNode tree reconstructed from SQLite, for backward
   * compatibility with tools that expect a tree shape (e.g., list_files).
   */
  getFileTree(): FileNode {
    const dbFiles = getAllFiles();
    return this.reconstructTreeFromDb(dbFiles, this._projectRoot!);
  }

  getFileWatcher(): FileWatcher | null {
    return this.fileWatcher;
  }

  /**
   * Update the coordinator's current config (used when loading a saved tree).
   */
  setConfig(config: FileTreeConfig): void {
    this.currentConfig = config;
  }

  /**
   * Toggle file watching on/off. Caller is responsible for saving config.
   */
  async toggleFileWatching(): Promise<void> {
    const config = getConfig();
    if (!config || !config.fileWatching) return;

    if (config.fileWatching.enabled) {
      await this.initializeFileWatcher();
    } else {
      if (this.fileWatcher) {
        this.fileWatcher.stop();
        this.fileWatcher = null;
      }
    }
  }

  /**
   * Re-initialize the file watcher (e.g., after config change).
   */
  async reinitializeWatcher(): Promise<void> {
    await this.initializeFileWatcher();
  }

  /**
   * Toggle LLM pipeline on/off at runtime (called by toggle_llm MCP tool).
   * Does not persist the config change — caller is responsible for saving config.
   */
  toggleLlm(enabled: boolean): void {
    if (enabled && !this.isLlmRunning()) {
      const config = getConfig();
      if (config?.llm) {
        this.startLlmPipeline(config.llm);
      } else {
        log('toggleLlm: enabled=true but no llm config found');
      }
    } else if (!enabled && this.isLlmRunning()) {
      this.stopLlmPipeline();
    }
  }

  /**
   * Returns true if the LLM pipeline is currently running.
   */
  isLlmRunning(): boolean {
    return this.llmPipeline?.isRunning() ?? false;
  }

  /**
   * Returns true if the LLM lifetime token budget has been exhausted.
   * Used as a circuit breaker to prevent new jobs from being inserted.
   */
  isLlmBudgetExhausted(): boolean {
    return this.llmPipeline?.getBudgetGuard().isExhausted() ?? false;
  }

  /**
   * Returns the total number of tokens consumed across the lifetime of the pipeline.
   */
  getLlmLifetimeTokensUsed(): number {
    return this.llmPipeline?.getBudgetGuard().getLifetimeTokensUsed() ?? 0;
  }

  /**
   * Returns the configured lifetime token budget (0 = unlimited).
   */
  getLlmTokenBudget(): number {
    return getConfig()?.llm?.tokenBudget ?? 0;
  }

  /**
   * Returns the configured per-minute token rate limit (default 40000).
   */
  getLlmMaxTokensPerMinute(): number {
    return getConfig()?.llm?.maxTokensPerMinute ?? 40_000;
  }

  /**
   * Initialize or re-initialize the project analysis.
   * @param projectPath Absolute path to the project directory.
   * @returns ToolResponse indicating success or failure.
   */
  async init(projectPath: string): Promise<ToolResponse> {
    const projectRoot = canonicalizePath(projectPath, process.cwd());
    log(`Initializing project at: ${projectRoot}`);

    try {
      await fs.access(projectRoot);
    } catch (error) {
      return this._errorResponse(`Error: Directory not found at ${projectRoot}`);
    }

    // Close the existing database before switching projects
    closeDatabase();

    // Set the global project root and change the current working directory
    setProjectRoot(projectRoot);
    process.chdir(projectRoot);
    log('Changed working directory to: ' + process.cwd());

    // Store project root on instance
    this._projectRoot = projectRoot;

    // Initialize ChangeDetector for semantic change classification (Phase 3)
    this.changeDetector = new ChangeDetector(projectRoot);

    // Acquire PID file guard — prevents concurrent daemons from corrupting the DB
    await this.acquirePidFile(projectRoot);

    // Update the base directory in the global config
    let config = getConfig();
    if (config) {
      config.baseDirectory = projectRoot;
      setConfig(config);
    }

    // Define the configuration for the new file tree
    const newConfig: FileTreeConfig = {
      filename: `FileScopeMCP-tree-${path.basename(projectRoot)}.json`,
      baseDirectory: projectRoot,
      projectRoot: projectRoot,
      lastUpdated: new Date()
    };

    // Open the SQLite database for this project (coordinator owns the lifecycle)
    const dbPath = path.join(projectRoot, '.filescope.db');
    openDatabase(dbPath);
    log(`Opened SQLite database at: ${dbPath}`);

    // Run JSON-to-SQLite migration if needed — receives the already-open DB handle
    try {
      runMigrationIfNeeded(projectRoot, getSqlite());
    } catch (err) {
      log(`Migration failed (non-fatal): ${err}`);
    }

    try {
      await this.buildFileTree(newConfig);

      // Always initialize file watcher for self-healing
      log('Initializing file watcher for self-healing...');
      await this.initializeFileWatcher();

      // Start periodic integrity sweep
      log('Starting periodic integrity sweep...');
      this.startIntegritySweep();

      this._initialized = true;

      // Start LLM pipeline if configured and enabled (non-blocking)
      const appConfig = getConfig();
      if (appConfig?.llm?.enabled) {
        this.startLlmPipeline(appConfig.llm);
      }

      return this._okResponse(`Project path set to ${projectRoot}. File tree built and saved to SQLite.`);
    } catch (error) {
      log('Failed to build file tree: ' + error);
      return this._errorResponse(`Failed to build file tree for ${projectRoot}: ${error}`);
    }
  }

  /**
   * Load configuration and auto-initialize from --base-dir argument.
   * Called once at server startup.
   */
  async initServer(): Promise<void> {
    log('Starting FileScopeMCP server initialization...');
    log('Initial working directory: ' + process.cwd());
    log('Command line args: ' + process.argv);

    // Load the base configuration file first
    const config = await loadConfig();
    setConfig(config);

    // Check for --base-dir argument for auto-initialization
    const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
    if (baseDirArg) {
      const projectPath = baseDirArg.split('=')[1];
      if (projectPath) {
        log(`Found --base-dir argument. Initializing project at: ${projectPath}`);
        await this.init(projectPath);
      } else {
        log('--base-dir argument found but is empty. Server will wait for manual initialization.');
      }
    } else {
      log('No --base-dir argument found. Server initialized in a waiting state.');
      log('Call the `set_project_path` tool to analyze a directory.');
    }
  }

  /**
   * Graceful shutdown: clear timers, stop watcher, drain mutex, close DB.
   */
  async shutdown(): Promise<void> {
    log('ServerCoordinator shutting down...');

    // Clear all debounce timers to prevent new mutex acquisitions
    for (const [, timer] of this.fileEventDebounceTimers) {
      clearTimeout(timer);
    }
    this.fileEventDebounceTimers.clear();

    // Stop integrity sweep
    if (this.integritySweepInterval) {
      clearInterval(this.integritySweepInterval);
      this.integritySweepInterval = null;
    }

    // Stop file watcher
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    // Drain the mutex (wait for any in-flight mutations to complete)
    await this.treeMutex.run(async () => {});

    // Stop LLM pipeline before closing DB (pipeline persists budget state)
    this.stopLlmPipeline();

    // Close the database
    closeDatabase();

    // Clear ChangeDetector reference
    this.changeDetector = null;

    this._initialized = false;
    log('ServerCoordinator shutdown complete.');

    // Release PID file last — after DB is closed
    if (this._projectRoot) {
      this.releasePidFile(this._projectRoot);
    }
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private startLlmPipeline(llmConfig: LLMConfig): void {
    this.llmPipeline = new LLMPipeline(llmConfig);
    // Restore persisted lifetime token usage
    const savedTokens = loadLlmRuntimeState('lifetime_tokens_used');
    if (savedTokens !== null) {
      const parsed = parseInt(savedTokens, 10);
      if (!isNaN(parsed)) {
        this.llmPipeline.getBudgetGuard().setLifetimeTokensUsed(parsed);
        log(`LLM pipeline: restored ${parsed} lifetime tokens from persistent state`);
      }
    }
    this.llmPipeline.start();
    log('LLM pipeline started');
  }

  private stopLlmPipeline(): void {
    if (this.llmPipeline === null) return;
    // Persist budget state before stopping
    const lifetimeTokens = this.llmPipeline.getBudgetGuard().getLifetimeTokensUsed();
    saveLlmRuntimeState('lifetime_tokens_used', String(lifetimeTokens));
    this.llmPipeline.stop();
    this.llmPipeline = null;
    log('LLM pipeline stopped');
  }

  private _okResponse(text: string): ToolResponse {
    return { content: [{ type: 'text', text }] };
  }

  private _errorResponse(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: true };
  }

  /**
   * Acquire the PID file guard. Throws if another live daemon is already running
   * for this project. Overwrites stale PID files (process no longer running).
   */
  private async acquirePidFile(projectRoot: string): Promise<void> {
    const pidPath = path.join(projectRoot, '.filescope.pid');
    try {
      const existing = fsSync.readFileSync(pidPath, 'utf-8');
      const existingPid = parseInt(existing.trim(), 10);
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0); // throws ESRCH if not running
          throw new Error(
            `FileScopeMCP daemon already running (PID ${existingPid}). ` +
            `Stop it first or delete ${pidPath}.`
          );
        } catch (e: any) {
          if (e.code !== 'ESRCH') throw e;
          log(`Stale PID file found (PID ${existingPid} not running). Overwriting.`);
        }
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    fsSync.writeFileSync(pidPath, String(process.pid), 'utf-8');
  }

  /**
   * Release the PID file. Called as the final step of shutdown().
   */
  private releasePidFile(projectRoot: string): void {
    const pidPath = path.join(projectRoot, '.filescope.pid');
    try { fsSync.unlinkSync(pidPath); } catch { /* already gone */ }
  }

  /**
   * Initialize the file watcher.
   */
  private async initializeFileWatcher(): Promise<void> {
    try {
      const config = getConfig();
      if (!config || !config.fileWatching) {
        log('Cannot initialize file watcher: config or fileWatching not available');
        return;
      }

      // Stop any existing watcher
      if (this.fileWatcher) {
        this.fileWatcher.stop();
        this.fileWatcher = null;
      }

      // Create and start a new watcher
      this.fileWatcher = new FileWatcher(config.fileWatching, this._projectRoot!);
      this.fileWatcher.addEventCallback((filePath, eventType) => this.handleFileEvent(filePath, eventType));
      this.fileWatcher.start();

      log('File watcher initialized and started successfully');
    } catch (error) {
      log('Error initializing file watcher: ' + error);
    }
  }

  /**
   * Handle a file system event (add/change/unlink), with debouncing.
   * Uses a temporary tree reconstructed from DB as bridge for file-utils functions.
   */
  private async handleFileEvent(filePath: string, eventType: FileEventType): Promise<void> {
    log(`[Coordinator] Handling file event: ${eventType} for ${filePath}`);

    const activeConfig = this.currentConfig;
    const projectRoot = this._projectRoot;
    const fileWatchingConfig = getConfig()?.fileWatching;

    if (!activeConfig || !projectRoot || !fileWatchingConfig) {
      log('[Coordinator] Ignoring file event: Active config, project root, or watching config not available.');
      return;
    }

    if (!this._initialized) {
      log('[Coordinator] Ignoring file event: Not initialized.');
      return;
    }

    if (!fileWatchingConfig.autoRebuildTree) {
      log('[Coordinator] Ignoring file event: Auto-rebuild is disabled.');
      return;
    }

    // --- Debounce Logic ---
    const debounceKey = `${filePath}:${eventType}`;
    const existingTimer = this.fileEventDebounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const newTimer = setTimeout(() => {
      this.fileEventDebounceTimers.delete(debounceKey);
      log(`[Coordinator] Debounced processing for: ${eventType} - ${filePath}`);

      this.treeMutex.run(async () => {
        if (!this._initialized || !this._projectRoot) return;
        try {
          // Bridge: reconstruct a temporary tree from DB for file-utils functions
          const dbFiles = getAllFiles();
          const tempTree = this.reconstructTreeFromDb(dbFiles, projectRoot);

          switch (eventType) {
            case 'add':
              if (fileWatchingConfig.watchForNewFiles) {
                log(`[Coordinator] Calling addFileNode for ${filePath}`);
                await addFileNode(filePath, tempTree, projectRoot);
              }
              break;

            case 'change':
              if (fileWatchingConfig.watchForChanged) {
                // 1. Run semantic change detection BEFORE updating file metadata
                let changeSummary: SemanticChangeSummary | null = null;
                if (this.changeDetector) {
                  try {
                    changeSummary = await this.changeDetector.classify(filePath);
                    log(`[Coordinator] SemanticChange for ${filePath}: ${changeSummary.changeType} (affectsDependents=${changeSummary.affectsDependents})`);
                  } catch (err) {
                    log(`[Coordinator] Change detection failed for ${filePath}: ${err}`);
                  }
                }

                // 2. Proceed with normal file update
                log(`[Coordinator] CHANGE detected for ${filePath}, performing incremental update.`);
                await updateFileNodeOnChange(filePath, tempTree, projectRoot);

                // 3. Dispatch to CascadeEngine based on change semantics
                if (changeSummary) {
                  if (changeSummary.affectsDependents) {
                    // Export/type surface changed — propagate staleness to all transitive dependents.
                    // Build a changeContext so cascade jobs carry non-null payloads for the LLM pipeline.
                    // Note: for non-TS/JS files, _classifyWithLlmFallback already queued a more
                    // detailed diff-based change_impact job via queueLlmDiffJob. The dedup in
                    // insertLlmJobIfNotPending will prevent a duplicate — cascadeStale's change_impact
                    // for the root file acts as a safety net.
                    const changeContext = {
                      directPayload: `[file changed: ${filePath} (${changeSummary.changeType})]`,
                      changeType: changeSummary.changeType,
                      changedFilePath: filePath,
                    };
                    cascadeStale(filePath, { timestamp: Date.now(), changeContext, isExhausted: () => this.isLlmBudgetExhausted() });
                  } else {
                    // Body-only change — mark only this file's summary and concepts stale
                    markSelfStale(filePath, { timestamp: Date.now(), isExhausted: () => this.isLlmBudgetExhausted() });
                  }
                }
              }
              break;

            case 'unlink':
              if (fileWatchingConfig.watchForDeleted) {
                // Cascade BEFORE removeFileNode: dependency edges must still exist
                // so getDependents() can find all dependents of the deleted file.
                cascadeStale(filePath, { timestamp: Date.now(), isExhausted: () => this.isLlmBudgetExhausted() });
                log(`[Coordinator] Calling removeFileNode for ${filePath}`);
                await removeFileNode(filePath, tempTree, projectRoot);
              }
              break;
          }
        } catch (error) {
          log(`[Coordinator] Error processing debounced file event ${eventType} for ${filePath}: ${error}`);
        }
      });
    }, DEBOUNCE_DURATION_MS);

    this.fileEventDebounceTimers.set(debounceKey, newTimer);
  }

  /**
   * Start periodic integrity sweep for self-healing.
   * Runs every INTEGRITY_SWEEP_INTERVAL_MS to detect stale, missing, or new files.
   */
  private startIntegritySweep(): void {
    if (this.integritySweepInterval) clearInterval(this.integritySweepInterval);
    this.integritySweepInterval = setInterval(() => {
      if (!this.currentConfig || !this._initialized) return;

      const config = getConfig();
      if (!config?.fileWatching?.autoRebuildTree) {
        log('[Integrity Sweep] Skipping: autoRebuildTree is disabled.');
        return;
      }

      this.treeMutex.run(async () => {
        if (!this.currentConfig || !this._initialized || !this._projectRoot) return;
        try {
          // Bridge: reconstruct a temporary tree from DB for integrityCheck
          const dbFiles = getAllFiles();
          const tempTree = this.reconstructTreeFromDb(dbFiles, this._projectRoot);

          const result = await integrityCheck(tempTree, this._projectRoot);
          const totalIssues = result.staleFiles.length + result.missingFiles.length + result.newFiles.length;
          if (totalIssues === 0) return;

          log(`[Integrity Sweep] Found ${totalIssues} issues: ${result.staleFiles.length} stale, ${result.missingFiles.length} missing, ${result.newFiles.length} new`);

          // Re-fetch fresh temp tree for healing calls
          const healDbFiles = getAllFiles();
          const healTree = this.reconstructTreeFromDb(healDbFiles, this._projectRoot);

          // Auto-heal stale files
          for (const filePath of result.staleFiles) {
            await updateFileNodeOnChange(filePath, healTree, this._projectRoot);
          }
          // Auto-remove missing files
          for (const filePath of result.missingFiles) {
            await removeFileNode(filePath, healTree, this._projectRoot);
          }
          // Auto-add new files
          for (const filePath of result.newFiles) {
            await addFileNode(filePath, healTree, this._projectRoot);
          }
          log(`[Integrity Sweep] Healed: ${result.staleFiles.length} stale, ${result.missingFiles.length} removed, ${result.newFiles.length} added`);
        } catch (error) {
          log(`[Integrity Sweep] Error: ${error}`);
        }
      });
    }, INTEGRITY_SWEEP_INTERVAL_MS);
  }

  /**
   * Build or load the file tree — uses SQLite as cache.
   */
  private async buildFileTree(config: FileTreeConfig): Promise<void> {
    log('\n BUILD FILE TREE STARTED');
    log('==========================================');
    log('Building file tree with config: ' + JSON.stringify(config, null, 2));
    log('Current working directory: ' + process.cwd());
    log('Config in global state: ' + (getConfig() !== null ? 'YES' : 'NO'));
    if (getConfig()) {
      log('Global config exclude patterns count: ' + (getConfig()?.excludePatterns?.length || 0));
    }

    // Check if SQLite already has data — use as cache
    try {
      const dbFiles = getAllFiles();
      if (dbFiles.length > 0) {
        log(`Found ${dbFiles.length} files in SQLite — checking freshness`);

        // Spot-check freshness: sample up to 10 file nodes and compare mtimes
        const fileNodes = dbFiles.filter(f => !f.isDirectory);
        const sampleSize = Math.min(10, fileNodes.length);
        const sample = fileNodes.length <= 10
          ? fileNodes
          : fileNodes.sort(() => Math.random() - 0.5).slice(0, sampleSize);

        let isFresh = true;
        for (const node of sample) {
          if (node.mtime === undefined) {
            log('No mtime on node ' + node.path + ', forcing rescan');
            isFresh = false;
            break;
          }
          try {
            const stat = fsSync.statSync(node.path);
            if (Math.abs(stat.mtimeMs - node.mtime) > 1) {
              log('Stale mtime on ' + node.path + ': db=' + node.mtime + ' disk=' + stat.mtimeMs);
              isFresh = false;
              break;
            }
          } catch {
            log('Missing file during freshness check: ' + node.path);
            isFresh = false;
            break;
          }
        }

        if (isFresh) {
          log('Freshness check passed — using SQLite cache');
          this.currentConfig = config;
          log('BUILD FILE TREE COMPLETED (loaded from SQLite, freshness verified)');
          log('==========================================\n');
          return;
        } else {
          log('Freshness check failed — rescanning from disk');
          // Fall through to full rescan
        }
      }
    } catch (error) {
      log('Failed to load from SQLite: ' + error);
      // Continue to build new tree
    }

    // Full rescan from disk
    log('Building new file tree for directory: ' + config.baseDirectory);

    if (!getConfig()) {
      log('WARNING: No config in global state, setting it now');
      const freshConfig = await loadConfig();
      setConfig(freshConfig);
    }

    // Pass 1: Stream file metadata into SQLite
    log('Pass 1: Streaming file metadata into SQLite...');
    const sqlite = getSqlite();
    const batchUpsert = sqlite.transaction((nodes: FileNode[]) => {
      for (const node of nodes) {
        upsertFile(node);
      }
    });

    let batch: FileNode[] = [];
    const BATCH_SIZE = 100;
    let fileCount = 0;

    for await (const node of scanDirectory(config.baseDirectory)) {
      batch.push(node);
      fileCount++;
      if (batch.length >= BATCH_SIZE) {
        batchUpsert(batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      batchUpsert(batch);
    }

    if (fileCount === 0) {
      log('Failed to scan directory - no files found');
      throw new Error('Failed to scan directory');
    }
    log(`Pass 1 complete: streamed ${fileCount} files into SQLite`);

    // Pass 2: Extract dependencies for each file
    log('Pass 2: Extracting dependencies...');
    const allFiles = getAllFiles();
    const allPaths = allFiles.filter(f => !f.isDirectory).map(f => f.path);

    // Cache goModuleName once for the entire pass (avoid re-reading go.mod per file)
    let goModuleName: string | null | undefined = undefined;

    for (const filePath of allPaths) {
      const ext = path.extname(filePath);
      const dependencies: string[] = [];
      const packageDependencies: PackageDependency[] = [];

      // Check mtime — skip unchanged files that already have dependencies
      try {
        const stat = fsSync.statSync(filePath);
        const dbNode = allFiles.find(f => f.path === filePath);
        if (dbNode?.mtime !== undefined && Math.abs(stat.mtimeMs - dbNode.mtime) <= 1) {
          const existingDeps = getDependencies(filePath);
          if (existingDeps.length > 0) {
            continue; // File unchanged and has deps — skip
          }
        }
      } catch {
        continue; // File no longer on disk — skip
      }

      try {
        // AST-based extraction for TS/JS
        if (isTreeSitterLanguage(ext)) {
          const content = await fs.readFile(filePath, 'utf-8');
          const snapshot = extractSnapshot(filePath, content);
          if (snapshot) {
            for (const importPath of snapshot.imports) {
              if (isUnresolvedTemplateLiteral(importPath)) continue;
              try {
                const resolvedPath = resolveImportPath(importPath, filePath, config.baseDirectory);
                if (resolvedPath.includes('node_modules') || importPath.startsWith('@') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
                  const pkgDep = PackageDependency.fromPath(resolvedPath);
                  if (!pkgDep.name) {
                    if (importPath.startsWith('@')) {
                      const parts = importPath.split('/');
                      if (parts.length >= 2) { pkgDep.scope = parts[0]; pkgDep.name = `${parts[0]}/${parts[1]}`; }
                    } else if (importPath.includes('/')) {
                      pkgDep.name = importPath.split('/')[0];
                    } else {
                      pkgDep.name = importPath;
                    }
                  }
                  if (isUnresolvedTemplateLiteral(pkgDep.name)) continue;
                  if (pkgDep.name) {
                    const version = await extractPackageVersion(pkgDep.name, config.baseDirectory);
                    if (version) pkgDep.version = version;
                  }
                  packageDependencies.push(pkgDep);
                  continue;
                }
                const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];
                for (const extension of possibleExtensions) {
                  const pathToCheck = resolvedPath + extension;
                  try {
                    await fs.access(pathToCheck);
                    dependencies.push(pathToCheck);
                    break;
                  } catch { /* try next extension */ }
                }
              } catch (error) {
                log(`Failed to resolve path for ${importPath}: ${error}`);
              }
            }
          }
        } else if (ext === '.go') {
          const content = await fs.readFile(filePath, 'utf-8');
          if (goModuleName === undefined) {
            goModuleName = await readGoModuleName(config.baseDirectory);
          }
          const goResult = await resolveGoImports(content, filePath, config.baseDirectory, goModuleName);
          dependencies.push(...goResult.dependencies);
          packageDependencies.push(...goResult.packageDependencies);
        } else if (ext === '.rb') {
          const content = await fs.readFile(filePath, 'utf-8');
          const rbResult = await resolveRubyImports(content, filePath, config.baseDirectory);
          dependencies.push(...rbResult.dependencies);
          packageDependencies.push(...rbResult.packageDependencies);
        } else if (IMPORT_PATTERNS[ext]) {
          const content = await fs.readFile(filePath, 'utf-8');
          const matches = content.match(IMPORT_PATTERNS[ext]);
          if (matches) {
            for (const match of matches) {
              const importPath = extractImportPath(match);
              if (importPath && !isUnresolvedTemplateLiteral(importPath)) {
                try {
                  const resolvedPath = path.resolve(path.dirname(filePath), importPath);
                  if (resolvedPath.includes('node_modules') || importPath.startsWith('@') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
                    const pkgDep = PackageDependency.fromPath(resolvedPath);
                    if (!pkgDep.name) {
                      if (importPath.startsWith('@')) {
                        const parts = importPath.split('/');
                        if (parts.length >= 2) { pkgDep.scope = parts[0]; pkgDep.name = `${parts[0]}/${parts[1]}`; }
                      } else if (importPath.includes('/')) {
                        pkgDep.name = importPath.split('/')[0];
                      } else {
                        pkgDep.name = importPath;
                      }
                    }
                    if (isUnresolvedTemplateLiteral(pkgDep.name)) continue;
                    if (pkgDep.name) {
                      const version = await extractPackageVersion(pkgDep.name, config.baseDirectory);
                      if (version) pkgDep.version = version;
                    }
                    packageDependencies.push(pkgDep);
                    continue;
                  }
                  const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];
                  for (const extension of possibleExtensions) {
                    const pathToCheck = resolvedPath + extension;
                    try {
                      await fs.access(pathToCheck);
                      dependencies.push(pathToCheck);
                      break;
                    } catch { /* try next */ }
                  }
                } catch (error) {
                  log(`Failed to resolve regex import ${importPath}: ${error}`);
                }
              }
            }
          }
        }

        // Store dependencies in SQLite
        if (dependencies.length > 0 || packageDependencies.length > 0) {
          setDependencies(filePath, dependencies, packageDependencies);
        }
      } catch (error) {
        log(`Failed to extract dependencies for ${filePath}: ${error}`);
      }
    }
    log('Pass 2 complete: dependencies extracted');

    // Pass 2b: Calculate importance using existing tree-based functions
    log('Pass 2b: Calculating importance...');
    const freshDbFiles = getAllFiles();
    const tempTree = this.reconstructTreeFromDb(freshDbFiles, config.baseDirectory);
    buildDependentMap(tempTree);
    calculateImportance(tempTree);

    // Persist updated importance values back to SQLite
    const updatedNodes = getAllFileNodes(tempTree);
    const importanceBatch = sqlite.transaction((nodes: FileNode[]) => {
      for (const node of nodes) {
        upsertFile(node);
      }
    });
    importanceBatch(updatedNodes);

    this.currentConfig = config;
    log('BUILD FILE TREE COMPLETED (streaming two-pass scan)');
    log('==========================================\n');
  }

  /**
   * Reconstructs a nested FileNode tree from a flat list of DB rows.
   * Used when bridge calls to file-utils require a tree argument, and when
   * returning the tree shape to callers (getFileTree).
   */
  reconstructTreeFromDb(dbFiles: FileNode[], baseDirectory: string): FileNode {
    // Build a map of path -> node (with empty children arrays for dirs)
    const nodeMap = new Map<string, FileNode>();
    for (const f of dbFiles) {
      nodeMap.set(f.path, {
        ...f,
        children: f.isDirectory ? [] : undefined,
      });
    }

    // Find the root: node whose path equals baseDirectory (or shortest path)
    let root = nodeMap.get(baseDirectory) ?? nodeMap.get(normalizePath(baseDirectory));
    if (!root) {
      // Fall back to shortest path as root
      let shortest: FileNode | null = null;
      for (const node of nodeMap.values()) {
        if (!shortest || node.path.length < shortest.path.length) {
          shortest = node;
        }
      }
      root = shortest ?? {
        path: baseDirectory,
        name: path.basename(baseDirectory),
        isDirectory: true,
        children: []
      };
    }

    // Assign children to their parents
    for (const node of nodeMap.values()) {
      if (node.path === root.path) continue;
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      const parent = nodeMap.get(parentPath);
      if (parent && parent.isDirectory && parent.children) {
        parent.children.push(node);
      }
    }

    return root;
  }
}
