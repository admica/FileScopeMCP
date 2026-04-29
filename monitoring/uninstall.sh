#!/bin/bash
# PATH: monitoring/uninstall.sh
# Cleanly removes everything install.sh created.
#
# By default this preserves time-series data at /var/lib/victoriametrics.
# Pass --purge to wipe it too.
#
# Usage:
#   sudo ./uninstall.sh
#   sudo ./uninstall.sh --purge        # also delete TSDB data
#   sudo ./uninstall.sh --help

set -euo pipefail

PURGE=false

GREEN='\033[1;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC}   $*"; }
info() { echo -e "${CYAN}  [..]${NC}   $*"; }
warn() { echo -e "${YELLOW}  [!!]${NC}   $*"; }
die()  { echo -e "\033[1;31m  [FAIL]\033[0m $*"; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge)    PURGE=true; shift ;;
        --help|-h)  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown argument: $1" ;;
    esac
done

[[ $EUID -eq 0 ]] || die "Run with sudo"

info "Stopping and disabling services"
for svc in nvidia-smi-textfile.timer nvidia-smi-textfile.service \
           victoriametrics.service node_exporter.service; do
    systemctl disable --now "$svc" 2>/dev/null || true
done
ok "services stopped"

info "Removing systemd units and binaries"
rm -f /etc/systemd/system/victoriametrics.service
rm -f /etc/systemd/system/node_exporter.service
rm -f /etc/systemd/system/nvidia-smi-textfile.service
rm -f /etc/systemd/system/nvidia-smi-textfile.timer
rm -f /usr/local/bin/victoria-metrics-prod
rm -f /usr/local/bin/node_exporter
rm -f /usr/local/bin/nvidia-smi-textfile.sh
rm -rf /etc/victoriametrics
systemctl daemon-reload
ok "units + binaries removed"

if $PURGE; then
    info "Purging data directories"
    rm -rf /var/lib/victoriametrics
    rm -rf /var/lib/node_exporter
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
