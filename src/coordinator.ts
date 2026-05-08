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
import { scanDirectory, calculateImportance, buildDependentMap, normalizePath, addFileNode, removeFileNode, updateFileNodeOnChange, integrityCheck, getAllFileNodes, isExcluded, IMPORTANCE_ALGORITHM_VERSION } from './file-utils.js';
import { canonicalizePath } from './storage-utils.js';
import { setProjectRoot, getProjectRoot, setConfig, getConfig } from './global-state.js';
import { loadConfig, FILESCOPE_DIR } from './config-utils.js';
import { FileWatcher, FileEventType } from './file-watcher.js';
import { log } from './logger.js';
import { openDatabase, closeDatabase, getSqlite } from './db/db.js';
import { runMigrationIfNeeded } from './migrate/json-to-sqlite.js';
import { runSymbolsBulkExtractionIfNeeded } from './migrate/bulk-symbol-extract.js';
import { runMultilangSymbolsBulkExtractionIfNeeded } from './migrate/bulk-multilang-symbol-extract.js';
import { runCallSiteEdgesBulkExtractionIfNeeded } from './migrate/bulk-call-site-extract.js';
import { getAllFiles, getFile, upsertFile, getDependencies, setEdges, setEdgesAndSymbols, purgeRecordsMatching, setRepoProjectRoot, getKvState, setKvState } from './db/repository.js';
import { extractEdges, extractTsJsFileParse, extractLangFileParse } from './language-config.js';
import type { EdgeResult } from './language-config.js';
import type { Symbol as SymbolRow } from './db/symbol-types.js';
import type { ImportMeta } from './change-detector/ast-parser.js';
import { ChangeDetector } from './change-detector/change-detector.js';
import type { SemanticChangeSummary } from './change-detector/types.js';
import { cascadeStale, markSelfStale } from './cascade/cascade-engine.js';
import { connect as brokerConnect, disconnect as brokerDisconnect, isConnected as brokerIsConnected, requestStatus } from './broker/client.js';
import { readStats } from './broker/stats.js';

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
  private _initialized = false;
  private _projectRoot: string | null = null;
  private changeDetector: ChangeDetector | null = null;

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
   * Toggle broker connection on/off at runtime (called by toggle_llm MCP tool).
   * Does not persist the config change — caller is responsible for saving config.
   */
  async toggleLlm(enabled: boolean): Promise<void> {
    if (enabled && !brokerIsConnected()) {
      await this.connectBroker();
    } else if (!enabled && brokerIsConnected()) {
      this.disconnectBroker();
    }
  }

  /**
   * Returns true if the broker client is currently connected.
   */
  isLlmRunning(): boolean {
    return brokerIsConnected();
  }

  /**
   * Returns current broker status for the get_llm_status MCP tool.
   * Connected: queries broker for live data.
   * Disconnected: reads last-known stats from ~/.filescope/stats.json.
   */
  async getBrokerStatus(): Promise<{
    mode: 'broker';
    brokerConnected: boolean;
    pendingCount: number | null;
    inProgressJob: { repoPath: string; filePath: string; jobType: string } | null;
    connectedClients: number | null;
    repoTokens: Record<string, number>;
  }> {
    if (!brokerIsConnected()) {
      const stats = readStats();
      return {
        mode: 'broker',
        brokerConnected: false,
        pendingCount: null,
        inProgressJob: null,
        connectedClients: null,
        repoTokens: stats.repoTokens,
      };
    }

    const status = await requestStatus();
    if (!status) {
      // Timeout or socket error during request — fall back to disk stats
      const stats = readStats();
      return {
        mode: 'broker',
        brokerConnected: true,
        pendingCount: null,
        inProgressJob: null,
        connectedClients: null,
        repoTokens: stats.repoTokens,
      };
    }

    return {
      mode: 'broker',
      brokerConnected: true,
      pendingCount: status.pendingCount,
      inProgressJob: status.inProgressJob,
      connectedClients: status.connectedClients,
      repoTokens: status.repoTokens,
    };
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

    // Ensure .filescope/ directory exists before anything writes into it
    const filescopeDir = path.join(projectRoot, FILESCOPE_DIR);
    fsSync.mkdirSync(filescopeDir, { recursive: true });

    // Write PID file (informational — multiple MCP instances per repo are normal
    // since each Claude Code session spawns its own stdio child process).
    // SQLite WAL mode + busy_timeout handle concurrent DB access safely.
    //
    // Detect stale PID from a previous run that died ungracefully (SIGKILL,
    // OOM, host crash) — graceful shutdown removes the file via shutdown(),
    // but uncatchable signals leave it behind. Logging here gives operators
    // visibility into "the previous instance died hard" without changing the
    // overwrite behavior below.
    const pidFilePath = path.join(filescopeDir, 'instance.pid');
    if (fsSync.existsSync(pidFilePath)) {
      try {
        const prevPid = parseInt(fsSync.readFileSync(pidFilePath, 'utf-8').trim(), 10);
        if (!isNaN(prevPid) && prevPid !== process.pid) {
          try {
            process.kill(prevPid, 0); // throws ESRCH if not running
            // Process is alive — multiple instances are valid; just overwrite.
          } catch (e: any) {
            if (e.code === 'ESRCH') {
              log(`Cleaning stale instance.pid (previous PID ${prevPid} not running — likely died via SIGKILL or crash)`);
            }
          }
        }
      } catch { /* unreadable / unparseable — overwrite anyway */ }
    }
    fsSync.writeFileSync(pidFilePath, String(process.pid), 'utf-8');

    // Reload config from disk so runtime edits (e.g. adding llm block) take effect
    const freshConfig = await loadConfig();
    freshConfig.baseDirectory = projectRoot;
    setConfig(freshConfig);

    // Define the configuration for the new file tree
    const newConfig: FileTreeConfig = {
      filename: `FileScopeMCP-tree-${path.basename(projectRoot)}.json`,
      baseDirectory: projectRoot,
      projectRoot: projectRoot,
      lastUpdated: new Date()
    };

    // Open the SQLite database for this project (coordinator owns the lifecycle)
    const dbPath = path.join(filescopeDir, 'data.db');
    openDatabase(dbPath);
    log(`Opened SQLite database at: ${dbPath}`);

    // Bind repository's path-translation layer to this project root. All
    // path-bearing SQL in repository.ts relativizes inputs and absolutifies
    // outputs against this root — DB stores host-portable relative paths.
    setRepoProjectRoot(projectRoot);

    // Format guard. Refuses to load a DB created by pre-relative-paths code,
    // where the failure mode is silent wrong-data (absolute strings get
    // returned as-is by absolutifyPath's defensive passthrough). The error
    // points the operator at a clean recovery: delete .filescope/.
    //
    // Fresh DB → no flag yet → write 'relative_v1'.
    // Future format bumps would compare against new known values here.
    const PATHS_FORMAT_KEY     = 'paths_format';
    const PATHS_FORMAT_CURRENT = 'relative_v1';
    const storedFormat = getKvState(PATHS_FORMAT_KEY);
    if (storedFormat === null) {
      setKvState(PATHS_FORMAT_KEY, PATHS_FORMAT_CURRENT);
    } else if (storedFormat !== PATHS_FORMAT_CURRENT) {
      throw new Error(
        `Incompatible .filescope/ DB format: kv_state.paths_format='${storedFormat}', expected '${PATHS_FORMAT_CURRENT}'. ` +
        `Delete ${path.join(projectRoot, '.filescope')} and reinit to refresh.`
      );
    }

    // (Cross-host portability is now intrinsic: paths are stored relative to
    // projectRoot, so a rsync'd .filescope/ no longer holds rows from a foreign
    // root. The previous purgeRecordsOutsideRoot band-aid was removed when the
    // relative-paths storage layout shipped.)

    // Purge records that now match the current exclude patterns. Handles the case
    // where paths (e.g. .claude/worktrees/) were indexed before being excluded, so
    // detect_cycles and related tools don't report false positives on stale data.
    const excluded = purgeRecordsMatching((p) => isExcluded(p, projectRoot, false));
    if (excluded.files > 0 || excluded.deps > 0 || excluded.symbols > 0 || excluded.symbolDeps > 0) {
      log(`Purged ${excluded.files} file records, ${excluded.deps} dependency edges, ${excluded.symbols} symbols, ${excluded.symbolDeps} symbol-dep edges matching current exclude patterns`);
    }

    // Run JSON-to-SQLite migration if needed — receives the already-open DB handle
    try {
      runMigrationIfNeeded(projectRoot, getSqlite());
    } catch (err) {
      log(`Migration failed (non-fatal): ${err}`);
    }

    // Phase 33 SYM-05 — populate symbols + imported_names for every TS/JS file on first boot.
    // Non-fatal: a failure here logs and continues; the in-memory file tree is built either way.
    try {
      await runSymbolsBulkExtractionIfNeeded(projectRoot);
    } catch (err) {
      log(`Bulk symbol extraction failed (non-fatal): ${err}`);
    }

    // Phase 36 MLS-05 — populate symbols for every tracked Python/Go/Ruby file on first boot.
    // Three independent per-language gates (D-26); does NOT reuse v1.6 symbols_bulk_extracted
    // (Pitfall 17 / D-28b). Placement: AFTER runSymbolsBulkExtractionIfNeeded (so v1.6 symbols
    // are in DB first), BEFORE buildFileTree (so the tree build sees all symbols).
    // Non-fatal: a failure here logs and continues; the in-memory file tree is built either way.
    try {
      await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);
    } catch (err) {
      log(`Bulk multilang symbol extraction failed (non-fatal): ${err}`);
    }

    // Phase 37 CSE-06 — populate symbol_dependencies for TS/JS files.
    // Hard-abort precondition: all Phase 36 per-language symbol gates must be set.
    // Non-fatal: failure logs and continues; file tree still built.
    try {
      await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    } catch (err) {
      log(`Bulk call-site edge extraction failed (non-fatal): ${err}`);
    }

    try {
      await this.buildFileTree(newConfig);

      // Always initialize file watcher for self-healing
      log('Initializing file watcher for self-healing...');
      await this.initializeFileWatcher();

      // Run one-time startup integrity sweep
      log('Running startup integrity sweep...');
      await this.runStartupIntegritySweep();

      this._initialized = true;

      // Connect to broker if LLM enabled (non-blocking)
      const appConfig = getConfig();
      if (appConfig?.llm?.enabled) {
        await this.connectBroker();
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
      // No --base-dir argument — auto-init to CWD
      const cwd = process.cwd();
      log(`No --base-dir argument. Auto-initializing to CWD: ${cwd}`);
      await this.init(cwd);
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

    // Stop file watcher
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    // Drain the mutex (wait for any in-flight mutations to complete)
    await this.treeMutex.run(async () => {});

    // Disconnect broker client before closing DB
    this.disconnectBroker();

    // Close the database
    closeDatabase();

    // Clear ChangeDetector reference
    this.changeDetector = null;

    this._initialized = false;
    log('ServerCoordinator shutdown complete.');

    // Clean up PID file on shutdown (best-effort)
    if (this._projectRoot) {
      const pidPath = path.join(this._projectRoot, FILESCOPE_DIR, 'instance.pid');
      try { fsSync.unlinkSync(pidPath); } catch { /* already gone */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Broker lifecycle (public — called by mcp-server.ts toggle_llm)
  // ---------------------------------------------------------------------------

  async connectBroker(): Promise<void> {
    if (!this._projectRoot) {
      log('[Coordinator] Cannot connect to broker: no project root');
      return;
    }
    await brokerConnect(this._projectRoot);
    if (brokerIsConnected()) {
      log('[Coordinator] Broker client connected');
    } else {
      log('[Coordinator] Broker client not connected — will retry in background');
    }
  }

  disconnectBroker(): void {
    brokerDisconnect();
    log('[Coordinator] Broker client disconnected');
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private _okResponse(text: string): ToolResponse {
    return { content: [{ type: 'text', text }] };
  }

  private _errorResponse(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: true };
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
                    // For non-TS/JS files, changeSummary.diff carries the real git diff from
                    // queueLlmDiffJob — use it as directPayload so the LLM gets the actual diff.
                    // For TS/JS files (AST path), no diff is available — use a metadata string.
                    const changeContext = {
                      directPayload: changeSummary.diff ?? `[file changed: ${filePath} (${changeSummary.changeType})]`,
                      changeType: changeSummary.changeType,
                      changedFilePath: filePath,
                    };
                    cascadeStale(filePath, { timestamp: Date.now(), changeContext });
                  } else {
                    // Body-only change — mark only this file's summary and concepts stale
                    markSelfStale(filePath, { timestamp: Date.now() });
                  }
                }
              }
              break;

            case 'unlink':
              if (fileWatchingConfig.watchForDeleted) {
                // Cascade BEFORE removeFileNode: dependency edges must still exist
                // so getDependents() can find all dependents of the deleted file.
                cascadeStale(filePath, { timestamp: Date.now() });
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
   * Run a one-time integrity sweep at startup, blocking until complete.
   * Detects files added/deleted/modified while server was down.
   * No treeMutex needed — runs before _initialized = true, so no concurrent file events.
   */
  private async runStartupIntegritySweep(): Promise<void> {
    if (!this._projectRoot) return;
    try {
      const dbFiles = getAllFiles();
      const tempTree = this.reconstructTreeFromDb(dbFiles, this._projectRoot);
      const result = await integrityCheck(tempTree, this._projectRoot);
      const totalIssues = result.staleFiles.length + result.missingFiles.length + result.newFiles.length;
      if (totalIssues === 0) {
        log('[Startup Sweep] No issues found.');
        return;
      }
      log(`[Startup Sweep] Found ${totalIssues} issues. Healing...`);
      const healDbFiles = getAllFiles();
      const healTree = this.reconstructTreeFromDb(healDbFiles, this._projectRoot);
      for (const filePath of result.staleFiles) {
        await updateFileNodeOnChange(filePath, healTree, this._projectRoot);
      }
      for (const filePath of result.missingFiles) {
        await removeFileNode(filePath, healTree, this._projectRoot);
      }
      for (const filePath of result.newFiles) {
        await addFileNode(filePath, healTree, this._projectRoot);
      }
      log(`[Startup Sweep] Healed: ${result.staleFiles.length} stale, ${result.missingFiles.length} removed, ${result.newFiles.length} added`);
    } catch (error) {
      log(`[Startup Sweep] Error: ${error}`);
    }
  }

  /**
   * Checks if a tracked file's mtime has changed since last recorded.
   * If stale: updates mtime in DB synchronously, queues file for LLM re-analysis.
   * Returns true if the file was stale (caller should include stale:true in response).
   * Returns false if fresh or file not in DB.
   */
  checkFileFreshness(filePath: string): boolean {
    try {
      const stat = fsSync.statSync(filePath);
      const node = getFile(filePath);
      if (!node || node.mtime === undefined) return false;
      if (Math.abs(stat.mtimeMs - node.mtime) <= 1) return false;

      // File is stale — update mtime synchronously (prevents repeated triggers)
      node.mtime = stat.mtimeMs;
      upsertFile(node);

      // Queue LLM re-analysis for the stale file
      markSelfStale(filePath, { timestamp: Date.now() });

      log(`[LazyMtime] Stale file detected: ${filePath}`);
      return true;
    } catch {
      // File deleted or unreadable — return false, let other mechanisms handle
      return false;
    }
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
          // Mtime-fresh, but the importance scoring algorithm may have been
          // bumped since this DB was last written. If so, edges/symbols are
          // still correct (mtimes unchanged) but importance values are stale —
          // run Pass 2b only, skipping the expensive Pass 1+2 rescan.
          const storedImportanceVer = getKvState('importance_algorithm_version');
          if (storedImportanceVer !== IMPORTANCE_ALGORITHM_VERSION) {
            log(`Importance algorithm bumped (stored=${storedImportanceVer ?? 'null'} → current=${IMPORTANCE_ALGORITHM_VERSION}) — running Pass 2b only`);
            this.recalculateImportanceFromDb(config);
            setKvState('importance_algorithm_version', IMPORTANCE_ALGORITHM_VERSION);
            this.currentConfig = config;
            log('BUILD FILE TREE COMPLETED (cache + targeted importance recalc)');
            log('==========================================\n');
            return;
          }

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

    for (const filePath of allPaths) {
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
        const content = await fs.readFile(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const isTsJs = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
        // Phase 36 MLS-04 — three-way dispatch (D-23). Py/Go/Rb flow through
        // extractLangFileParse so per-language symbol extractors populate the
        // symbols table on the scan path.
        const isPyGoRb = ext === '.py' || ext === '.go' || ext === '.rb';

        let edges: EdgeResult[] = [];
        let symbols: SymbolRow[] = [];
        let importMeta: ImportMeta[] = [];
        let callSiteEdges: import('./change-detector/types.js').CallSiteEdge[] | undefined;
        let useAtomicWrite = false;

        if (isTsJs) {
          const parsed = await extractTsJsFileParse(filePath, content, config.baseDirectory);
          if (parsed) {
            edges = parsed.edges;
            symbols = parsed.symbols;
            importMeta = parsed.importMeta;
            callSiteEdges = parsed.callSiteEdges;
            useAtomicWrite = true;
          } else {
            edges = await extractEdges(filePath, content, config.baseDirectory);
          }
        } else if (isPyGoRb) {
          const parsed = await extractLangFileParse(filePath, content, config.baseDirectory);
          if (parsed) {
            edges = parsed.edges;
            symbols = parsed.symbols;
            // importMeta intentionally unset — D-05 (Py/Go/Rb don't carry it in v1.7).
            useAtomicWrite = true;
          } else {
            edges = await extractEdges(filePath, content, config.baseDirectory);
          }
        } else {
          edges = await extractEdges(filePath, content, config.baseDirectory);
        }

        // Map edges to legacy arrays for in-memory tree (unchanged behavior)
        for (const edge of edges) {
          if (edge.isPackage) {
            const pkgDep = PackageDependency.fromPath(edge.target);
            if (edge.packageName) pkgDep.name = edge.packageName;
            if (edge.packageVersion) pkgDep.version = edge.packageVersion;
            packageDependencies.push(pkgDep);
          } else {
            dependencies.push(edge.target);
          }
        }

        if (useAtomicWrite) {
          // TS/JS: atomic per-file write of edges + symbols + importMeta (D-15).
          setEdgesAndSymbols(filePath, edges, symbols, importMeta, callSiteEdges);
        } else if (edges.length > 0) {
          setEdges(filePath, edges);
        }
      } catch (error) {
        log(`Failed to extract dependencies for ${filePath}: ${error}`);
      }
    }
    log('Pass 2 complete: dependencies extracted');

    // Pass 2b: Calculate importance using existing tree-based functions
    this.recalculateImportanceFromDb(config);
    setKvState('importance_algorithm_version', IMPORTANCE_ALGORITHM_VERSION);

    this.currentConfig = config;
    log('BUILD FILE TREE COMPLETED (streaming two-pass scan)');
    log('==========================================\n');
  }

  /**
   * Pass 2b — reconstruct the tree from current DB rows, recompute importance,
   * and persist back. Called from both the full-rescan path and the targeted
   * algorithm-version-bump fast path; assumes Pass 1+2 have already populated
   * files and dependencies (or that the existing DB is mtime-fresh).
   */
  private recalculateImportanceFromDb(config: FileTreeConfig): void {
    log('Pass 2b: Calculating importance...');
    const freshDbFiles = getAllFiles();
    const tempTree = this.reconstructTreeFromDb(freshDbFiles, config.baseDirectory);
    buildDependentMap(tempTree);
    calculateImportance(tempTree);

    // Persist updated importance values back to SQLite
    const updatedNodes = getAllFileNodes(tempTree);
    const sqlite = getSqlite();
    const importanceBatch = sqlite.transaction((nodes: FileNode[]) => {
      for (const node of nodes) {
        upsertFile(node);
      }
    });
    importanceBatch(updatedNodes);
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

    // Find the root: node whose path equals baseDirectory, or synthesize one
    const normalizedBase = normalizePath(baseDirectory);
    let root = nodeMap.get(baseDirectory) ?? nodeMap.get(normalizedBase);
    if (!root) {
      // Streaming generator yields only files, not directories — synthesize root
      root = {
        path: normalizedBase,
        name: path.basename(normalizedBase),
        isDirectory: true,
        children: []
      };
      nodeMap.set(normalizedBase, root);
    }

    // Ensure intermediate directories exist in the map (generator yields only files)
    const ensureDir = (dirPath: string): FileNode => {
      let dir = nodeMap.get(dirPath);
      if (!dir) {
        dir = { path: dirPath, name: path.basename(dirPath), isDirectory: true, children: [] };
        nodeMap.set(dirPath, dir);
      }
      return dir;
    };

    // Assign children to their parents
    for (const node of nodeMap.values()) {
      if (node.path === root.path) continue;
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      if (parentPath.length < root.path.length) continue;
      const parent = ensureDir(parentPath);
      if (parent.children) {
        parent.children.push(node);
      }
    }

    return root;
  }
}
