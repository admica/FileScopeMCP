#!/bin/bash
# PATH: ./setup-llm.sh
# Configures llama.cpp's llama-server as FileScopeMCP's local LLM backend.
#
# Default model: Gemma 4 26B A4B MoE (Unsloth UD-Q5_K_S, ~18GB on disk).
# Uses llama.cpp's expert offloading (--n-cpu-moe) to keep attention +
# shared-expert weights on GPU while routed expert FFNs live in system RAM /
# mmap'd from the GGUF file on disk. This lets the 26B MoE run on 16GB VRAM,
# paying the cost only for the ~3.8B active parameters per token (8 routed +
# 1 shared expert of 128 total). Default --n-cpu-moe 20 is tuned for 16GB
# VRAM (RX 7900 XT: ~13.3/16.0 GB used, 305-420 t/s prompt eval,
# 18-19 t/s gen). Raise to 99 if OOM; lower for more speed with VRAM headroom.
#
# Usage:
#   ./setup-llm.sh                     # Print setup guide for your platform
#   ./setup-llm.sh --launch            # Print the exact llama-server launch command
#   ./setup-llm.sh --model <hf-ref>    # Override model HF reference
#   ./setup-llm.sh --status            # Check current setup state
#   ./setup-llm.sh --help              # Show usage
#
# Known-good alternative model (if Gemma 4 throughput is insufficient):
#   --model unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:UD-Q4_K_XL

set -e

# --- Configuration ---
MODEL_HF_REF_DEFAULT="unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S"
MODEL_ALIAS="FileScopeMCP-brain"    # matches broker.*.json model field
LLM_PORT=8880
CONTEXT_SIZE=32768                   # 32K — fits in ~3-4GB q8_0 KV cache with --n-cpu-moe freeing VRAM
VRAM_SOFT_MIN_MB=8192                # warn if VRAM < 8GB (not a hard gate)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MODEL_HF_REF="$MODEL_HF_REF_DEFAULT"
VRAM_MB=0
VRAM_SOURCE=""
GPU_NAME=""
STATUS_ONLY=false
LAUNCH_ONLY=false

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
while [[ $# -gt 0 ]]; do
    case "$1" in
        --status)
            STATUS_ONLY=true
            shift
            ;;
        --launch)
            LAUNCH_ONLY=true
            shift
            ;;
        --model)
            if [[ -z "${2:-}" ]]; then
                die "--model requires a HuggingFace reference (e.g. unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S)"
            fi
            MODEL_HF_REF="$2"
            shift 2
            ;;
        --help|-h)
            cat <<EOF

Usage: ./setup-llm.sh [OPTIONS]

Options:
  --launch          Print the exact llama-server launch command to stdout
  --model <ref>     Override the HuggingFace GGUF reference
                    Default: $MODEL_HF_REF_DEFAULT
                    Alternative: unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:UD-Q4_K_XL
  --status          Check llama-server reachability and broker config
  --help, -h        Show this help

Architecture:
  - Default model is Gemma 4 26B A4B: 26B total params, ~3.8B active per token
    (8 routed + 1 shared expert out of 128), ideal for 16GB VRAM via expert
    offloading to CPU RAM.
  - llama.cpp's -hf flag auto-downloads the GGUF on first run into \$LLAMA_CACHE.
  - --n-cpu-moe N keeps routed experts of N layers in system RAM (default 20 tuned
    for 16GB VRAM; raise to 99 on lower-VRAM GPUs); --no-warmup skips the
    startup dummy inference so cold experts stay paged-out (mmap is on by default)
    until they're actually routed to.
  - --alias $MODEL_ALIAS makes the broker config (broker.*.json) work unchanged.

On WSL2: this script prints Windows-side setup instructions, since llama-server
needs native GPU access and the broker already bridges to a Windows host via
broker.windows-host.json (using the 'wsl-host' placeholder).

