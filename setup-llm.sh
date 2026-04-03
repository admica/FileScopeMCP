#!/bin/bash
# PATH: ./setup-llm.sh
# Installs Ollama, detects GPU VRAM, selects the best Gemma 4 model,
# and creates the custom FileScopeMCP-brain model.
# Safe to run multiple times — idempotent. Skips steps already completed.
#
# Usage:
#   ./setup-llm.sh                     # Auto-detect GPU + install
#   ./setup-llm.sh --model <name>      # Override base model (e.g., gemma4:e2b)
#   ./setup-llm.sh --status            # Check current setup status
#   ./setup-llm.sh --help              # Show usage

set -e

# --- Configuration ---
BASE_MODEL_FULL="gemma4:e4b"       # For GPUs with >= 12GB VRAM
BASE_MODEL_LITE="gemma4:e2b"       # For GPUs with < 12GB VRAM
VRAM_THRESHOLD_MB=12288            # 12 GB — E4B needs ~11GB with 32k context
CUSTOM_MODEL="FileScopeMCP-brain"
OLLAMA_API="http://localhost:11434"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Set by detect_vram / select_base_model
VRAM_MB=0
VRAM_SOURCE=""
GPU_NAME=""
BASE_MODEL=""
MODEL_OVERRIDE=""
EFFECTIVE_MODELFILE=""

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

# --- Cleanup ---
cleanup() {
    if [[ -n "${EFFECTIVE_MODELFILE:-}" ]] && \
       [[ "$EFFECTIVE_MODELFILE" != "${SCRIPT_DIR}/Modelfile" ]] && \
       [[ -f "$EFFECTIVE_MODELFILE" ]]; then
        rm -f "$EFFECTIVE_MODELFILE"
    fi
}
trap cleanup EXIT

# --- Argument parsing ---
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --status)
            STATUS_ONLY=true
            shift
            ;;
        --model)
            if [[ -z "${2:-}" ]]; then
                die "--model requires a value (e.g., --model gemma4:e2b)"
            fi
            MODEL_OVERRIDE="$2"
            shift 2
            ;;
        --help|-h)
            echo ""
            echo "Usage: ./setup-llm.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --model <name>   Override base model (skip auto-detection)"
            echo "                   Examples: gemma4:e4b, gemma4:e2b, qwen2.5-coder:7b"
            echo "  --status         Check Ollama/model/GPU status"
            echo "  --help           Show this help"
            echo ""
            echo "Auto-detection:"
            echo "  Without --model, the script detects your GPU VRAM and picks:"
            echo "    >= 12GB VRAM → $BASE_MODEL_FULL (better quality)"
            echo "    <  12GB VRAM → $BASE_MODEL_LITE (fits smaller GPUs)"
            echo ""
            echo "  Detection methods (tried in order):"
            echo "    NVIDIA:    nvidia-smi"
            echo "    AMD:       rocm-smi, sysfs"
            echo "    Intel Arc: xpu-smi"
            echo "    macOS:     sysctl (unified memory)"
            echo "    WSL:       nvidia-smi, PowerShell registry/WMI"
            echo ""
            echo "On WSL2: prints step-by-step instructions for setting up Ollama"
            echo "on Windows and configuring FileScopeMCP to connect from WSL."
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

