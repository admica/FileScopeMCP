#!/bin/bash
# PATH: ./build.sh
# MCP setup script for FileScopeMCP (Linux + macOS compatible, including WSL)

# Exit immediately on error, treat unset variables as errors, fail pipelines on first failure
set -euo pipefail

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

# Parse command-line flags for different installation scenarios
AGENT_MODE=false
SKIP_REGISTER=false
NO_WSL=false
CHECK_ONLY=false
CUSTOM_PREFIX=""
LEGACY_NPM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)
      AGENT_MODE=true
      SKIP_REGISTER=true
      shift
      ;;
    --skip-register)
      SKIP_REGISTER=true
      shift
      ;;
    --no-wsl)
      NO_WSL=true
      shift
      ;;
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    --prefix=*)
      CUSTOM_PREFIX="${1#*=}"
      PROJECT_ROOT="${CUSTOM_PREFIX}"
      # Create logs directory immediately for later use
      mkdir -p "${PROJECT_ROOT}/logs"
      LOGFILE="${PROJECT_ROOT}/logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
      shift
      ;;
    --legacy-npm)
      LEGACY_NPM=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--agent] [--skip-register] [--no-wsl] [--check-only] [--prefix=/path] [--legacy-npm]"
      exit 1
      ;;
  esac
done

# Build npm command flags based on selected options
NPM_FLAGS=""
if [[ "$LEGACY_NPM" == true ]]; then
  NPM_FLAGS="--legacy-peer-deps"
fi