EOF
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
# VRAM Detection — informational only (no model gating)
# Sets: VRAM_MB, VRAM_SOURCE, GPU_NAME
# Returns 0 on success, 1 if detection failed
# ============================================================================
detect_vram() {
    VRAM_MB=0
    VRAM_SOURCE=""
    GPU_NAME=""

    # ---- NVIDIA: nvidia-smi ----
    if command -v nvidia-smi &>/dev/null; then
        local vram gpu
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

    # ---- AMD: rocm-smi ----
    if command -v rocm-smi &>/dev/null; then
        local vram_line vram_bytes
        vram_line=$(rocm-smi --showmeminfo vram 2>/dev/null \
            | grep -iE "total.*memory|memory.*total" | grep -vi "used" | head -1)
        if [[ -n "$vram_line" ]]; then
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

    # ---- AMD: sysfs fallback ----
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
        if [[ -n "$best_amd_card" ]] && [[ -f "${best_amd_card%/device}/device/product_name" ]]; then
            GPU_NAME=$(cat "${best_amd_card%/device}/device/product_name" 2>/dev/null || true)
        fi
        GPU_NAME="${GPU_NAME:-AMD GPU}"
        return 0
    fi

    # ---- Intel Arc ----
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

    # ---- Intel: sysfs fallback ----
    for card_dir in /sys/class/drm/card*/device; do
        [[ -d "$card_dir" ]] || continue
        [[ -f "$card_dir/vendor" ]] || continue
        local vendor
        vendor=$(cat "$card_dir/vendor" 2>/dev/null || true)
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
        gpu_name_ps=$(powershell.exe -NoProfile -NonInteractive -Command \
            '(Get-CimInstance Win32_VideoController |
              Sort-Object AdapterRAM -Descending |
              Select-Object -First 1).Name' 2>/dev/null | tr -d '\r\n' || true)

        # Registry HardwareInformation.qwMemorySize (64-bit, all vendors)
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

        # WMI AdapterRAM fallback (32-bit overflow above 4GB)
        vram=$(powershell.exe -NoProfile -NonInteractive -Command \
            '(Get-CimInstance Win32_VideoController |
              Sort-Object AdapterRAM -Descending |
              Select-Object -First 1).AdapterRAM' 2>/dev/null | tr -d '\r\n ' || true)
        if [[ -n "$vram" ]] && [[ "$vram" =~ ^[0-9]+$ ]] && [[ "$vram" -gt 0 ]]; then
            VRAM_MB=$((vram / 1048576))
            VRAM_SOURCE="wmi"
            GPU_NAME="${gpu_name_ps:-Windows GPU}"
            if [[ $VRAM_MB -le 4096 ]] && [[ -n "$gpu_name_ps" ]]; then
                if echo "$gpu_name_ps" | grep -qiE 'RTX|5060|5070|5080|5090|4060|4070|4080|4090|7900|7800|RX [67]'; then
                    warn "WMI reported ${VRAM_MB}MB but $gpu_name_ps likely has more (32-bit overflow)"
                    VRAM_MB=0
                    return 1
                fi
            fi
            return 0
        fi

        # nvidia-smi.exe fallback
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

    # ---- macOS: unified memory ----
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local mem_bytes
        mem_bytes=$(sysctl -n hw.memsize 2>/dev/null || true)
        if [[ -n "$mem_bytes" ]] && [[ "$mem_bytes" =~ ^[0-9]+$ ]] && [[ "$mem_bytes" -gt 0 ]]; then
            local total_mb=$((mem_bytes / 1048576))
            VRAM_MB=$(( total_mb * 3 / 4 ))
            VRAM_SOURCE="sysctl (unified memory, ~75% of ${total_mb}MB)"
            local chip
            chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)
            GPU_NAME="${chip:-Apple Silicon}"
            return 0
        fi
    fi

    return 1
}

# ============================================================================
# Launch command — the one-liner every path converges on
# ============================================================================
print_launch_command() {
    cat <<EOF
llama-server \\
  -hf $MODEL_HF_REF \\
  --alias $MODEL_ALIAS \\
  -c $CONTEXT_SIZE \\
  -ngl 99 \\
  --n-cpu-moe 20 \\
  -fa on \\
  -b 2048 -ub 2048 \\
  --cache-type-k q8_0 --cache-type-v q8_0 \\
  --jinja \\
  --no-warmup \\
  --host 0.0.0.0 --port $LLM_PORT \\
  --metrics
EOF
}

print_vram_advice() {
    if [[ $VRAM_MB -gt 0 ]]; then
        local vram_gb=$((VRAM_MB / 1024))
        if [[ $VRAM_MB -lt $VRAM_SOFT_MIN_MB ]]; then
            warn "${vram_gb}GB VRAM is below the ${VRAM_SOFT_MIN_MB}MB soft minimum"
            info "  You may need to lower -c (context) or use a smaller quant"
        else
            ok "${vram_gb}GB VRAM — should handle the default config comfortably"
        fi
    fi
}

