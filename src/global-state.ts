import { Config } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import { error as logError, info as logInfo, debug as logDebug } from './logger.js';
import ignore, { Ignore } from 'ignore';

// Global state management for the MCP server
let _projectRoot: string = ''; // Default to empty string, will be set by initializeProject
let _config: Config | null = null;

export function setProjectRoot(root: string) {
  _projectRoot = root;
  _customExcludesLoaded = false; // Reset so custom excludes are re-read for the new project
  _filescopeIgnore = null;
  _filescopeIgnoreLoaded = false;
  logInfo(`Global project root set to: ${_projectRoot}`);
}

export function getProjectRoot(): string {
  return _projectRoot;
}

export function setConfig(config: Config) {
  _config = config;
  _customExcludesLoaded = false; // Reset so custom excludes are re-merged with the new config
  _filescopeIgnore = null;
  _filescopeIgnoreLoaded = false;
  logDebug('Global config updated:', config);
}

// Cache for custom excludes so we don't re-read and re-append on every call
let _customExcludesLoaded = false;

// Cache for .filescopeignore rules
let _filescopeIgnore: Ignore | null = null;
let _filescopeIgnoreLoaded = false;

export function getConfig(): Config | null {
  if (!_config) return null;

  // Only load and merge custom excludes once
  if (!_customExcludesLoaded && _projectRoot) {
    try {
      const customExcludesPath = path.join(_projectRoot, 'FileScopeMCP-excludes.json');
      if (fs.existsSync(customExcludesPath)) {
        const customExcludes = JSON.parse(fs.readFileSync(customExcludesPath, 'utf-8'));
        if (Array.isArray(customExcludes)) {
          // Deduplicate: only add patterns not already present
          const existingSet = new Set(_config.excludePatterns);
          const newPatterns = customExcludes.filter((p: string) => !existingSet.has(p));
          if (newPatterns.length > 0) {
            _config.excludePatterns = [..._config.excludePatterns, ...newPatterns];
          }
          logInfo('Custom excludes loaded:', newPatterns);
        }
      }
    } catch (err) {
      logError('Error loading custom excludes:', err);
    }

    // Load .filescopeignore if present
    try {
      const filescopeignorePath = path.join(_projectRoot, '.filescopeignore');
      if (fs.existsSync(filescopeignorePath)) {
        const content = fs.readFileSync(filescopeignorePath, 'utf-8');
        _filescopeIgnore = ignore();
        _filescopeIgnore.add(content);
        logInfo('.filescopeignore loaded successfully');
      }
    } catch (err) {
      logError('Error loading .filescopeignore:', err);
      _filescopeIgnore = null;
    }
    _filescopeIgnoreLoaded = true;
    _customExcludesLoaded = true;
  }

  return _config;
}

export function getFilescopeIgnore(): Ignore | null {
  // Ensure lazy-load has run
  if (!_filescopeIgnoreLoaded && _projectRoot) {
    getConfig(); // triggers lazy load including .filescopeignore
  }
  return _filescopeIgnore;
}

export function addExclusionPattern(pattern: string): void {
  // 1. Add to in-memory config so scanDirectory excludes it immediately
  if (_config && _config.excludePatterns && !_config.excludePatterns.includes(pattern)) {
    _config.excludePatterns.push(pattern);
    logInfo(`Added exclusion pattern to in-memory config: ${pattern}`);

    // 2. Persist to config.json so it survives restarts
    try {
      const configPath = path.join(_projectRoot, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(_config, null, 2), 'utf-8');
      logInfo(`Persisted exclusion pattern to config.json: ${pattern}`);
    } catch (err) {
      logError('Error persisting exclusion pattern to config.json:', err);
    }
  }
}