# ============================================================================
# VRAM Detection — multi-vendor, multi-platform
# Sets: VRAM_MB (int, megabytes), VRAM_SOURCE (string), GPU_NAME (string)
# Returns 0 on success, 1 if detection failed
# ============================================================================
detect_vram() {
    VRAM_MB=0
    VRAM_SOURCE=""
    GPU_NAME=""

    # ---- NVIDIA: nvidia-smi (Linux native + WSL CUDA passthrough) ----
    if command -v nvidia-smi &>/dev/null; then
        local vram gpu
        # sort -rn: if multiple GPUs, pick the largest
        vram=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null \
            | sort -rn | head -1 | tr -d '[:space:]')
        gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | xargs)
        if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
            VRAM_MB=$vram
            VRAM_SOURCE="nvidia-smi"
            GPU_NAME="${gpu:-NVIDIA GPU}"
            return 0
        fi
    fi

    # ---- AMD: rocm-smi (Linux with ROCm drivers) ----
    if command -v rocm-smi &>/dev/null; then
        local vram_line vram_bytes
        # Match lines with "total" and "memory" but not "used"
        vram_line=$(rocm-smi --showmeminfo vram 2>/dev/null \
            | grep -iE "total.*memory|memory.*total" | grep -vi "used" | head -1)
        if [[ -n "$vram_line" ]]; then
            # Extract the last number on the line (the byte count)
            vram_bytes=$(echo "$vram_line" | grep -oE '[0-9]+' | tail -1)
            if [[ -n "$vram_bytes" ]] && [[ "$vram_bytes" =~ ^[0-9]+$ ]] && [[ "$vram_bytes" -gt 1000000 ]]; then
                VRAM_MB=$((vram_bytes / 1048576))
                VRAM_SOURCE="rocm-smi"
                GPU_NAME=$(rocm-smi --showproductname 2>/dev/null \
                    | grep -i "card series" | head -1 | sed 's/.*:[[:space:]]*//' || true)
                GPU_NAME="${GPU_NAME:-AMD GPU}"
                return 0
            fi
        fi
    fi

    # ---- AMD: sysfs fallback (Linux, no ROCm tools needed) ----
    local best_amd_vram=0 best_amd_card=""
    for card_dir in /sys/class/drm/card*/device; do
        [[ -d "$card_dir" ]] || continue
        [[ -f "$card_dir/vendor" ]] || continue
        local vendor
        vendor=$(cat "$card_dir/vendor" 2>/dev/null || true)
        if [[ "$vendor" == "0x1002" ]] && [[ -f "$card_dir/mem_info_vram_total" ]]; then
            local vb
            vb=$(cat "$card_dir/mem_info_vram_total" 2>/dev/null || true)
            if [[ -n "$vb" ]] && [[ "$vb" =~ ^[0-9]+$ ]]; then
                local mb=$((vb / 1048576))
                if [[ $mb -gt $best_amd_vram ]]; then
                    best_amd_vram=$mb
                    best_amd_card="$card_dir"
                fi
            fi
        fi
    done
    if [[ $best_amd_vram -gt 0 ]]; then
        VRAM_MB=$best_amd_vram
        VRAM_SOURCE="sysfs"
        # Try to read the product name
        if [[ -n "$best_amd_card" ]] && [[ -f "${best_amd_card%/device}/device/product_name" ]]; then
            GPU_NAME=$(cat "${best_amd_card%/device}/device/product_name" 2>/dev/null || true)
        fi
        GPU_NAME="${GPU_NAME:-AMD GPU}"
        return 0
    fi

    # ---- Intel Arc: xpu-smi (Linux with Intel GPU drivers) ----
    if command -v xpu-smi &>/dev/null; then
        local vram
        vram=$(xpu-smi discovery 2>/dev/null \
            | grep -i "memory physical" | head -1 | grep -oE '[0-9]+' | head -1)
        if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
            VRAM_MB=$vram
            VRAM_SOURCE="xpu-smi"
            local gpu
            gpu=$(xpu-smi discovery 2>/dev/null \
                | grep -i "device name" | head -1 | sed 's/.*:[[:space:]]*//')
            GPU_NAME="${gpu:-Intel Arc GPU}"
            return 0
        fi
    fi

    # ---- Intel: sysfs fallback (Linux, check for Intel discrete GPU) ----
    for card_dir in /sys/class/drm/card*/device; do
        [[ -d "$card_dir" ]] || continue
        [[ -f "$card_dir/vendor" ]] || continue
        local vendor
        vendor=$(cat "$card_dir/vendor" 2>/dev/null || true)
        # Intel vendor ID 0x8086 — but only discrete GPUs have mem_info_vram_total
        if [[ "$vendor" == "0x8086" ]] && [[ -f "$card_dir/mem_info_vram_total" ]]; then
            local vb
            vb=$(cat "$card_dir/mem_info_vram_total" 2>/dev/null || true)
            if [[ -n "$vb" ]] && [[ "$vb" =~ ^[0-9]+$ ]] && [[ $((vb / 1048576)) -gt 0 ]]; then
                VRAM_MB=$((vb / 1048576))
                VRAM_SOURCE="sysfs"
                GPU_NAME="Intel GPU"
                return 0
            fi
        fi
    done

    # ---- WSL: query Windows host via PowerShell ----
    if is_wsl && command -v powershell.exe &>/dev/null; then
        local gpu_name_ps=""
        # Try to get GPU name first (fast, tells us what we're working with)
        gpu_name_ps=$(powershell.exe -NoProfile -NonInteractive -Command \
            '(Get-CimInstance Win32_VideoController |
              Sort-Object AdapterRAM -Descending |
              Select-Object -First 1).Name' 2>/dev/null | tr -d '\r\n' || true)

        # Method 1: Registry HardwareInformation.qwMemorySize (64-bit, all vendors)
        local vram
        vram=$(powershell.exe -NoProfile -NonInteractive -Command '
            try {
                $items = Get-ItemProperty "HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*" -Name "HardwareInformation.qwMemorySize" -ErrorAction SilentlyContinue
                if ($items) {
                    ($items."HardwareInformation.qwMemorySize" | Measure-Object -Maximum).Maximum
                }
            } catch {}' 2>/dev/null | tr -d '\r\n ' || true)
        if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
            VRAM_MB=$((vram / 1048576))
            VRAM_SOURCE="registry"
            GPU_NAME="${gpu_name_ps:-Windows GPU}"
            return 0
        fi

        # Method 2: WMI AdapterRAM (32-bit field — overflows above 4GB on some drivers)
        vram=$(powershell.exe -NoProfile -NonInteractive -Command \
            '(Get-CimInstance Win32_VideoController |
              Sort-Object AdapterRAM -Descending |
              Select-Object -First 1).AdapterRAM' 2>/dev/null | tr -d '\r\n ' || true)
        if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
            VRAM_MB=$((vram / 1048576))
            VRAM_SOURCE="wmi"
            GPU_NAME="${gpu_name_ps:-Windows GPU}"
            # AdapterRAM is a 32-bit unsigned int — overflows to wrong values above 4GB
            if [[ $VRAM_MB -le 4096 ]] && [[ -n "$gpu_name_ps" ]]; then
                # Heuristic: if the GPU name suggests a high-end card but WMI says <= 4GB,
                # it's almost certainly a 32-bit overflow. Fall through to warn + safe default.
                if echo "$gpu_name_ps" | grep -qiE 'RTX|5060|5070|5080|5090|4060|4070|4080|4090|7900|7800|RX [67]'; then
                    warn "WMI reported ${VRAM_MB}MB but $gpu_name_ps likely has more (32-bit overflow)"
                    info "Override with: ./setup-llm.sh --model $BASE_MODEL_FULL"
                    VRAM_MB=0  # force unknown → safe default
                    return 1
                fi
            fi
            return 0
        fi

        # Method 3: nvidia-smi.exe on Windows (reachable from some WSL setups)
        if command -v nvidia-smi.exe &>/dev/null; then
            vram=$(nvidia-smi.exe --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null \
                | sort -rn | head -1 | tr -d '[:space:]')
            if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
                VRAM_MB=$vram
                VRAM_SOURCE="nvidia-smi.exe"
                local gpu
                gpu=$(nvidia-smi.exe --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | xargs)
                GPU_NAME="${gpu:-NVIDIA GPU}"
                return 0
            fi
        fi
    fi

    # ---- macOS: unified memory (Apple Silicon shares RAM with GPU) ----
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local mem_bytes
        mem_bytes=$(sysctl -n hw.memsize 2>/dev/null || true)
        if [[ -n "$mem_bytes" ]] && [[ "$mem_bytes" =~ ^[0-9]+$ ]] && [[ "$mem_bytes" -gt 0 ]]; then
            # Apple Silicon shares system RAM — report ~75% as usable for ML
            # (macOS reserves some for itself, WindowServer, etc.)
            local total_mb=$((mem_bytes / 1048576))
            VRAM_MB=$(( total_mb * 3 / 4 ))
            VRAM_SOURCE="sysctl (unified memory, ~75% of ${total_mb}MB)"
            # Try to identify the chip
            local chip
            chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)
            GPU_NAME="${chip:-Apple Silicon}"
            return 0
        fi
    fi

    return 1
}

