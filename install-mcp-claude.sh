#!/bin/bash
# Registers FileScopeMCP as an MCP server for Claude Code.
# Safe to run multiple times — idempotent update.
# Run after building: ./build.sh  (or: npm install && npm run build)

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_CONFIG="${HOME}/.claude.json"

# Colours (degrade gracefully if terminal doesn't support them)
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }
info() { echo -e "${CYAN}  → $*${NC}"; }

echo ""
echo -e "${GREEN}=== FileScopeMCP — Claude Code Registration ===${NC}"
echo ""

# Locate node
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -z "$NODE_BIN" ] && fail "node not found in PATH. Install Node.js 18+ first."
ok "Node.js: $($NODE_BIN --version) at $NODE_BIN"

# Ensure the server is compiled
SERVER_JS="${PROJECT_ROOT}/dist/mcp-server.js"
if [ ! -f "$SERVER_JS" ]; then
    fail "dist/mcp-server.js not found. Run ./build.sh first to compile the project."
fi
ok "Server binary: $SERVER_JS"

# Use a .cjs temp file so CommonJS require() works even inside this ES-module project
TMP_SCRIPT="$(mktemp /tmp/fscope-claude-XXXXXX.cjs)"
trap 'rm -f "$TMP_SCRIPT"' EXIT

cat > "$TMP_SCRIPT" << 'NODESCRIPT'
const fs = require('fs');
const [,, configPath, nodeBin, projectRoot] = process.argv;

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    process.stderr.write('Warning: ' + configPath + ' could not be parsed; starting with empty config.\n');
  }
}

if (!config.mcpServers) config.mcpServers = {};

const alreadyRegistered =
  config.mcpServers.FileScopeMCP &&
  config.mcpServers.FileScopeMCP.args &&
  config.mcpServers.FileScopeMCP.args[0] === projectRoot + '/dist/mcp-server.js';

config.mcpServers.FileScopeMCP = {
  command: nodeBin,
  args: [projectRoot + '/dist/mcp-server.js']
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

process.stdout.write(JSON.stringify({ alreadyRegistered }) + '\n');
NODESCRIPT

RESULT="$("$NODE_BIN" "$TMP_SCRIPT" "$CLAUDE_CONFIG" "$NODE_BIN" "$PROJECT_ROOT")"
ALREADY="$(echo "$RESULT" | "$NODE_BIN" -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{ try{process.stdout.write(JSON.parse(d).alreadyRegistered?'yes':'no')}catch{process.stdout.write('no')} })")"

if [ "$ALREADY" = "yes" ]; then
    ok "Already registered (no changes needed)"
else
    ok "Registered successfully"
fi

echo ""
info "Config : $CLAUDE_CONFIG"
info "Command: $NODE_BIN"
info "Server : $SERVER_JS"
echo ""
echo -e "${GREEN}Done.${NC} Restart Claude Code (or run: claude mcp list) to confirm."
echo ""
