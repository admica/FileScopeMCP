#!/bin/bash
# PATH: ./build.sh
# MCP setup script for FileScopeMCP (Linux + macOS compatible, including WSL)

# Exit immediately on error
set -e

# Define color codes for better output readability
GREEN='\033[1;32m'
BLUE='\033[1;34m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

APPNAME="FileScopeMCP"
PROJECT_ROOT=$(pwd)

# OS detection using OSTYPE for better cross-platform support
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
    LOGFILE="${HOME}/Library/Logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
    mkdir -p "${HOME}/Library/Logs"
    PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
elif [[ "$OSTYPE" == "linux"* ]]; then
    OS="Linux"
    LOGFILE="${PROJECT_ROOT}/logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
    mkdir -p "${PROJECT_ROOT}/logs"
else
    echo "Could not detect OS using OSTYPE but likely Linuxish.."
    OS="Linux"
    LOGFILE="${PROJECT_ROOT}/logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
    mkdir -p "${PROJECT_ROOT}/logs"
fi

# Logging functions
print_header() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}] ### $1 ###"
    echo -e "${GREEN}${message}${NC}"
    echo "$message" >> "$LOGFILE"
}

print_action() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}] >>> $1"
    echo -e "${BLUE}${message}${NC}"
    echo "$message" >> "$LOGFILE"
}

print_warning() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}] !!! $1"
    echo -e "${YELLOW}${message}${NC}"
    echo "$message" >> "$LOGFILE"
}

print_error() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}] ERROR: $1"
    echo -e "${RED}${message}${NC}"
    echo "$message" >> "$LOGFILE"
    exit 1
}

print_detail() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}]     $1"
    echo -e "${CYAN}${message}${NC}"
    echo "$message" >> "$LOGFILE"
}

# Main script execution
print_header "Starting FileScopeMCP Setup"
print_detail "Detected OS: $OS"

# Check for Node.js and npm
print_action "Checking for Node.js and npm..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    print_error "Node.js and/or npm not installed. Install via Homebrew (macOS: 'brew install node') or your package manager (Linux: 'apt install nodejs')."
fi
print_detail "Node.js version: $(node --version), npm version: $(npm --version)"

# Install Node.js dependencies
print_action "Installing dependencies..."
if npm install 2>&1 | tee -a "$LOGFILE"; then
    print_detail "Dependencies installed successfully."
else
    print_error "Failed to install dependencies. Check $LOGFILE for details."
fi

# Compile TypeScript
print_action "Building TypeScript..."
if npm run build 2>&1 | tee -a "$LOGFILE"; then
    print_detail "TypeScript compiled successfully."
else
    if command -v tsc >/dev/null 2>&1; then
        print_warning "npm run build failed, falling back to tsc..."
        tsc 2>&1 | tee -a "$LOGFILE" || print_error "Build failed with tsc. Check $LOGFILE for details."
    else
        print_error "Build failed and tsc not found. Ensure 'build' script is in package.json or install TypeScript globally."
    fi
fi

# Build run.sh for simple setup (Linux and macOS)
# Use a single heredoc so `$@` is written literally (not expanded at build time)
# and PROJECT_ROOT / NODE_BIN are properly quoted when the clone path contains spaces.
print_action "Creating run.sh..."
NODE_BIN="$(command -v node)"
cat > run.sh <<EOF
#!/bin/bash
# Adapt this for your needs in WSL/Linux.
# Format: <node> <mcp-server.js> --base-dir=<your-project>
"${NODE_BIN}" "${PROJECT_ROOT}/dist/mcp-server.js" "\$@"
EOF
chmod +x run.sh

echo ">> run.sh:"
echo -n -e "${PURPLE}"
cat run.sh
echo -n -e "${NC}"

# Register with Claude Code (idempotent; fail-soft if `claude` CLI missing)
print_action "Registering with Claude Code..."
if npm run register-mcp 2>&1 | tee -a "$LOGFILE"; then
    print_detail "Claude Code MCP registration complete (or gracefully skipped — see output)."
else
    print_warning "Claude Code registration failed. Run 'npm run register-mcp' manually after setup."
fi

# Final message
print_header "Setup Complete"
print_detail "Project root: $PROJECT_ROOT"
print_detail "Log file: $LOGFILE"
echo -e "${GREEN}MCP server configuration generated.${NC}"
echo -e "${CYAN}Cursor AI: see docs/mcp-clients.md for per-OS .cursor/mcp.json snippets.${NC}"
echo -e "${CYAN}Claude Code: registration ran above. Re-run any time with 'npm run register-mcp'.${NC}"
echo -e "${CYAN}Run the server manually with: run.sh${NC}"