# ============================================================================
# Model Selection — pick base model from VRAM, or use override
# Sets: BASE_MODEL (string)
# ============================================================================
select_base_model() {
    echo ""

    if [[ -n "$MODEL_OVERRIDE" ]]; then
        BASE_MODEL="$MODEL_OVERRIDE"
        ok "Using override model: $BASE_MODEL"
        return 0
    fi

    info "Detecting GPU and VRAM..."

    if detect_vram; then
        local vram_gb=$((VRAM_MB / 1024))
        if [[ $VRAM_MB -ge $VRAM_THRESHOLD_MB ]]; then
            BASE_MODEL="$BASE_MODEL_FULL"
            ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
            ok "Auto-selected: ${CYAN}${BASE_MODEL}${NC} (full model)"
        else
            BASE_MODEL="$BASE_MODEL_LITE"
            ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
            ok "Auto-selected: ${CYAN}${BASE_MODEL}${NC} (lite model for <$((VRAM_THRESHOLD_MB / 1024))GB VRAM)"
            info "Override: ./setup-llm.sh --model $BASE_MODEL_FULL"
        fi
    else
        BASE_MODEL="$BASE_MODEL_LITE"
        warn "Could not detect GPU VRAM"
        warn "Defaulting to: $BASE_MODEL (safe for most hardware)"
        info "Override: ./setup-llm.sh --model $BASE_MODEL_FULL"
    fi
}

