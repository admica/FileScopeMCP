#!/bin/bash
# PATH: ./setup-llm.sh
# Installs Ollama and pulls the default model for FileScopeMCP's LLM pipeline.
# Safe to run multiple times — idempotent. Skips steps already completed.
#
# Usage:
#   ./setup-llm.sh                     # Install Ollama + default model
#   ./setup-llm.sh --model <name>      # Install Ollama + specific model
#   ./setup-llm.sh --status            # Check current setup status
#   ./setup-llm.sh --help              # Show usage

set -e

# --- Configuration ---
BASE_MODEL="gemma4:e4b"
CUSTOM_MODEL="FileScopeMCP-brain"
OLLAMA_API="http://localhost:11434"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Colors (degrade gracefully) ---
GREEN='\033[1;32m'
BLUE='\033[1;34m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  [OK] $*${NC}"; }
info() { echo -e "${CYAN}  [..] $*${NC}"; }
warn() { echo -e "${YELLOW}  [!!] $*${NC}"; }
fail() { echo -e "${RED}  [FAIL] $*${NC}"; }
die()  { fail "$*"; exit 1; }

# --- Argument parsing ---
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --status)
            STATUS_ONLY=true
            shift
            ;;
        --help|-h)
            echo ""
            echo "Usage: ./setup-llm.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --status         Check Ollama/model status (works in WSL — checks Windows host)"
            echo "  --help           Show this help"
            echo ""
            echo "On native Linux/macOS: installs Ollama, pulls the base model ($BASE_MODEL),"
            echo "and creates the custom FileScopeMCP-brain model from the Modelfile."
            echo ""
            echo "On WSL2: prints step-by-step instructions for setting up Ollama on Windows"
            echo "and configuring FileScopeMCP to connect across the WSL network boundary."
            echo ""
            exit 0
            ;;
        *)
            die "Unknown option: $1 (try --help)"
            ;;
    esac
done

# --- WSL detection ---
is_wsl() {
    grep -qi 'microsoft\|wsl' /proc/version 2>/dev/null
}

