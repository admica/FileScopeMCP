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
DEFAULT_MODEL="qwen2.5-coder:14b"
OLLAMA_API="http://localhost:11434"

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
MODEL="$DEFAULT_MODEL"
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --model)
            MODEL="$2"
            shift 2
            ;;
        --status)
            STATUS_ONLY=true
            shift
            ;;
        --help|-h)
            echo ""
            echo "Usage: ./setup-llm.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --model <name>   Model to pull (default: $DEFAULT_MODEL)"
            echo "  --status         Check current Ollama/model status without installing"
            echo "  --help           Show this help"
            echo ""
            echo "Examples:"
            echo "  ./setup-llm.sh                                    # Default setup"
            echo "  ./setup-llm.sh --model llama3.1:8b                # Smaller model"
            echo "  ./setup-llm.sh --model qwen2.5-coder:14b          # Default model (explicit)"
            echo ""
            exit 0
            ;;
        *)
            die "Unknown option: $1 (try --help)"
            ;;
    esac
done

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
    curl -sf "${OLLAMA_API}/api/tags" 2>/dev/null | grep -q "\"${model_name}\""
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

    # Ollama installed?
    if check_ollama_installed; then
        OLLAMA_VER=$(ollama --version 2>/dev/null || echo "unknown")
        ok "Ollama installed: $OLLAMA_VER"
    else
        fail "Ollama not installed"
    fi

    # Ollama running?
    if check_ollama_running; then
        ok "Ollama API responding at ${OLLAMA_API}"
    else
        fail "Ollama not running at ${OLLAMA_API}"
    fi

    # GPU?
    detect_gpu

    # Model available?
    if check_ollama_running; then
        echo ""
        info "Installed models:"
        curl -sf "${OLLAMA_API}/api/tags" 2>/dev/null | \
            grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | \
            while read -r m; do
                if [[ "$m" == "$MODEL" ]]; then
                    echo -e "    ${GREEN}* $m (default)${NC}"
                else
                    echo -e "    ${CYAN}  $m${NC}"
                fi
            done

        if ! check_model_available "$MODEL"; then
            echo ""
            warn "Default model '$MODEL' not pulled yet"
        fi
    fi

    echo ""
}

# --- Status-only mode ---
if $STATUS_ONLY; then
    show_status
    exit 0
fi

# --- Main install flow ---
echo ""
echo -e "${GREEN}=== FileScopeMCP LLM Setup ===${NC}"
echo ""
echo -e "  Model: ${CYAN}${MODEL}${NC}"
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

# Step 4: Pull model
echo ""
if check_model_available "$MODEL"; then
    ok "Model '$MODEL' already available"
else
    info "Pulling model '$MODEL'... (this may take several minutes on first run)"
    echo ""
    ollama pull "$MODEL"

    if check_model_available "$MODEL"; then
        echo ""
        ok "Model '$MODEL' ready"
    else
        die "Failed to pull model '$MODEL'. Check your internet connection and try: ollama pull $MODEL"
    fi
fi

# Step 5: Verify end-to-end
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
echo -e "  Ollama API:  ${CYAN}${OLLAMA_API}${NC}"
echo -e "  Model:       ${CYAN}${MODEL}${NC}"
echo ""
echo -e "  ${CYAN}To use in FileScopeMCP:${NC}"
echo -e "    1. Start a Claude Code session"
echo -e "    2. set_project_path(path: \"/your/project\")"
echo -e "    3. toggle_llm(enabled: true)"
echo ""
echo -e "  ${CYAN}Other commands:${NC}"
echo -e "    ./setup-llm.sh --status              # Check setup status"
echo -e "    ollama list                           # List installed models"
echo -e "    ollama pull <model>                   # Pull additional models"
echo -e "    ollama rm <model>                     # Remove a model"
echo ""