# WSL2 mounted-drive warning (production: skip if --no-wsl or not on /mnt/)
if [[ "$NO_WSL" == false && "$PROJECT_ROOT" == /mnt/* ]]; then
  echo -e "${YELLOW}WARNING: Project is on a mounted Windows drive (/mnt/...).${NC}"
  echo -e "${YELLOW}Building on WSL2's native filesystem (~/) is much faster.${NC}"
  echo -e "${YELLOW}Consider: cp -r \"$PROJECT_ROOT\" ~/ && cd ~/$(basename "$PROJECT_ROOT")${NC}"
  echo ""
fi

# OS detection using OSTYPE for better cross-platform support
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
    if [[ -z "$CUSTOM_PREFIX" ]]; then
        LOGFILE="${HOME}/Library/Logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
        mkdir -p "${HOME}/Library/Logs"
    fi
    PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
elif [[ "$OSTYPE" == "linux"* ]]; then
    OS="Linux"
    if [[ -z "$CUSTOM_PREFIX" ]]; then
        LOGFILE="${PROJECT_ROOT}/logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
        mkdir -p "${PROJECT_ROOT}/logs"
    fi
else
    echo "Could not detect OS using OSTYPE but likely Linuxish.."
    OS="Linux"
    if [[ -z "$CUSTOM_PREFIX" ]]; then
        LOGFILE="${PROJECT_ROOT}/logs/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"
        mkdir -p "${PROJECT_ROOT}/logs"
    fi
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

# Check system prerequisites for native module compilation
check_prerequisites() {
    local missing=()

    # Check compilers
    for cmd in gcc g++ make; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd (C/C++ build toolchain)")
        fi
    done

    # Check SQLite dev headers (better-sqlite3)
    if [[ ! -f /usr/include/sqlite3.h ]] && ! pkg-config --exists sqlite3 2>/dev/null; then
        missing+=("libsqlite3-dev (header sqlite3.h missing)")
    fi

    # Check Python headers (node-gyp)
    if ! python3 -c "import sysconfig; sysconfig.get_config_var('INCLUDEPY')" 2>/dev/null; then
        missing+=("python3-dev (Python.h header missing)")
    fi

    # Check git (for git-based dependencies)
    if ! command -v git >/dev/null 2>&1; then
        missing+=("git")
    fi

    # Check curl/wget for prebuilt binary downloads
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
        missing+=("curl or wget (for downloading prebuilt binaries)")
    fi

    if (( ${#missing[@]} > 0 )); then
        echo ""
        echo -e "${RED}ERROR: Missing system prerequisites:${NC}"
        for item in "${missing[@]}"; do
            echo "  - $item"
        done
        echo ""
        echo -e "${YELLOW}Install on Ubuntu/Debian:${NC}"
        echo "  sudo apt update && sudo apt install -y build-essential libsqlite3-dev python3-dev git curl wget"
        echo ""
        echo -e "${YELLOW}Install on Fedora/RHEL:${NC}"
        echo "  sudo dnf install -y gcc gcc-c++ make sqlite-devel python3-devel git curl wget"
        echo ""
        echo -e "${YELLOW}Install on macOS (Homebrew):${NC}"
        echo "  brew install sqlite git curl wget"
        echo "  # If sqlite3.h is still missing: brew reinstall sqlite"
        echo ""
        exit 1
    fi
}

# Main script execution
print_header "Starting FileScopeMCP Setup"
print_detail "Detected OS: $OS"

# Check for Node.js and npm
print_action "Checking for Node.js and npm..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo ""
    echo -e "${RED}ERROR: Node.js and/or npm not installed.${NC}"
    echo ""
    echo -e "${YELLOW}Install on Ubuntu/Debian:${NC}"
    echo "  sudo apt update && sudo apt install -y nodejs npm"
    echo ""
    echo -e "${YELLOW}Install on Fedora/RHEL:${NC}"
    echo "  sudo dnf install -y nodejs npm"
    echo ""
    echo -e "${YELLOW}Install on macOS (Homebrew):${NC}"
    echo "  brew install node"
    echo ""
    exit 1
fi
print_detail "Node.js version: $(node --version), npm version: $(npm --version)"

# Verify native build prerequisites before installing dependencies
check_prerequisites

# If --check-only requested, stop here after verification
if [[ "$CHECK_ONLY" == true ]]; then
    print_detail "All prerequisites verified. Exiting (--check-only)."
    exit 0
fi

# Install Node.js dependencies
print_action "Installing dependencies..."
npm install $NPM_FLAGS 2>&1 | tee -a "$LOGFILE"
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    print_error "Failed to install dependencies. Check $LOGFILE for details."
fi
print_detail "Dependencies installed successfully."

# Compile TypeScript
print_action "Building TypeScript..."
npm run build $NPM_FLAGS 2>&1 | tee -a "$LOGFILE"
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    if command -v tsc >/dev/null 2>&1; then
        print_warning "npm run build failed, falling back to tsc..."
        tsc 2>&1 | tee -a "$LOGFILE"
        if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
            print_error "Build failed with tsc. Check $LOGFILE for details."
        fi
    else
        print_error "Build failed and tsc not found. Ensure 'build' script is in package.json or install TypeScript globally."
    fi
fi
print_detail "TypeScript compiled successfully."

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
if [[ "$SKIP_REGISTER" == false ]]; then
    print_action "Registering with Claude Code..."
    if npm run register-mcp 2>&1 | tee -a "$LOGFILE"; then
        print_detail "Claude Code MCP registration complete (or gracefully skipped — see output)."
    else
        print_warning "Claude Code registration failed. Run 'npm run register-mcp' manually after setup."
    fi
else
    print_detail "Skipping Claude Code registration (--skip-register or --agent)."
fi

# Final message
print_header "Setup Complete"
print_detail "Project root: $PROJECT_ROOT"
print_detail "Log file: $LOGFILE"
echo -e "${GREEN}MCP server configuration generated.${NC}"

if [[ "$AGENT_MODE" == false ]]; then
    echo -e "${CYAN}Cursor AI: see docs/mcp-clients.md for per-OS .cursor/mcp.json snippets.${NC}"
    echo -e "${CYAN}Claude Code: registration ran above. Re-run any time with 'npm run register-mcp'.${NC}"
    echo -e "${CYAN}Run the server manually with: run.sh${NC}"
else
    echo -e "${CYAN}Start the server with: node ${PROJECT_ROOT}/dist/mcp-server.js${NC}"
fi
