// Global state management for the MCP server
let _projectRoot: string = process.cwd(); // Default to current directory

export function setProjectRoot(root: string) {
  _projectRoot = root;
  console.error(`Global project root set to: ${_projectRoot}`);
}

export function getProjectRoot(): string {
  return _projectRoot;
} 