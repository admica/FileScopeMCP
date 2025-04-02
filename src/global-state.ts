import { Config } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// Global state management for the MCP server
let _projectRoot: string = process.cwd(); // Default to current directory
let _config: Config | null = null;

export function setProjectRoot(root: string) {
  _projectRoot = root;
  console.error(`Global project root set to: ${_projectRoot}`);
}

export function getProjectRoot(): string {
  return _projectRoot;
}

export function setConfig(config: Config) {
  _config = config;
  console.error('Global config updated:', config);
}

export function getConfig(): Config | null {
  if (!_config) return null;

  try {
    const customExcludesPath = path.join(_projectRoot, 'FileScopeMCP-excludes.json');
    if (fs.existsSync(customExcludesPath)) {
      const customExcludes = JSON.parse(fs.readFileSync(customExcludesPath, 'utf-8'));
      if (Array.isArray(customExcludes)) {
        _config.excludePatterns = [..._config.excludePatterns, ...customExcludes];
        console.error('Custom excludes loaded:', customExcludes);
      }
    }
  } catch (error) {
    console.error('Error loading custom excludes:', error);
  }

  return _config;
} 