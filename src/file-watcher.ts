import * as chokidar from 'chokidar';
import * as path from 'path';
import { FileWatchingConfig } from './types.js';
import { getConfig, getProjectRoot, getFilescopeIgnore } from './global-state.js';
import { normalizePath, globToRegExp } from './file-utils.js';
import { error as logError, warn as logWarn, info as logInfo, debug as logDebug } from './logger.js';

/**
 * Types of file events that the watcher can emit
 */
export type FileEventType = 'add' | 'change' | 'unlink';

/**
 * Callback function type for file events
 */
export type FileEventCallback = (filePath: string, eventType: FileEventType) => void;

/**
 * File watcher class that monitors file system changes
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private config: FileWatchingConfig;
  private baseDir: string;
  private isWatching: boolean = false;
  private eventCallbacks: FileEventCallback[] = [];
  private throttleTimers: Map<string, NodeJS.Timeout> = new Map();
  private errorCount: number = 0;
  private restartAttempts: number = 0;
  private readonly maxRestartDelay: number = 30_000;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private static readonly STABILITY_THRESHOLD_MS = 60_000;

  /**
   * Create a new FileWatcher instance
   * @param config The file watching configuration
   * @param baseDir The base directory to watch
   */
  constructor(config: FileWatchingConfig, baseDir: string) {
    this.config = config;
    this.baseDir = path.normalize(baseDir);
    logInfo(`FileWatcher: Initialized with base directory: ${this.baseDir}`);
  }

  /**
   * Start watching for file changes
   */
  public start(): void {
    if (this.isWatching) {
      logWarn('FileWatcher: Already running');
      return;
    }

    const watchOptions: chokidar.WatchOptions = {
      ignored: this.buildIgnoredOption(),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      },
      ignorePermissionErrors: true,
      depth: 99, // Maximum depth for directory traversal
      disableGlobbing: false,
      followSymlinks: false
    };

    logInfo(`FileWatcher: Starting on ${this.baseDir}`);

    try {
      this.watcher = chokidar.watch(this.baseDir, watchOptions);

      // Setup event handlers if watching is enabled for those events
      if (this.config.watchForNewFiles) {
        this.watcher.on('add', (filePath) => this.onFileEvent(filePath, 'add'));
      }

      if (this.config.watchForChanged) {
        this.watcher.on('change', (filePath) => this.onFileEvent(filePath, 'change'));
      }

      if (this.config.watchForDeleted) {
        this.watcher.on('unlink', (filePath) => this.onFileEvent(filePath, 'unlink'));
      }

      // Handle errors
      this.watcher.on('error', (err) => {
        logError(`FileWatcher: Error:`, err);
        this.errorCount++;

        // If too many errors, try restarting the watcher
        if (this.errorCount > 10) {
          logError('FileWatcher: Too many errors, restarting...');
          this.restart();
        }
      });

      // Setup ready event
      this.watcher.on('ready', () => {
        logInfo('FileWatcher: Initial scan complete. Ready for changes.');
      });

      this.isWatching = true;
      this.startStabilityTimer();
      logInfo('FileWatcher: Started successfully');
    } catch (err) {
      logError('FileWatcher: Error starting:', err);
    }
  }

  /**
   * Stop watching for file changes
   */
  public stop(): void {
    if (!this.isWatching || !this.watcher) {
      logDebug('FileWatcher: Not running');
      return;
    }

    logInfo('FileWatcher: Stopping...');

    // Clear stability timer to prevent it firing after shutdown
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }

    // Clear all throttle timers
    this.throttleTimers.forEach(timer => clearTimeout(timer));
    this.throttleTimers.clear();

    // Close the watcher
    this.watcher.close()
      .then(() => {
        logInfo('FileWatcher: Stopped successfully');
      })
      .catch(err => {
        logError('FileWatcher: Error stopping:', err);
      })
      .finally(() => {
        this.watcher = null;
        this.isWatching = false;
        this.errorCount = 0;
      });
  }

  /**
   * Restart the file watcher with exponential backoff
   */
  public restart(): void {
    // Clear any pending stability timer since we're restarting due to failure
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }

    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), this.maxRestartDelay);
    this.restartAttempts++;
    logWarn(`FileWatcher: Restarting in ${delay}ms (attempt ${this.restartAttempts})...`);
    this.stop();
    setTimeout(() => {
      if (!this.isWatching) {
        this.start();
        // Do NOT reset restartAttempts here — start the stability timer instead
        this.startStabilityTimer();
      }
    }, delay);
  }

  /**
   * Starts a timer that resets restartAttempts after 60 consecutive seconds
   * of stable operation (no errors triggering restart).
   */
  private startStabilityTimer(): void {
    // Clear any existing stability timer
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
    }
    this.stabilityTimer = setTimeout(() => {
      logInfo(`FileWatcher: Stable for ${FileWatcher.STABILITY_THRESHOLD_MS / 1000}s, resetting restart backoff counter`);
      this.restartAttempts = 0;
      this.stabilityTimer = null;
    }, FileWatcher.STABILITY_THRESHOLD_MS);
  }

  /**
   * Register a callback for file events
   * @param callback The callback function to call when a file event occurs
   */
  public addEventCallback(callback: FileEventCallback): void {
    this.eventCallbacks.push(callback);
    logDebug(`FileWatcher: Added event callback. Total callbacks: ${this.eventCallbacks.length}`);
  }

  /**
   * Remove a previously registered callback
   * @param callback The callback function to remove
   */
  public removeCallback(callback: FileEventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index !== -1) {
      this.eventCallbacks.splice(index, 1);
      logDebug(`FileWatcher: Removed event callback. Total callbacks: ${this.eventCallbacks.length}`);
    }
  }

  /**
   * Get patterns to ignore based on config
   * @returns Array of patterns to ignore
   */
  private getIgnoredPatterns(): (string | RegExp)[] {
    const patterns: (string | RegExp)[] = [];

    // Add patterns from excludePatterns in config
    const config = getConfig();
    if (config?.excludePatterns) {
      patterns.push(...config.excludePatterns);
    }

    // Add dot files if configured
    if (this.config.ignoreDotFiles) {
      patterns.push(/(^|[\/\\])\../); // Matches all paths starting with a dot
    }

    logDebug(`FileWatcher: Ignoring ${patterns.length} patterns:`, patterns.slice(0, 5));
    return patterns;
  }

  /**
   * Build the chokidar `ignored` option. Returns a function when .filescopeignore
   * is active (to support gitignore negation semantics), otherwise returns the
   * existing pattern array.
   */
  private buildIgnoredOption(): (string | RegExp)[] | ((testPath: string, stats?: import('fs').Stats) => boolean) {
    const ig = getFilescopeIgnore();
    const existingPatterns = this.getIgnoredPatterns();

    if (!ig) {
      return existingPatterns;
    }

    // When .filescopeignore is active, return a function that combines both checks
    return (testPath: string, stats?: import('fs').Stats): boolean => {
      const rel = path.relative(this.baseDir, testPath).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) return false;

      // Check existing config patterns
      const configMatch = existingPatterns.some(pattern => {
        if (pattern instanceof RegExp) return pattern.test(rel);
        return globToRegExp(String(pattern)).test(rel);
      });
      if (configMatch) return true;

      // Check .filescopeignore
      if (ig.ignores(rel)) return true;
      // Directory disambiguation: stats available from chokidar for the ignored function
      if (stats?.isDirectory?.() && ig.ignores(rel + '/')) return true;

      return false;
    };
  }

  /**
   * Handle a file event
   * @param filePath The path of the file that changed
   * @param eventType The type of event
   */
  private onFileEvent(filePath: string, eventType: FileEventType): void {
    // Get relative path for logging
    const relativePath = path.relative(this.baseDir, filePath);
    logDebug(`FileWatcher: Event: ${eventType} - ${relativePath}`);

    // Log the ignored patterns
    const ignoredPatterns = this.getIgnoredPatterns();
    logDebug(`FileWatcher: Ignored patterns:`, ignoredPatterns);

    // Check if the file should be ignored by config patterns
    const shouldIgnore = ignoredPatterns.some(pattern => {
      if (pattern instanceof RegExp) return pattern.test(relativePath);
      return globToRegExp(pattern).test(relativePath);
    });

    // Check .filescopeignore rules
    const ig = getFilescopeIgnore();
    const ignoredByFilescope = ig ? ig.ignores(relativePath.replace(/\\/g, '/')) : false;

    logDebug(`FileWatcher: Should ignore ${relativePath}? config=${shouldIgnore}, filescopeignore=${ignoredByFilescope}`);

    if (shouldIgnore || ignoredByFilescope) {
      logDebug(`FileWatcher: Ignoring event for ${relativePath}`);
      return;
    }

    // Notify all registered callbacks of a file event
    logDebug(`FileWatcher: Notifying ${this.eventCallbacks.length} callbacks for ${eventType} event on ${filePath}`);
    this.eventCallbacks.forEach(callback => {
      try {
        // Pass normalized path to callback
        callback(normalizePath(filePath), eventType);
      } catch (err) {
        logError(`FileWatcher: Error in callback:`, err);
      }
    });
  }
}
