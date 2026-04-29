#!/usr/bin/env bash
# PATH: monitoring/scripts/nvidia-smi-textfile.sh
# Emits Prometheus text-format GPU metrics by shelling out to nvidia-smi.
# Output is read by node_exporter's textfile collector. No long-lived daemon.
# Invoked by monitoring/systemd/nvidia-smi-textfile.timer every 15s.

set -euo pipefail

OUT="${1:-/var/lib/node_exporter/textfile_collector/nvidia_smi.prom}"
TMP="$(mktemp "${OUT}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

QUERY="index,name,uuid,utilization.gpu,utilization.memory,memory.used,memory.free,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.current.graphics,clocks.current.memory,pstate"

nvidia-smi --query-gpu="$QUERY" --format=csv,noheader,nounits \
| awk -F', *' '
BEGIN {
    print "# HELP nvidia_smi_gpu_utilization_ratio GPU compute utilization (0-1)."
    print "# TYPE nvidia_smi_gpu_utilization_ratio gauge"
    print "# HELP nvidia_smi_memory_utilization_ratio GPU memory bus utilization (0-1)."
    print "# TYPE nvidia_smi_memory_utilization_ratio gauge"
    print "# HELP nvidia_smi_memory_used_bytes VRAM used in bytes."
    print "# TYPE nvidia_smi_memory_used_bytes gauge"
    print "# HELP nvidia_smi_memory_free_bytes VRAM free in bytes."
    print "# TYPE nvidia_smi_memory_free_bytes gauge"
    print "# HELP nvidia_smi_memory_total_bytes Total VRAM in bytes."
    print "# TYPE nvidia_smi_memory_total_bytes gauge"
    print "# HELP nvidia_smi_temperature_celsius GPU core temperature."
    print "# TYPE nvidia_smi_temperature_celsius gauge"
    print "# HELP nvidia_smi_power_draw_watts Current power draw."
    print "# TYPE nvidia_smi_power_draw_watts gauge"
    print "# HELP nvidia_smi_power_limit_watts Power limit cap."
    print "# TYPE nvidia_smi_power_limit_watts gauge"
    print "# HELP nvidia_smi_fan_speed_ratio Fan speed (0-1)."
    print "# TYPE nvidia_smi_fan_speed_ratio gauge"
    print "# HELP nvidia_smi_clock_graphics_hz Graphics clock in hertz."
    print "# TYPE nvidia_smi_clock_graphics_hz gauge"
    print "# HELP nvidia_smi_clock_memory_hz Memory clock in hertz."
    print "# TYPE nvidia_smi_clock_memory_hz gauge"
}
function bad(x)  { return (x ~ /N\/A|Not Supported|Unknown/) }
function num(x)  { return bad(x) ? "NaN" : x+0 }
function pct(x)  { return bad(x) ? "NaN" : (x+0)/100 }
function mib(x)  { return bad(x) ? "NaN" : (x+0)*1048576 }
function mhz(x)  { return bad(x) ? "NaN" : (x+0)*1000000 }
{
    L = "gpu=\"" $1 "\",name=\"" $2 "\",uuid=\"" $3 "\",pstate=\"" $15 "\""
    printf "nvidia_smi_gpu_utilization_ratio{%s} %s\n",    L, pct($4)
    printf "nvidia_smi_memory_utilization_ratio{%s} %s\n", L, pct($5)
    printf "nvidia_smi_memory_used_bytes{%s} %s\n",        L, mib($6)
    printf "nvidia_smi_memory_free_bytes{%s} %s\n",        L, mib($7)
    printf "nvidia_smi_memory_total_bytes{%s} %s\n",       L, mib($8)
    printf "nvidia_smi_temperature_celsius{%s} %s\n",      L, num($9)
    printf "nvidia_smi_power_draw_watts{%s} %s\n",         L, num($10)
    printf "nvidia_smi_power_limit_watts{%s} %s\n",        L, num($11)
    printf "nvidia_smi_fan_speed_ratio{%s} %s\n",          L, pct($12)
    printf "nvidia_smi_clock_graphics_hz{%s} %s\n",        L, mhz($13)
    printf "nvidia_smi_clock_memory_hz{%s} %s\n",          L, mhz($14)
}
' > "$TMP"

mv -f "$TMP" "$OUT"
trap - EXIT
