#!/bin/sh
set -u
checkout=$(realpath "$1")
agent=$(realpath "$2")
status=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; status=1; }

if [ "$(realpath "$agent/extensions")" = "$checkout/agent/extensions" ]; then ok "$agent runs $checkout/agent"; else bad "$agent/extensions does not point at $checkout/agent/extensions"; fi
if [ -d "$checkout/node_modules/effect" ]; then ok "bun install ran in $checkout"; else bad "no node_modules in $checkout, run bun install there"; fi
if jq -e 'length > 0' "$agent/auth.json" >/dev/null 2>&1; then ok "auth.json resolves to $(readlink -f "$agent/auth.json")"; else bad "$agent/auth.json is missing, empty or not JSON"; fi
if [ -s "$agent/settings.json" ]; then ok "settings.json copied"; else bad "$agent/settings.json is missing"; fi
if command -v herdr-core >/dev/null && command -v hc >/dev/null; then ok "herdr-core and hc on PATH"; else bad "herdr-core or hc is not on PATH"; fi
if systemctl --user show-environment >/dev/null 2>&1; then ok "systemd user manager reachable"; else bad "systemctl --user cannot reach the user manager"; fi
echo "pi $(pi --version) at $(command -v pi)"
echo "checkout $(git -C "$checkout" log -1 --format='%h %s')"
exit "$status"