# If running in WSL, print guidance and exit — Ollama should run on Windows for GPU access
wsl_guide() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  WSL2 detected — Ollama should be installed on Windows, not here${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  WSL2 cannot directly access your GPU for Ollama. Install and run"
    echo -e "  Ollama natively on Windows so it can use your GPU, then configure"
    echo -e "  FileScopeMCP to connect across the WSL network boundary."
    echo ""
    echo -e "  ${GREEN}On Windows:${NC}"
    echo ""
    echo -e "  1. Download Ollama from ${CYAN}https://ollama.com/download/windows${NC}"
    echo -e "     Install it and verify: ${CYAN}ollama --version${NC}"
    echo ""
    echo -e "  2. Configure Ollama to accept connections from WSL."
    echo -e "     In ${CYAN}PowerShell${NC}:"
    echo ""
    echo -e "     ${CYAN}[System.Environment]::SetEnvironmentVariable(\"OLLAMA_HOST\", \"0.0.0.0:11434\", \"User\")${NC}"
    echo ""
    echo -e "  3. Restart Ollama so it picks up the new binding."
    echo -e "     Right-click the Ollama tray icon (bottom-right of taskbar) → ${CYAN}Quit${NC}."
    echo -e "     Then relaunch Ollama from the Start Menu."
    echo ""
    echo -e "     Verify it's listening on all interfaces — in ${CYAN}PowerShell${NC}:"
    echo ""
    echo -e "     ${CYAN}netstat -an | findstr 11434${NC}"
    echo ""
    echo -e "     You should see ${GREEN}0.0.0.0:11434${NC} (not 127.0.0.1:11434)."
    echo ""
    echo -e "  4. Pull the base model."
    echo -e "     In ${CYAN}PowerShell${NC} or ${CYAN}Command Prompt${NC}:"
    echo ""
    echo -e "     ${CYAN}ollama pull ${BASE_MODEL}${NC}"
    echo ""
    WINDOWS_USER=$(cmd.exe /C "echo %USERNAME%" 2>/dev/null | tr -d '\r' || echo '<YourWindowsUser>')
    echo -e "  5. Copy the Modelfile to Windows and create the custom model."
    echo -e "     In this ${CYAN}WSL terminal${NC}:"
    echo ""
    echo -e "     ${CYAN}cp ${SCRIPT_DIR}/Modelfile /mnt/c/Users/${WINDOWS_USER}/Modelfile${NC}"
    echo ""
    echo -e "     Then in ${CYAN}PowerShell${NC}:"
    echo ""
    echo -e "     ${CYAN}cd \$env:USERPROFILE${NC}"
    echo -e "     ${CYAN}ollama create ${CUSTOM_MODEL} -f Modelfile${NC}"
    echo ""
    echo -e "  ${GREEN}Back in WSL:${NC}"
    echo ""
    echo -e "  6. Copy the broker config template:"
    echo ""
    echo -e "     ${CYAN}mkdir -p ~/.filescope${NC}"
    echo -e "     ${CYAN}cp ${SCRIPT_DIR}/broker.windows-host.json ~/.filescope/broker.json${NC}"
    echo ""
    echo -e "  7. Verify the connection:"
    echo ""
    GATEWAY_IP=$(ip route show default 2>/dev/null | awk '{print $3}')
    if [[ -n "$GATEWAY_IP" ]]; then
        echo -e "     ${CYAN}curl http://${GATEWAY_IP}:11434/v1/models${NC}"
        echo ""
        echo -e "     (Your Windows host IP is ${GREEN}${GATEWAY_IP}${NC})"
    else
        echo -e "     ${CYAN}curl http://\$(ip route show default | awk '{print \$3}'):11434/v1/models${NC}"
    fi
    echo ""
    echo -e "  8. Restart Claude Code, then verify the full pipeline:"
    echo ""
    echo -e "     ${CYAN}./setup-llm.sh --status${NC}"
    echo ""
    echo -e "     All items should show ${GREEN}[OK]${NC}. If Ollama or the model shows"
    echo -e "     ${RED}[FAIL]${NC}, revisit the steps above."
    echo ""
    echo -e "  ${YELLOW}If curl fails:${NC} Check that Windows Firewall allows port 11434."
    echo -e "  See the README for firewall instructions and full troubleshooting."
    echo ""
}

# --- GPU detection ---
detect_gpu() {
    echo ""
    info "Detecting GPU..."

    if command -v nvidia-smi &>/dev/null; then
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
        GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
        if [[ -n "$GPU_NAME" ]]; then
            ok "NVIDIA GPU: $GPU_NAME (${GPU_VRAM}MiB VRAM)"
            return 0
        fi
    fi

    if [[ -d /sys/class/drm ]]; then
        for card in /sys/class/drm/card*/device; do
            if [[ -f "$card/vendor" ]]; then
                VENDOR=$(cat "$card/vendor" 2>/dev/null)
                if [[ "$VENDOR" == "0x1002" ]]; then
                    DEVICE=$(cat "$card/device" 2>/dev/null || echo "unknown")
                    ok "AMD GPU detected (device: $DEVICE) — Ollama supports ROCm on Linux"
                    return 0
                fi
            fi
        done
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        ok "macOS detected — Ollama uses Metal GPU acceleration automatically"
        return 0
    fi

    warn "No GPU detected — Ollama will run in CPU-only mode (slower but works)"
    return 1
}

# --- Status check ---
check_ollama_installed() {
    command -v ollama &>/dev/null
}

check_ollama_running() {
    curl -sf "${OLLAMA_API}/api/tags" &>/dev/null
}

check_model_available() {
    local model_name="$1"
    curl -sf "${OLLAMA_API}/api/tags" 2>/dev/null | grep -q "\"${model_name}"
}

start_ollama() {
    info "Starting Ollama service..."

    # Try systemd first (most Linux distros)
    if command -v systemctl &>/dev/null; then
        if systemctl is-enabled ollama &>/dev/null 2>&1; then
            sudo systemctl start ollama 2>/dev/null && { ok "Started via systemd"; return 0; }
        fi
    fi

    # Fallback: start in background
    info "Starting Ollama in background..."
    nohup ollama serve &>/dev/null &
    OLLAMA_PID=$!

    # Wait for API to become available
    local retries=0
    while ! curl -sf "${OLLAMA_API}/api/tags" &>/dev/null; do
        retries=$((retries + 1))
        if [[ $retries -ge 15 ]]; then
            die "Ollama did not start within 15 seconds. Check 'ollama serve' manually."
        fi
        sleep 1
    done
    ok "Ollama running (PID: $OLLAMA_PID)"
}

