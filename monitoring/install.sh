#!/bin/bash
# PATH: monitoring/install.sh
# Installs a memory-capped VictoriaMetrics + node_exporter monitoring stack
# for the FileScopeMCP llama-server instance. Optimized for memory-tight
# single-host setups (~70-100MB typical, 192MB cap).
#
# Stack:
#   - VictoriaMetrics (PromQL-compatible TSDB + built-in vmui) port :8881
#   - node_exporter (with textfile collector)                  port :8882
#   - nvidia-smi systemd timer -> textfile (no daemon)
#
# View metrics by browsing http://<host>:8881/vmui — VM's built-in query UI.
# (No Grafana on this box; run it elsewhere if you want full dashboards.)
#
# Every long-lived service has a hard MemoryMax cgroup cap so a misbehaving
# component cannot OOM-kill llama-server. Defaults assume llama-server is
# already running on localhost:8880 with --metrics enabled.
#
# Usage:
#   sudo ./install.sh                     # install
#   sudo ./install.sh --llama-port 9000   # if llama-server is on a non-default port
#   sudo ./install.sh --status            # health check
#   sudo ./install.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Defaults ---
LLAMA_PORT=8880
STATUS_ONLY=false
VM_VERSION="${VM_VERSION:-v1.142.0}"
NODE_EXPORTER_VERSION="${NODE_EXPORTER_VERSION:-v1.11.1}"

# --- Colors ---
GREEN='\033[1;32m'; BLUE='\033[1;34m'; YELLOW='\033[1;33m'
RED='\033[1;31m';   CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC}   $*"; }
info() { echo -e "${CYAN}  [..]${NC}   $*"; }
warn() { echo -e "${YELLOW}  [!!]${NC}   $*"; }
fail() { echo -e "${RED}  [FAIL]${NC} $*"; }
die()  { fail "$*"; exit 1; }

# --- Args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --llama-port)   LLAMA_PORT="$2"; shift 2 ;;
        --status)       STATUS_ONLY=true; shift ;;
        --help|-h)
            sed -n '3,23p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) die "Unknown argument: $1 (try --help)" ;;
    esac
done

# --- Status mode ---
if $STATUS_ONLY; then
    echo "Service status:"
    for svc in llama-server victoriametrics node_exporter nvidia-smi-textfile.timer; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            ok "$svc is active"
        elif systemctl status "$svc" >/dev/null 2>&1; then
            warn "$svc installed but not active"
        else
            info "$svc not installed"
        fi
    done
    echo
    echo "Endpoints:"
    for url in "http://localhost:${LLAMA_PORT}/metrics" \
               "http://localhost:8881/metrics" \
               "http://localhost:8882/metrics"; do
        if curl -sf -o /dev/null --max-time 2 "$url"; then
            ok "$url reachable"
        else
            warn "$url unreachable"
        fi
    done
    exit 0
fi

# --- Preflight ---
[[ $EUID -eq 0 ]] || die "Run with sudo"
command -v curl >/dev/null || die "curl is required"
command -v tar  >/dev/null || die "tar is required"

# Distro: Ubuntu only (we don't try to abstract over apt vs dnf vs pacman)
if [[ -r /etc/os-release ]] && grep -q '^ID=ubuntu' /etc/os-release; then
    ok "Ubuntu detected: $(. /etc/os-release && echo "$PRETTY_NAME")"
else
    die "This installer supports Ubuntu only. Detected: $(grep -E '^ID=' /etc/os-release 2>/dev/null || echo unknown)"
fi

# Architecture: pinned binaries are linux-amd64
ARCH="$(uname -m)"
[[ "$ARCH" == "x86_64" ]] || die "Pinned binaries are linux-amd64; this box is $ARCH"

# Port collisions: don't fail if it's our OWN service holding the port (re-install).
declare -A PORT_OWNER=([8881]=victoriametrics [8882]=node_exporter)
for port in 8881 8882; do
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$"; then
        if systemctl is-active --quiet "${PORT_OWNER[$port]}.service" 2>/dev/null; then
            ok "port $port held by ${PORT_OWNER[$port]}.service (re-install will replace it)"
        else
            die "Port $port is already in use by something else (run: ss -tlnp | grep :$port)"
        fi
    else
        ok "port $port free"
    fi
done

# nvidia-smi: warn but don't fail (in case GPU is being added later)
if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
    ok "nvidia-smi works ($(nvidia-smi -L | head -1))"
else
    warn "nvidia-smi missing or driver not responding; GPU collector will fail until fixed"
fi

# Memory sanity check: refuse if free RAM < 1 GiB
FREE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [[ $FREE_MB -lt 1024 ]]; then
    warn "Only ${FREE_MB}MiB available; monitoring stack needs ~100MB headroom."
    warn "Continue anyway? [y/N]"
    read -r REPLY
    [[ "$REPLY" =~ ^[Yy]$ ]] || die "Aborted by user"
fi

# Verify llama-server is reachable (not fatal)
if curl -sf -o /dev/null --max-time 2 "http://localhost:${LLAMA_PORT}/metrics"; then
    ok "llama-server /metrics reachable on :${LLAMA_PORT}"
