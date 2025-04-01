import { Config } from './types.js';

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
  return _config;
} 