#!/bin/sh
set -eu

checkout=$(realpath "${PHI_ROUTER_CHECKOUT:?a built phi-router checkout}")
scenario=$(realpath "$(dirname "$0")/accounts.scenario.ts")
human=$(mktemp -d /tmp/phi-human-XXXXXX)

mkdir -p "$human/.pi/agent"
chmod 700 "$human/.pi" "$human/.pi/agent"
printf '{"defaultTools":["+codemode"]}\n' >"$human/.pi/agent/settings.json"
oauth='{"type":"oauth","access":"fake-access","refresh":"fake-refresh","expires":4102444800000}'
key='{"type":"api_key","key":"fake-key"}'
printf '{"ultra-a":%s,"ultra-b":%s,"ent":%s,"openai":%s,"opencode-go":%s}\n' "$oauth" "$key" "$oauth" "$key" "$key" >"$human/.pi/agent/auth.json"
chmod 600 "$human/.pi/agent/auth.json"

exec env -i \
	HOME="$human" \
	PATH="${PATH:?a PATH with bun and pi on it}" \
	XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:?}" \
	TMPDIR=/tmp \
	PI_DRIVER_SERVICE=1 \
	PHI_ROUTER_CHECKOUT="$checkout" \
	PHI_ROUTER_PORT="${PHI_ROUTER_PORT:?the port of the router the caller started}" \
	PHI_ROUTER_STATE="${PHI_ROUTER_STATE:?that router's XDG_STATE_HOME}" \
	PHI_ROUTER_CONFIG_HOME="${PHI_ROUTER_CONFIG_HOME:?that router's XDG_CONFIG_HOME}" \
	PHI_ACCOUNTS_RECORD="${PHI_ACCOUNTS_RECORD:?the text of overdue.txt}" \
	PHI_ACCOUNTS_PROMPT="${PHI_ACCOUNTS_PROMPT:?the root's prompt}" \
	PHI_ACCOUNTS_OFFLINE="${PHI_ACCOUNTS_OFFLINE:-}" \
	bun "$scenario"
