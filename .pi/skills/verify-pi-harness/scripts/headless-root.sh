#!/bin/sh
set -u
agent=$(realpath "$1")
project=$(realpath "$2")
prompt=$(realpath "$3")
mkdir -p "$4/home" "$4/sessions"
run=$(realpath "$4")
deadline=$5
model=${6:-}

unset $(env | sed -n 's/^\(\(PI\|HC\)_[A-Za-z0-9_]*\)=.*/\1/p') XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
runtime=$(mktemp -d /tmp/hr-XXXXXX)
ln -s "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/systemd" "$runtime/systemd"

export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
export GH_CONFIG_DIR="$HOME/.config/gh"
export GH_HOST=github.invalid
export PATH="$(printf %s "$PATH" | tr : '\n' | grep -v -e "^$HOME/\.pi\(/\|$\)" -e '/node_modules/\.bin/\{0,1\}$' | paste -sd:)"
export HOME="$run/home"
export XDG_RUNTIME_DIR="$runtime"
export PI_CODING_AGENT_DIR="$agent"
export HC_SESSION="hr-${runtime##*-}"
export HC_SOCKET="$runtime/herdr-core/$HC_SESSION.sock"
export HC_TERMINAL_SOCKET="$HC_SOCKET"

herdr-core serve >>"$run/core.log" 2>&1 &
core=$!
tries=0
until [ -S "$HC_SOCKET" ]; do
	tries=$((tries + 1))
	[ "$tries" -le 100 ] || { echo "herdr-core never came up, see $run/core.log"; kill "$core"; rm -rf "$runtime"; exit 2; }
	sleep 0.2
done

cd "$project"
start=$(date +%s)
timeout -s "INT" -k 60 "$deadline" pi -p ${model:+--model "$model"} --session-dir "$run/sessions" "$(cat "$prompt")" \
	</dev/null >"$run/reply.txt" 2>"$run/stderr.txt"
code=$?
echo "exit $code after $(($(date +%s) - start)) s" >"$run/exit.txt"

hc server stop >>"$run/core.log" 2>&1
rm -rf "$runtime"
cat "$run/exit.txt"