# ============================================================================
# Modelfile Preparation — patch FROM line if base model differs from file
# Sets: EFFECTIVE_MODELFILE (path to Modelfile to use for ollama create)
# ============================================================================
prepare_modelfile() {
    local src="${SCRIPT_DIR}/Modelfile"
    [[ -f "$src" ]] || die "Modelfile not found at $src"

    local current_from
    current_from=$(awk '/^FROM /{print $2; exit}' "$src")

    if [[ "$current_from" == "$BASE_MODEL" ]]; then
        EFFECTIVE_MODELFILE="$src"
    else
        EFFECTIVE_MODELFILE=$(mktemp "${TMPDIR:-/tmp}/Modelfile.XXXXXX")
        sed "s|^FROM .*|FROM ${BASE_MODEL}|" "$src" > "$EFFECTIVE_MODELFILE"
        info "Patched Modelfile: FROM $current_from → FROM $BASE_MODEL"
    fi
}

# ============================================================================
# Ollama helpers
# ============================================================================
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

# ============================================================================
# WSL Guide — prints setup instructions, exits
# ============================================================================
wsl_guide() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  WSL2 detected — Ollama should be installed on Windows, not here${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  WSL2 cannot directly access your GPU for Ollama. Install and run"
    echo -e "  Ollama natively on Windows so it can use your GPU, then configure"
    echo -e "  FileScopeMCP to connect across the WSL network boundary."

    # Detect VRAM from WSL to recommend the right model
    info "Detecting Windows GPU..."
    if detect_vram; then
        local vram_gb=$((VRAM_MB / 1024))
        ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
        if [[ $VRAM_MB -ge $VRAM_THRESHOLD_MB ]]; then
            BASE_MODEL="$BASE_MODEL_FULL"
            ok "Recommended model: ${CYAN}${BASE_MODEL}${NC} (full)"
        else
            BASE_MODEL="$BASE_MODEL_LITE"
            ok "Recommended model: ${CYAN}${BASE_MODEL}${NC} (lite for ${vram_gb}GB VRAM)"
            info "Override: ./setup-llm.sh --model $BASE_MODEL_FULL"
        fi
    else
        if [[ -n "$MODEL_OVERRIDE" ]]; then
            BASE_MODEL="$MODEL_OVERRIDE"
            ok "Using override model: $BASE_MODEL"
        else
            BASE_MODEL="$BASE_MODEL_LITE"
            warn "Could not detect Windows GPU VRAM"
            warn "Defaulting to: $BASE_MODEL (safe for most hardware)"
            info "Override: ./setup-llm.sh --model $BASE_MODEL_FULL"
        fi
    fi

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
    if [[ "$BASE_MODEL" != "$(awk '/^FROM /{print $2; exit}' "${SCRIPT_DIR}/Modelfile" 2>/dev/null)" ]]; then
        # Need to patch the Modelfile for the lite model
        echo -e "     ${CYAN}sed 's|^FROM .*|FROM ${BASE_MODEL}|' ${SCRIPT_DIR}/Modelfile > /tmp/Modelfile.patched${NC}"
        echo -e "     ${CYAN}cp /tmp/Modelfile.patched /mnt/c/Users/${WINDOWS_USER}/Modelfile${NC}"
    else
        echo -e "     ${CYAN}cp ${SCRIPT_DIR}/Modelfile /mnt/c/Users/${WINDOWS_USER}/Modelfile${NC}"
    fi
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

# ============================================================================
# Status — show current setup state
# ============================================================================
show_status() {
    echo ""
    echo -e "${GREEN}=== FileScopeMCP LLM Setup Status ===${NC}"
    echo ""

    # GPU / VRAM
    info "GPU detection..."
    if detect_vram; then
        local vram_gb=$((VRAM_MB / 1024))
        ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
        if [[ $VRAM_MB -ge $VRAM_THRESHOLD_MB ]]; then
            info "  Recommended model: $BASE_MODEL_FULL (full)"
        else
            info "  Recommended model: $BASE_MODEL_LITE (lite for <$((VRAM_THRESHOLD_MB / 1024))GB)"
        fi
    else
        warn "Could not detect GPU VRAM"
    fi

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

    # Model available?
    if curl -sf "${api_url}/api/tags" &>/dev/null; then
        echo ""
        info "Installed models:"
        curl -sf "${api_url}/api/tags" 2>/dev/null | \
            grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' | \
            while read -r m; do
                if [[ "$m" == "$CUSTOM_MODEL" ]] || [[ "$m" == "${CUSTOM_MODEL}:latest" ]]; then
                    echo -e "    ${GREEN}* $m (FileScopeMCP)${NC}"
                elif [[ "$m" == "$BASE_MODEL_FULL" ]] || [[ "$m" == "${BASE_MODEL_FULL}:latest" ]] || \
                     [[ "$m" == "$BASE_MODEL_LITE" ]] || [[ "$m" == "${BASE_MODEL_LITE}:latest" ]]; then
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

    # Modelfile FROM check
    echo ""
    local modelfile_from
    modelfile_from=$(awk '/^FROM /{print $2; exit}' "${SCRIPT_DIR}/Modelfile" 2>/dev/null || echo "?")
    info "Modelfile base: $modelfile_from"

    echo ""
}

# ============================================================================
# Status-only mode
# ============================================================================
if $STATUS_ONLY; then
    show_status
    exit 0
fi

# ============================================================================
# WSL check — print guide and exit
# ============================================================================
if is_wsl; then
    wsl_guide
    exit 0
fi

# ============================================================================
# Main install flow (Linux / macOS native)
# ============================================================================
echo ""
echo -e "${GREEN}=== FileScopeMCP LLM Setup ===${NC}"

# Step 1: Detect GPU VRAM + select model
select_base_model

echo ""
echo -e "  Base model:   ${CYAN}${BASE_MODEL}${NC}"
echo -e "  Custom model: ${CYAN}${CUSTOM_MODEL}${NC}"
echo ""

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
prepare_modelfile

if check_model_available "$CUSTOM_MODEL"; then
    ok "Custom model '$CUSTOM_MODEL' already exists"
    info "To rebuild: ollama rm $CUSTOM_MODEL && ./setup-llm.sh"
else
    info "Creating custom model '$CUSTOM_MODEL' from Modelfile..."
    ollama create "$CUSTOM_MODEL" -f "$EFFECTIVE_MODELFILE"

    if check_model_available "$CUSTOM_MODEL"; then
        ok "Custom model '$CUSTOM_MODEL' created"
    else
        die "Failed to create custom model. Try: ollama create $CUSTOM_MODEL -f $EFFECTIVE_MODELFILE"
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
echo -e "  GPU:            ${CYAN}${GPU_NAME:-unknown}${NC}"
if [[ $VRAM_MB -gt 0 ]]; then
    echo -e "  VRAM:           ${CYAN}$((VRAM_MB / 1024))GB${NC} (detected via ${VRAM_SOURCE})"
fi
echo -e "  Ollama API:     ${CYAN}${OLLAMA_API}${NC}"
echo -e "  Base model:     ${CYAN}${BASE_MODEL}${NC}"
echo -e "  Custom model:   ${CYAN}${CUSTOM_MODEL}${NC}"
echo ""
echo -e "  FileScopeMCP auto-connects to the broker on startup."
echo -e "  LLM is enabled by default — no manual setup needed."
echo ""
echo -e "  ${CYAN}Other commands:${NC}"
echo -e "    ./setup-llm.sh --status              # Check setup status"
echo -e "    ./setup-llm.sh --model gemma4:e4b    # Force a specific model"
echo -e "    ollama list                           # List installed models"
echo -e "    ollama rm $CUSTOM_MODEL               # Remove custom model"
echo -e "    ollama rm $BASE_MODEL                 # Remove base model"
echo ""