# ============================================================================
# WSL → Windows setup guide
# ============================================================================
wsl_guide() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  WSL2 detected — llama.cpp runs on Windows, FileScopeMCP connects${NC}"
    echo -e "${YELLOW}  from WSL2${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  llama-server needs native GPU access, which WSL2 does not fully"
    echo -e "  provide. The broker already bridges to a Windows host via"
    echo -e "  broker.windows-host.json — we'll reuse that."
    echo ""

    info "Detecting Windows GPU..."
    if detect_vram; then
        local vram_gb=$((VRAM_MB / 1024))
        ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
        print_vram_advice
    else
        warn "Could not detect Windows GPU VRAM (not a blocker — proceed anyway)"
    fi

    # Vendor branching for the prebuilt binary choice.
    local gpu_vendor="unknown"
    local zip_name="llama-b8794-bin-win-vulkan-x64.zip"
    local zip_label="Vulkan build (fallback for unknown GPU)"
    if echo "$GPU_NAME" | grep -qiE 'radeon|amd|rx [0-9]'; then
        gpu_vendor="amd"
        zip_name="llama-b8794-bin-win-vulkan-x64.zip"
        zip_label="Vulkan build (AMD — RDNA2/RDNA3)"
        ok "AMD RDNA2/RDNA3 detected — using Vulkan backend (NOT ROCm)"
        warn "ROCm on Windows is broken for llama.cpp since build b8152 (Issue #19943)."
        warn "Use Vulkan — it is also 0-50% faster than ROCm on RDNA2 for MoE models."
    elif echo "$GPU_NAME" | grep -qiE 'nvidia|rtx|gtx|geforce'; then
        gpu_vendor="nvidia"
        zip_name="llama-b8794-bin-win-cuda-12.X-x64.zip"
        zip_label="CUDA 12 build (NVIDIA)"
    elif echo "$GPU_NAME" | grep -qi 'intel'; then
        gpu_vendor="intel"
        zip_name="llama-b8794-bin-win-vulkan-x64.zip"
        zip_label="Vulkan build (Intel Arc)"
    fi

    echo ""
    echo -e "  ${GREEN}On Windows:${NC}"
    echo ""
    echo -e "  1. Download the llama.cpp Windows release:"
    echo -e "     ${CYAN}https://github.com/ggml-org/llama.cpp/releases${NC}"
    echo ""
    echo -e "     Pick: ${YELLOW}${zip_label}${NC}"
    echo -e "     File: ${CYAN}${zip_name}${NC}"
    echo -e "     (${CYAN}b8794${NC} is the validated build. Newer builds should work but are untested — grab it from the releases page if b8794 is gone.)"
    if [[ "$gpu_vendor" == "nvidia" ]]; then
        echo -e "     The CUDA 12 toolkit is NOT required for the prebuilt binary."
    fi
    echo ""
    echo -e "  2. Extract the zip to ${CYAN}C:\\llama.cpp${NC}"
    echo -e "     Right-click → ${CYAN}Extract All${NC} → enter ${CYAN}C:\\llama.cpp${NC}"
    echo ""
    echo -e "     ${CYAN}Get-ChildItem -Recurse -Filter llama-server.exe C:\\llama.cpp${NC}"
    echo ""
    echo -e "  3. Add a Windows Firewall rule to allow inbound TCP on port $LLM_PORT."
    echo -e "     In ${CYAN}PowerShell (Admin)${NC}:"
    echo ""
    echo -e "     ${CYAN}New-NetFirewallRule -DisplayName 'llama-server $LLM_PORT' \`"
    echo -e "       -Direction Inbound -Action Allow -Protocol TCP -LocalPort $LLM_PORT${NC}"
    echo ""
    echo -e "     This rule should cover Private and Public profiles if your WSL2"
    echo -e "     interface is on a Public profile (usually it is Private)."
    echo ""
    echo -e "  4. Launch llama-server."
    echo ""
    echo -e "     ${YELLOW}IMPORTANT:${NC} ${YELLOW}cd into the folder that contains llama-server.exe${NC}"
    echo -e "     before running it. PowerShell will not find the executable"
    echo -e "     otherwise — it is not on PATH."
    echo ""
    echo -e "     In ${CYAN}PowerShell${NC} (adjust the path to match step 2):"
    echo ""
    echo -e "     ${CYAN}cd C:\\llama.cpp${NC}   ${YELLOW}# or the nested subfolder from step 2${NC}"
    echo ""
    echo -e "     ${CYAN}.\\llama-server.exe \`"
    echo -e "         -hf $MODEL_HF_REF \`"
    echo -e "         --alias $MODEL_ALIAS \`"
    echo -e "         -c $CONTEXT_SIZE \`"
    echo -e "         -ngl 99 \`"
    echo -e "         --n-cpu-moe 20 \`"
    echo -e "         -fa on \`"
    echo -e "         -b 2048 -ub 2048 \`"
    echo -e "         --cache-type-k q8_0 --cache-type-v q8_0 \`"
    echo -e "         --jinja \`"
    echo -e "         --no-warmup \`"
    echo -e "         --host 0.0.0.0 --port $LLM_PORT \`"
    echo -e "         --metrics${NC}"
    echo ""
    echo -e "     First run downloads the GGUF (~18GB) into ${CYAN}\$env:LLAMA_CACHE${NC}"
    echo -e "     or the default llama.cpp cache dir. Subsequent runs start instantly."
    echo ""
    echo -e "     If PowerShell reports ${RED}'llama-server.exe is not recognized'${NC},"
    echo -e "     you are not in the right folder. Re-run step 2's Get-ChildItem"
    echo -e "     command and cd to wherever it lists the exe."
    echo ""
    echo -e "  ${GREEN}Back in WSL:${NC}"
    echo ""
    echo -e "  5. Install the WSL-host broker config:"
    echo ""
    echo -e "     ${CYAN}mkdir -p ~/.filescope${NC}"
    echo -e "     ${CYAN}cp ${SCRIPT_DIR}/broker.windows-host.json ~/.filescope/broker.json${NC}"
    echo ""
    echo -e "     The 'wsl-host' placeholder in broker.windows-host.json is"
    echo -e "     auto-resolved by the broker at startup (src/broker/config.ts"
    echo -e "     runs 'ip route show default' to find the Windows host IP)."
    echo -e "     No manual editing required."
    echo ""
    GATEWAY_IP=$(ip route show default 2>/dev/null | awk '{print $3}')
    echo -e "  6. Verify the connection:"
    echo ""
    if [[ -n "$GATEWAY_IP" ]]; then
        echo -e "     ${CYAN}curl http://${GATEWAY_IP}:${LLM_PORT}/v1/models${NC}"
        echo -e "     (Windows host IP: ${GREEN}${GATEWAY_IP}${NC})"
    else
        echo -e "     ${CYAN}curl http://\$(ip route show default | awk '{print \$3}'):${LLM_PORT}/v1/models${NC}"
    fi
    echo ""
    echo -e "     You should see a JSON response listing ${GREEN}${MODEL_ALIAS}${NC}"
    echo -e "     in the ${CYAN}data[].id${NC} field."
    echo ""
    echo -e "  7. Restart Claude Code, then verify the full pipeline:"
    echo ""
    echo -e "     ${CYAN}./setup-llm.sh --status${NC}"
    echo ""
    echo -e "  ${YELLOW}If curl fails:${NC}"
    echo -e "    - Is the firewall rule active? (Test with ${CYAN}Test-NetConnection${NC} from another Windows host)"
    echo -e "    - Is it listening on 0.0.0.0:$LLM_PORT (not 127.0.0.1)? Check with ${CYAN}netstat -an | findstr $LLM_PORT${NC}"
    echo -e "    - Is the GGUF done downloading?"
    echo ""
}

