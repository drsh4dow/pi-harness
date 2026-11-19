#!/bin/sh
# Runs each guide scenario beside this script N times (default 3): the scenarios in parallel, the trials of one
# scenario one after another. Prints one markdown table of events reached and hits per scenario, then how many runs
# had the root read each principle, and saves both as table.md in the logs folder. A run that printed no verdict line
# (exit 1 or 2, or killed after 60 minutes) counts as broken. Every run costs real model calls.
set -u
here=$(cd "$(dirname "$0")" && pwd)
trials=${1:-3}
names=$(cd "$here" && ls ./*.scenario.ts | sed 's|^\./||; s|\.scenario\.ts$||')
runs=$((trials * $(echo "$names" | wc -l)))
[ "$runs" -le 45 ] || { echo "refusing $runs runs: more than 45" >&2; exit 2; }
logs=$(mktemp -d "${TMPDIR:-/tmp}/guide-rounds-XXXXXX")
started=$(date +%s)
for name in $names; do
	(
		for trial in $(seq "$trials"); do
			timeout -k 1m 60m bun "$here/$name.scenario.ts" >"$logs/$name-$trial.log" 2>&1
		done
	) &
done
wait
tree=$(git -C "$here" rev-parse --show-toplevel)
{
	echo "Prompts at $(git -C "$tree" rev-parse --short HEAD) in $tree, $(git -C "$tree" status --porcelain -- agent | wc -l) uncommitted files under agent/, $runs runs in $((($(date +%s) - started) / 60)) minutes."
	echo
	echo "| scenario | trials | events reached | hits | no event | broken | model | run folders |"
	echo "|---|---|---|---|---|---|---|---|"
	for name in $names; do
		awk -v name="$name" -v trials="$trials" '
			$1 == "verdict" { verdicts++; events += $2 != "no-event"; hits += $2 == "hit"; models[$3] }
			$1 == "evidence" { folders = folders " " $2 }
			END {
				for (model in models) seen = seen " " model
				printf "| %s | %d | %d | %d | %d | %d |%s |%s |\n", name, trials, events, hits, verdicts - events, trials - verdicts, seen, folders
			}
		' "$logs/$name"-*.log
	done
	echo
	echo "| principle | runs whose root read it |"
	echo "|---|---|"
	grep -h '^principles ' "$logs"/*.log | sed 's/^principles //; s/, /\n/g' | grep -vx none | sort | uniq -c | sort -rn |
		awk '{ printf "| %s | %d |\n", $2, $1 }'
	echo
	echo "Logs in $logs."
} | tee "$logs/table.md"
