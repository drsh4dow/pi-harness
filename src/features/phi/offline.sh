#!/bin/sh
set -eu

checkout=$(realpath "${1:?usage: offline.sh <phi-router checkout> <scenario file>}")
scenario=$(realpath "${2:?usage: offline.sh <phi-router checkout> <scenario file>}")
human=$(mktemp -d /tmp/phi-human-XXXXXX)

mkdir -p "$human/.pi/agent"
chmod 700 "$human/.pi" "$human/.pi/agent"
printf '{"defaultTools":["+codemode"]}\n' >"$human/.pi/agent/settings.json"
oauth='{"type":"oauth","access":"fake-access","refresh":"fake-refresh","expires":4102444800000}'
key='{"type":"api_key","key":"fake-key"}'
printf '{"ultra-a":%s,"ultra-b":%s,"ent":%s,"openai":%s,"opencode-go":%s}\n' "$oauth" "$key" "$oauth" "$key" "$key" >"$human/.pi/agent/auth.json"
chmod 600 "$human/.pi/agent/auth.json"

exec unshare -rn sh -c 'ip link set lo up && exec "$@"' sh \
	env -i \
	HOME="$human" \
	PATH="$HOME/.bun/bin:/usr/bin:/bin:$HOME/.local/bin" \
	XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:?}" \
	TMPDIR=/tmp \
	PI_DRIVER_SERVICE=1 \
	PHI_ROUTER_CHECKOUT="$checkout" \
	bun "$scenario"