# ============================================================================
# Native Linux guide
# ============================================================================
linux_guide() {
    echo ""
    echo -e "${GREEN}=== FileScopeMCP LLM Setup (Native Linux) ===${NC}"
    echo ""

    info "Detecting GPU..."
    if detect_vram; then
        local vram_gb=$((VRAM_MB / 1024))
        ok "$GPU_NAME — ${vram_gb}GB VRAM (via $VRAM_SOURCE)"
        print_vram_advice
    else
        warn "Could not detect GPU VRAM — proceeding anyway"
    fi

    echo ""
    echo -e "  ${GREEN}Install llama.cpp:${NC}"
    echo ""
    echo -e "  ${CYAN}Option A (recommended): build from source with CUDA${NC}"
    echo -e "    ${CYAN}git clone https://github.com/ggml-org/llama.cpp${NC}"
    echo -e "    ${CYAN}cd llama.cpp${NC}"
    echo -e "    ${CYAN}cmake -B build -DGGML_CUDA=ON${NC}"
    echo -e "    ${CYAN}cmake --build build --config Release -j${NC}"
    echo -e "    Binary: ${CYAN}./build/bin/llama-server${NC}"
    echo ""
    echo -e "  ${CYAN}Option B: Docker (CUDA)${NC}"
    echo -e "    ${CYAN}docker run --gpus all -p ${LLM_PORT}:${LLM_PORT} \\${NC}"
    echo -e "    ${CYAN}  -v \$HOME/.cache/llama.cpp:/root/.cache/llama.cpp \\${NC}"
    echo -e "    ${CYAN}  ghcr.io/ggml-org/llama.cpp:server-cuda \\${NC}"
    echo -e "    ${CYAN}  -hf $MODEL_HF_REF \\${NC}"
    echo -e "    ${CYAN}  --alias $MODEL_ALIAS -c $CONTEXT_SIZE -ngl 99 --n-cpu-moe 20 \\${NC}"
    echo -e "    ${CYAN}  -b 2048 -ub 2048 -fa on --jinja --host 0.0.0.0 --port $LLM_PORT${NC}"
    echo ""
    echo -e "  ${GREEN}Launch llama-server (same command for both options):${NC}"
    echo ""
    print_launch_command
    echo ""
    echo -e "  ${GREEN}Verify + configure broker:${NC}"
    echo ""
    echo -e "    ${CYAN}curl http://localhost:${LLM_PORT}/v1/models${NC}"
    echo -e "    ${CYAN}mkdir -p ~/.filescope${NC}"
    echo ""
    echo -e "    The broker will auto-copy ${CYAN}broker.default.json${NC} to"
    echo -e "    ${CYAN}~/.filescope/broker.json${NC} on first launch."
    echo ""
    echo -e "  ${GREEN}Run as a systemd service (optional):${NC}"
    echo ""
    echo -e "    Create ${CYAN}/etc/systemd/system/llama-server.service${NC}:"
    echo ""
    cat <<EOF
    [Unit]
    Description=llama.cpp server for FileScopeMCP
    After=network.target

    [Service]
    Type=simple
    User=$USER
    Environment="CUDA_VISIBLE_DEVICES=0"
    ExecStart=/path/to/llama-server \\
      -hf $MODEL_HF_REF \\
      --alias $MODEL_ALIAS \\
      -c $CONTEXT_SIZE -ngl 99 --n-cpu-moe 20 -fa on \\
      -b 2048 -ub 2048 \\
      --cache-type-k q8_0 --cache-type-v q8_0 \\
      --jinja --no-warmup \\
      --host 0.0.0.0 --port $LLM_PORT --metrics
    Restart=on-failure
    RestartSec=5s

    [Install]
    WantedBy=multi-user.target
EOF
    echo ""
    echo -e "    ${CYAN}sudo systemctl daemon-reload${NC}"
    echo -e "    ${CYAN}sudo systemctl enable --now llama-server${NC}"
    echo ""
}

