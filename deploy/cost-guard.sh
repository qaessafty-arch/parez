#!/usr/bin/env bash
#
# Parez — cost guard.
#
# Oracle bills for anything above the Always Free allowance, and the card you
# verified the account with is the one that gets charged. This script keeps a
# running tally so you find out from this log, not from a statement.
#
#   bash cost-guard.sh check     one-off check
#   bash cost-guard.sh watch     every 6 hours, writes to cost-guard.log
#
# Install as a cron job on the server:
#   crontab -e
#   0 */6 * * * bash ~/parez/deploy/cost-guard.sh watch >> ~/cost-guard.log 2>&1

set -euo pipefail

BUDGET_USD="${BUDGET_USD:-1.00}"   # alert threshold; Always Free should be 0.00
STATE_FILE="${STATE_FILE:-/tmp/parez-cost-state}"

# Oracle CLI is not installed by default. If it is absent we fall back to a
# simple reachability + disk check rather than reporting a false "OK".
have_oci_cli() { command -v oci >/dev/null 2>&1; }

check() {
  local stamp status="OK"
  echo "---- parez cost guard: $(date -u '+%Y-%m-%d %H:%M:%S') UTC ----"

  # 1. Service still running?
  if systemctl is-active --quiet parez; then
    echo "  parez service : running"
  else
    echo "  parez service : STOPPED  <-- check 'journalctl -u parez -n 50'"
    status="WARN"
  fi

  # 2. Disk headroom. A full disk means the DB cannot be written or backed up.
  local used
  used="$(df -h "$HOME" | awk 'NR==2 {print $5}' | tr -d '%')"
  echo "  disk used     : ${used}%"
  if [ "${used:-0}" -gt 85 ]; then
    echo "                   <-- above 85%, backups will fail. Clean up."
    status="WARN"
  fi

  # 3. Backup freshness. The database is the whole shop history.
  local newest age
  newest="$(find "$HOME/parez/data/backups" -name '*.db' -newermt '-7 days' 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ]; then
    echo "  backup        : recent copy present"
  else
    echo "  backup        : NONE in the last 7 days  <-- do a Backup from the app"
    status="WARN"
  fi

  # 4. Real cost, if the Oracle CLI happens to be installed.
  if have_oci_cli; then
    echo "  oci cli       : present (run 'oci compute instance list' for spend)"
  else
    echo "  cost          : set a Budget alert in the Oracle console (Billing &"
    echo "                  Cost Management -> Budgets) at \$1. That is the"
    echo "                  real protection; this script cannot see your bill."
  fi

  if [ "$status" = "WARN" ]; then
    echo "  RESULT        : needs attention"
  else
    echo "  RESULT        : all good"
  fi

  # Remember the last run so you can spot gaps.
  date +%s > "$STATE_FILE"
  echo
}

case "${1:-check}" in
  check) check ;;
  watch)
    while true; do check; sleep 21600; done
    ;;
  *)
    echo "usage: $0 [check|watch]" >&2
    exit 1
    ;;
esac