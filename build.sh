
#!/bin/bash
# PATH: ./build.sh
# MCP setup script for FileScopeMCP

# Exit immediately on error
set -e

# Define color codes for better output readability
GREEN='\033[1;32m'
BLUE='\033[1;34m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

APPNAME="FileScopeMCP"
LOGFILE="/tmp/${APPNAME}_$(date +%Y%m%d_%H%M%S).log"

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

# Check for Node.js
print_action "Checking for Node.js..."
if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js is not installed. Please install it first (e.g., via nvm or apt)."
fi
print_detail "Node.js found: $(node --version)"

# Install Node.js dependencies
print_action "Installing dependencies..."
if npm install >> "$LOGFILE" 2>&1; then
    print_detail "Dependencies installed successfully."
else
    print_error "Failed to install dependencies. Check $LOGFILE for details."
fi

# Compile TypeScript
print_action "Building TypeScript..."
if npm run build >> "$LOGFILE" 2>&1; then
    print_detail "TypeScript compiled successfully."
else
    print_error "Build failed. Check $LOGFILE for details."
fi

# Generate MCP config from template in the base directory
print_action "Generating MCP configuration..."
PROJECT_ROOT=$(pwd)

if [ ! -f "mcp.json.txt" ]; then
    print_error "mcp.json.txt not found in the project directory."
fi

if sed "s|{projectRoot}|${PROJECT_ROOT}|g" mcp.json.txt > "mcp.json" 2>> "$LOGFILE"; then
    print_detail "MCP configuration generated at ./mcp.json"
else
    print_error "Failed to generate mcp.json. Check $LOGFILE for details."
fi

# Final message
print_header "Setup Complete"
print_detail "Project root: $PROJECT_ROOT"
print_detail "Log file: $LOGFILE"
echo -e "${GREEN}MCP server configuration generated.${NC}"
echo -e "${CYAN}Move ./mcp.json to your project's .cursor/ to use with Cursor AI, or run the server manually with: node dist/mcp-server.js${NC}"