# ============================================================================
# macOS guide
# ============================================================================
macos_guide() {
    echo ""
    echo -e "${GREEN}=== FileScopeMCP LLM Setup (macOS) ===${NC}"
    echo ""

    if detect_vram; then
        ok "$GPU_NAME — $((VRAM_MB / 1024))GB unified memory (via $VRAM_SOURCE)"
    fi

    echo ""
    echo -e "  ${GREEN}Install llama.cpp (Metal backend is default):${NC}"
    echo ""
    if command -v brew &>/dev/null; then
        echo -e "    ${CYAN}brew install llama.cpp${NC}"
    else
        echo -e "    Install Homebrew first: ${CYAN}https://brew.sh${NC}"
        echo -e "    Then: ${CYAN}brew install llama.cpp${NC}"
    fi
    echo ""
    echo -e "  ${GREEN}Launch llama-server:${NC}"
    echo ""
    print_launch_command
    echo ""
    echo -e "  Broker will auto-copy ${CYAN}broker.default.json${NC} to ${CYAN}~/.filescope/broker.json${NC}"
    echo -e "  on first launch."
    echo ""
}

# ============================================================================
# Status — check llama-server reachability + broker config
# ============================================================================
show_status() {
    echo ""
    echo -e "${GREEN}=== FileScopeMCP LLM Setup Status ===${NC}"
    echo ""

    # GPU / VRAM
    info "GPU detection..."
    if detect_vram; then
        ok "$GPU_NAME — $((VRAM_MB / 1024))GB VRAM (via $VRAM_SOURCE)"
        print_vram_advice
    else
        warn "Could not detect GPU VRAM"
    fi

    # Determine expected llama-server URL
    local api_url="http://localhost:${LLM_PORT}"
    local env_label="local"
    if is_wsl; then
        local host_ip
        host_ip=$(ip route show default 2>/dev/null | awk '{print $3}')
        if [[ -n "$host_ip" ]]; then
            api_url="http://${host_ip}:${LLM_PORT}"
            env_label="WSL → Windows host (${host_ip})"
        fi
    fi

    echo ""
    info "Checking llama-server (${env_label})..."
    if curl -sf "${api_url}/v1/models" >/dev/null 2>&1; then
        ok "llama-server reachable at ${api_url}"
        local models
        models=$(curl -sf "${api_url}/v1/models" 2>/dev/null | \
            grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//')
        if [[ -n "$models" ]]; then
            info "  Served model IDs:"
            while read -r m; do
                if [[ "$m" == "$MODEL_ALIAS" ]]; then
                    echo -e "    ${GREEN}* $m (expected by broker)${NC}"
                else
                    echo -e "    ${CYAN}  $m${NC}"
                fi
            done <<< "$models"

            if ! echo "$models" | grep -q "^${MODEL_ALIAS}$"; then
                warn "llama-server is not serving '${MODEL_ALIAS}'"
                info "  Add ${CYAN}--alias $MODEL_ALIAS${NC} to the llama-server launch command"
            fi
        fi
    else
        fail "llama-server NOT reachable at ${api_url}"
        echo ""
        info "Troubleshooting:"
        info "  1. Is llama-server running on the target host?"
        info "  2. Is it bound to 0.0.0.0 (not 127.0.0.1)?"
        info "  3. If WSL2: is the Windows firewall allowing port $LLM_PORT?"
        info "  4. Run ./setup-llm.sh without --status for the full setup guide"
    fi

    # Broker config
    echo ""
    if [[ -f "$HOME/.filescope/broker.json" ]]; then
        local broker_url
        broker_url=$(grep -o '"baseURL"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.filescope/broker.json" \
            | sed 's/.*"baseURL"[[:space:]]*:[[:space:]]*"//;s/"//')
        ok "Broker config: ~/.filescope/broker.json"
        info "  baseURL: $broker_url"
        if is_wsl && [[ "$broker_url" == *"localhost"* ]]; then
            warn "  baseURL points to localhost — WSL broker must use wsl-host bridge"
            info "  Fix: cp ${SCRIPT_DIR}/broker.windows-host.json ~/.filescope/broker.json"
        fi
        if [[ -n "$broker_url" ]] && [[ "$broker_url" != *":${LLM_PORT}"* ]]; then
            warn "  baseURL does not use port $LLM_PORT — stale config?"
            info "  Re-copy the matching template from ${SCRIPT_DIR} (broker.default.json / broker.windows-host.json / broker.remote-lan.json)"
        fi
    else
        warn "No broker config at ~/.filescope/broker.json"
        if is_wsl; then
            info "  Fix: cp ${SCRIPT_DIR}/broker.windows-host.json ~/.filescope/broker.json"
        else
            info "  One will be auto-created from broker.default.json on first broker start"
        fi
    fi

    echo ""
    info "Model (for --alias): $MODEL_ALIAS"
    info "HF reference:        $MODEL_HF_REF"
    echo ""
}

# ============================================================================
# Dispatch
# ============================================================================

if $LAUNCH_ONLY; then
    print_launch_command
    exit 0
fi

if $STATUS_ONLY; then
    show_status
    exit 0
fi

if is_wsl; then
    wsl_guide
    exit 0
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    macos_guide
    exit 0
fi

linux_guide
