#!/bin/bash
# PATH: monitoring/uninstall.sh
# Cleanly removes everything install.sh created.
#
# By default this preserves time-series data and Grafana dashboards
# (/var/lib/victoriametrics, /var/lib/grafana). Pass --purge to wipe them too.
#
# Usage:
#   sudo ./uninstall.sh
#   sudo ./uninstall.sh --purge        # also delete TSDB data + Grafana state
#   sudo ./uninstall.sh --keep-grafana # leave grafana package + state alone
#   sudo ./uninstall.sh --help

set -euo pipefail

PURGE=false
KEEP_GRAFANA=false

GREEN='\033[1;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC}   $*"; }
info() { echo -e "${CYAN}  [..]${NC}   $*"; }
warn() { echo -e "${YELLOW}  [!!]${NC}   $*"; }
die()  { echo -e "\033[1;31m  [FAIL]\033[0m $*"; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge)         PURGE=true; shift ;;
        --keep-grafana)  KEEP_GRAFANA=true; shift ;;
        --help|-h)       sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown argument: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "Run with sudo"

info "Stopping and disabling services"
for svc in nvidia-smi-textfile.timer nvidia-smi-textfile.service \
           victoriametrics.service node_exporter.service; do
    systemctl disable --now "$svc" 2>/dev/null || true
done
ok "core services stopped"

info "Removing systemd units and binaries"
rm -f /etc/systemd/system/victoriametrics.service
rm -f /etc/systemd/system/node_exporter.service
rm -f /etc/systemd/system/nvidia-smi-textfile.service
rm -f /etc/systemd/system/nvidia-smi-textfile.timer
rm -f /usr/local/bin/victoria-metrics-prod
rm -f /usr/local/bin/node_exporter
rm -f /usr/local/bin/nvidia-smi-textfile.sh
rm -rf /etc/victoriametrics
ok "units + binaries removed"

if ! $KEEP_GRAFANA; then
    info "Removing Grafana"
    systemctl disable --now grafana-server 2>/dev/null || true
    rm -rf /etc/systemd/system/grafana-server.service.d
    if dpkg -l grafana 2>/dev/null | grep -q '^ii'; then
        apt-get remove -y -qq grafana
    fi
    rm -f /etc/apt/sources.list.d/grafana.list
    rm -f /etc/apt/keyrings/grafana.asc
    rm -f /etc/grafana/provisioning/datasources/victoriametrics.yml
    ok "grafana removed"
else
    info "Keeping Grafana per --keep-grafana"
fi

systemctl daemon-reload

if $PURGE; then
    info "Purging data directories"
    rm -rf /var/lib/victoriametrics
    rm -rf /var/lib/node_exporter
    if ! $KEEP_GRAFANA; then
        apt-get purge -y -qq grafana 2>/dev/null || true
        rm -rf /var/lib/grafana /etc/grafana
    fi
    ok "data purged"
else
    warn "Data preserved at /var/lib/victoriametrics and /var/lib/node_exporter"
    warn "Re-run with --purge to delete."
fi

# Only remove the prometheus user if nothing else references it
if id prometheus >/dev/null 2>&1 && ! pgrep -u prometheus >/dev/null; then
    userdel prometheus 2>/dev/null || true
    ok "removed prometheus system user"
fi

ok "Uninstall complete."