else
    warn "llama-server /metrics not reachable on :${LLAMA_PORT} (will scrape once it's up)"
fi

# --- Step 1: prometheus user + dirs ---
info "Creating system user and directories"
id prometheus >/dev/null 2>&1 || useradd --system --no-create-home --shell /bin/false prometheus
install -d -o prometheus -g prometheus /var/lib/victoriametrics
install -d -o prometheus -g prometheus /var/lib/node_exporter
install -d -o prometheus -g prometheus /var/lib/node_exporter/textfile_collector
install -d -o root -g root /etc/victoriametrics
install -d -o root -g root /etc/victoriametrics/dashboards
ok "user + dirs ready"

# --- Step 2: VictoriaMetrics binary ---
if [[ ! -x /usr/local/bin/victoria-metrics-prod ]]; then
    info "Downloading VictoriaMetrics ${VM_VERSION}"
    TMP=$(mktemp -d)
    curl -fsSL -o "$TMP/vm.tar.gz" \
        "https://github.com/VictoriaMetrics/VictoriaMetrics/releases/download/${VM_VERSION}/victoria-metrics-linux-amd64-${VM_VERSION}.tar.gz"
    tar -xzf "$TMP/vm.tar.gz" -C "$TMP"
    install -m 0755 "$TMP/victoria-metrics-prod" /usr/local/bin/victoria-metrics-prod
    rm -rf "$TMP"
    ok "victoria-metrics-prod installed"
else
    ok "victoria-metrics-prod already installed"
fi

# --- Step 3: node_exporter binary ---
if [[ ! -x /usr/local/bin/node_exporter ]]; then
    info "Downloading node_exporter ${NODE_EXPORTER_VERSION}"
    TMP=$(mktemp -d)
    curl -fsSL -o "$TMP/ne.tar.gz" \
        "https://github.com/prometheus/node_exporter/releases/download/${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION#v}.linux-amd64.tar.gz"
    tar -xzf "$TMP/ne.tar.gz" -C "$TMP"
    install -m 0755 "$TMP/node_exporter-${NODE_EXPORTER_VERSION#v}.linux-amd64/node_exporter" /usr/local/bin/node_exporter
    rm -rf "$TMP"
    ok "node_exporter installed"
else
    ok "node_exporter already installed"
fi

# --- Step 4: nvidia-smi textfile collector script ---
info "Installing GPU textfile collector script"
install -m 0755 "$SCRIPT_DIR/scripts/nvidia-smi-textfile.sh" /usr/local/bin/nvidia-smi-textfile.sh
ok "/usr/local/bin/nvidia-smi-textfile.sh installed"

# --- Step 5: scrape config + vmui dashboards ---
info "Installing scrape config"
SCRAPE_TMP=$(mktemp)
sed "s/localhost:8880/localhost:${LLAMA_PORT}/g" "$SCRIPT_DIR/config/prometheus.yml" > "$SCRAPE_TMP"
install -m 0644 -o root -g root "$SCRAPE_TMP" /etc/victoriametrics/prometheus.yml
rm -f "$SCRAPE_TMP"
ok "/etc/victoriametrics/prometheus.yml installed"

info "Installing vmui dashboards"
# Copies dashboard JSONs plus the required index.js manifest.
for dash in "$SCRIPT_DIR"/dashboards/*; do
    [[ -e "$dash" ]] || continue
    install -m 0644 -o root -g root "$dash" /etc/victoriametrics/dashboards/
done
ok "vmui dashboards installed to /etc/victoriametrics/dashboards/"

# --- Step 6: systemd units ---
info "Installing systemd units"
install -m 0644 "$SCRIPT_DIR/systemd/victoriametrics.service"     /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/node_exporter.service"       /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/nvidia-smi-textfile.service" /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/nvidia-smi-textfile.timer"   /etc/systemd/system/
systemctl daemon-reload
ok "units installed and daemon-reloaded"

# --- Step 7: enable + start ---
info "Enabling and starting services"
systemctl enable --now node_exporter.service
systemctl enable --now victoriametrics.service
systemctl enable --now nvidia-smi-textfile.timer
ok "core services started"

# --- Step 8: verify ---
echo
info "Verifying scrape targets (give VM ~5s to scrape):"
sleep 5
for url in "http://localhost:8881/metrics" \
           "http://localhost:8882/metrics" \
           "http://localhost:${LLAMA_PORT}/metrics"; do
    if curl -sf -o /dev/null --max-time 3 "$url"; then ok "$url"; else warn "$url unreachable"; fi
done

if [[ -s /var/lib/node_exporter/textfile_collector/nvidia_smi.prom ]]; then
    ok "GPU textfile populated"
else
    warn "GPU textfile not yet populated (timer may not have fired; check 'systemctl list-timers')"
fi

echo
ok "Install complete."
echo
HOST_IP="$(hostname -I | awk '{print $1}')"
echo "Next steps:"
echo "  1. Open the dashboard:    http://${HOST_IP}:8881/vmui/#/dashboards"
echo "  2. Live llama-server log: sudo journalctl -u llama-server -f"
echo "  3. Health check:          sudo ./install.sh --status"
echo