show_status() {
    echo ""
    echo -e "${GREEN}=== FileScopeMCP LLM Setup Status ===${NC}"
    echo ""

    # Detect environment
    local api_url="$OLLAMA_API"
    if is_wsl; then
        local host_ip
        host_ip=$(ip route show default 2>/dev/null | awk '{print $3}')
        if [[ -n "$host_ip" ]]; then
            api_url="http://${host_ip}:11434"
            info "WSL2 detected — checking Ollama on Windows host (${host_ip})"
        else
            warn "WSL2 detected but could not determine Windows host IP"
        fi
    else
        # Ollama installed locally?
        if check_ollama_installed; then
            OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
            ok "Ollama installed: $OLLAMA_VER"
        else
            fail "Ollama not installed"
        fi
    fi

    # Ollama running?
    if curl -sf "${api_url}/api/tags" &>/dev/null; then
        ok "Ollama API responding at ${api_url}"
    else
        fail "Ollama not responding at ${api_url}"
        if is_wsl; then
            echo ""
            warn "Troubleshooting:"
            info "  1. Is Ollama running on Windows? (Start it from the Start Menu or run: ollama serve)"
            info "  2. Is OLLAMA_HOST set to 0.0.0.0:11434? (Check with: netstat -an | findstr 11434)"
            info "  3. Is Windows Firewall blocking port 11434? (See README for firewall rule)"
        fi
    fi

    # GPU?
    if ! is_wsl; then
        detect_gpu
    fi

    # Model available?
    if curl -sf "${api_url}/api/tags" &>/dev/null; then
        echo ""
        info "Installed models:"
        curl -sf "${api_url}/api/tags" 2>/dev/null | \
            grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | \
            while read -r m; do
                if [[ "$m" == "$CUSTOM_MODEL" ]] || [[ "$m" == "${CUSTOM_MODEL}:latest" ]]; then
                    echo -e "    ${GREEN}* $m (FileScopeMCP)${NC}"
                elif [[ "$m" == "$BASE_MODEL" ]] || [[ "$m" == "${BASE_MODEL}:latest" ]]; then
                    echo -e "    ${GREEN}  $m (base)${NC}"
                else
                    echo -e "    ${CYAN}  $m${NC}"
                fi
            done

        if ! curl -sf "${api_url}/api/tags" 2>/dev/null | grep -q "\"${CUSTOM_MODEL}"; then
            echo ""
            warn "Custom model '$CUSTOM_MODEL' not created yet"
            if is_wsl; then
                info "Create it on Windows:"
                info "  ollama create $CUSTOM_MODEL -f Modelfile"
            else
                info "Run ./setup-llm.sh to create it from the Modelfile"
            fi
        fi
    fi

    # Broker config
    echo ""
    if [[ -f "$HOME/.filescope/broker.json" ]]; then
        local broker_url
        broker_url=$(grep -o '"baseURL"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.filescope/broker.json" | sed 's/.*"baseURL"[[:space:]]*:[[:space:]]*"//;s/"//')
        ok "Broker config: ~/.filescope/broker.json"
        info "  baseURL: $broker_url"
        if is_wsl && [[ "$broker_url" == *"localhost"* ]]; then
            warn "  baseURL points to localhost — this won't work from WSL!"
            info "  Fix: cp $(cd "$(dirname "$0")" && pwd)/broker.windows-host.json ~/.filescope/broker.json"
        fi
    else
        warn "No broker config at ~/.filescope/broker.json"
        if is_wsl; then
            info "  Fix: cp $(cd "$(dirname "$0")" && pwd)/broker.windows-host.json ~/.filescope/broker.json"
        else
            info "  One will be auto-created from broker.default.json on first broker start"
        fi
    fi

    echo ""
}

# --- Status-only mode ---
if $STATUS_ONLY; then
    show_status
    exit 0
fi

# --- WSL check ---
if is_wsl; then
    wsl_guide
    exit 0
fi

# --- Main install flow ---
echo ""
echo -e "${GREEN}=== FileScopeMCP LLM Setup ===${NC}"
echo ""
echo -e "  Base model:   ${CYAN}${BASE_MODEL}${NC}"
echo -e "  Custom model: ${CYAN}${CUSTOM_MODEL}${NC}"
echo ""

# Step 1: Detect GPU
detect_gpu

# Step 2: Install Ollama
echo ""
if check_ollama_installed; then
    OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
    ok "Ollama already installed: $OLLAMA_VER"
else
    info "Installing Ollama..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS — check for brew first, otherwise direct install
        if command -v brew &>/dev/null; then
            brew install ollama 2>&1 | tail -3
        else
            curl -fsSL https://ollama.com/install.sh | sh
        fi
    else
        # Linux (including WSL)
        curl -fsSL https://ollama.com/install.sh | sh
    fi

    if check_ollama_installed; then
        OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
        ok "Ollama installed: $OLLAMA_VER"
    else
        die "Ollama installation failed. Visit https://ollama.com/download for manual install."
    fi
fi

# Step 3: Ensure Ollama is running
echo ""
if check_ollama_running; then
    ok "Ollama already running"
else
    start_ollama
fi

# Step 4: Pull base model
echo ""
if check_model_available "$BASE_MODEL"; then
    ok "Base model '$BASE_MODEL' already available"
else
    info "Pulling base model '$BASE_MODEL'... (this may take several minutes on first run)"
    echo ""
    ollama pull "$BASE_MODEL"

    if check_model_available "$BASE_MODEL"; then
        echo ""
        ok "Base model '$BASE_MODEL' ready"
    else
        die "Failed to pull model '$BASE_MODEL'. Check your internet connection and try: ollama pull $BASE_MODEL"
    fi
fi

# Step 5: Create custom model from Modelfile
echo ""
MODELFILE="${SCRIPT_DIR}/Modelfile"
if [[ ! -f "$MODELFILE" ]]; then
    die "Modelfile not found at $MODELFILE"
fi

if check_model_available "$CUSTOM_MODEL"; then
    ok "Custom model '$CUSTOM_MODEL' already exists"
    info "To rebuild: ollama rm $CUSTOM_MODEL && ./setup-llm.sh"
else
    info "Creating custom model '$CUSTOM_MODEL' from Modelfile..."
    ollama create "$CUSTOM_MODEL" -f "$MODELFILE"

    if check_model_available "$CUSTOM_MODEL"; then
        ok "Custom model '$CUSTOM_MODEL' created"
    else
        die "Failed to create custom model. Try: ollama create $CUSTOM_MODEL -f $MODELFILE"
    fi
fi

# Step 6: Verify end-to-end
echo ""
info "Verifying LLM endpoint..."
RESPONSE=$(curl -sf "${OLLAMA_API}/v1/models" 2>/dev/null)
if [[ -n "$RESPONSE" ]]; then
    ok "OpenAI-compatible API responding at ${OLLAMA_API}/v1"
else
    warn "OpenAI-compatible endpoint did not respond — older Ollama version?"
    info "FileScopeMCP will still work if Ollama is running"
fi

# Done
echo ""
echo -e "${GREEN}=== LLM Setup Complete ===${NC}"
echo ""
echo -e "  Ollama API:     ${CYAN}${OLLAMA_API}${NC}"
echo -e "  Custom model:   ${CYAN}${CUSTOM_MODEL}${NC}"
echo -e "  Base model:     ${CYAN}${BASE_MODEL}${NC}"
echo ""
echo -e "  FileScopeMCP auto-connects to the broker on startup."
echo -e "  LLM is enabled by default — no manual setup needed."
echo ""
echo -e "  ${CYAN}Other commands:${NC}"
echo -e "    ./setup-llm.sh --status              # Check setup status"
echo -e "    ollama list                           # List installed models"
echo -e "    ollama rm $CUSTOM_MODEL               # Remove custom model"
echo -e "    ollama rm $BASE_MODEL  # Remove base model"
echo ""
