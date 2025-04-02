import * as chokidar from 'chokidar';
import * as path from 'path';
import { FileWatchingConfig } from './types.js';
import { getConfig, getProjectRoot } from './global-state.js';
import { normalizePath } from './file-utils.js';

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
  
  /**
   * Create a new FileWatcher instance
   * @param config The file watching configuration
   * @param baseDir The base directory to watch
   */
  constructor(config: FileWatchingConfig, baseDir: string) {
    this.config = config;
    this.baseDir = path.normalize(baseDir);
    console.error(`FileWatcher: Initialized with base directory: ${this.baseDir}`);
  }
  
  /**
   * Start watching for file changes
   */
  public start(): void {
    if (this.isWatching) {
      console.error('FileWatcher: Already running');
      return;
    }
    
    const watchOptions: chokidar.WatchOptions = {
      ignored: this.getIgnoredPatterns(),
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
    
    console.error(`FileWatcher: Starting on ${this.baseDir}`);
    
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
      this.watcher.on('error', (error) => {
        console.error(`FileWatcher: Error:`, error);
        this.errorCount++;
        
        // If too many errors, try restarting the watcher
        if (this.errorCount > 10) {
          console.error('FileWatcher: Too many errors, restarting...');
          this.restart();
        }
      });
      
      // Setup ready event
      this.watcher.on('ready', () => {
        console.error('FileWatcher: Initial scan complete. Ready for changes.');
      });
      
      this.isWatching = true;
      console.error('FileWatcher: Started successfully');
    } catch (error) {
      console.error('FileWatcher: Error starting:', error);
    }
  }
  
  /**
   * Stop watching for file changes
   */
  public stop(): void {
    if (!this.isWatching || !this.watcher) {
      console.error('FileWatcher: Not running');
      return;
    }
    
    console.error('FileWatcher: Stopping...');
    
    // Clear all throttle timers
    this.throttleTimers.forEach(timer => clearTimeout(timer));
    this.throttleTimers.clear();
    
    // Close the watcher
    this.watcher.close()
      .then(() => {
        console.error('FileWatcher: Stopped successfully');
      })
      .catch(error => {
        console.error('FileWatcher: Error stopping:', error);
      })
      .finally(() => {
        this.watcher = null;
        this.isWatching = false;
        this.errorCount = 0;
      });
  }
  
  /**
   * Restart the file watcher
   */
  public restart(): void {
    console.error('FileWatcher: Restarting...');
    this.stop();
    setTimeout(() => {
      if (!this.isWatching) {
        this.start();
      }
    }, 1000); // Delay restart to avoid immediate errors
  }
  
  /**
   * Register a callback for file events
   * @param callback The callback function to call when a file event occurs
   */
  public addEventCallback(callback: FileEventCallback): void {
    this.eventCallbacks.push(callback);
    console.error(`FileWatcher: Added event callback. Total callbacks: ${this.eventCallbacks.length}`);
  }
  
  /**
   * Remove a previously registered callback
   * @param callback The callback function to remove
   */
  public removeCallback(callback: FileEventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index !== -1) {
      this.eventCallbacks.splice(index, 1);
      console.error(`FileWatcher: Removed event callback. Total callbacks: ${this.eventCallbacks.length}`);
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
    
    console.error(`FileWatcher: Ignoring ${patterns.length} patterns:`, patterns.slice(0, 5));
    return patterns;
  }
  
  /**
   * Handle a file event
   * @param filePath The path of the file that changed
   * @param eventType The type of event
   */
  private onFileEvent(filePath: string, eventType: FileEventType): void {
    // Get relative path for logging
    const relativePath = path.relative(this.baseDir, filePath);
    console.error(`FileWatcher: Event: ${eventType} - ${relativePath}`);
    
    // Log the ignored patterns
    const ignoredPatterns = this.getIgnoredPatterns();
    console.error(`FileWatcher: Ignored patterns:`, ignoredPatterns);

    // Check if the file should be ignored
    const shouldIgnore = ignoredPatterns.some(pattern => {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      return regex.test(relativePath);
    });

    console.error(`FileWatcher: Should ignore ${relativePath}? ${shouldIgnore ? 'YES' : 'NO'}`);

    if (shouldIgnore) {
      console.error(`FileWatcher: Ignoring event for ${relativePath}`);
      return;
    }

    // Notify all registered callbacks of a file event
    console.error(`FileWatcher: Notifying ${this.eventCallbacks.length} callbacks for ${eventType} event on ${filePath}`);
    this.eventCallbacks.forEach(callback => {
      try {
        // Pass normalized path to callback
        callback(normalizePath(filePath), eventType); 
      } catch (error) {
        console.error(`FileWatcher: Error in callback:`, error);
      }
    });
  }
} 