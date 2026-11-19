#!/bin/sh
# Runs each case of the alignment contract N times (default 3), one round of the six cases in parallel at a time,
# and prints one line per run: its verdict (a failure names every rule that broke), any info, its spend and its
# evidence folder. Every run costs real model calls.
set -u
here=$(cd "$(dirname "$0")" && pwd)
trials=${1:-3}
logs=$(mktemp -d "${TMPDIR:-/tmp}/align-trials-XXXXXX")
for trial in $(seq "$trials"); do
	for case in pantry invoicer tidepool weatherline shortlinks cyclefare; do
		bun "$here/$case.scenario.ts" >"$logs/$case-$trial.log" 2>&1 &
	done
	wait
done
for log in "$logs"/*.log; do
	grep -E '^(pass|fail|broken|interrupted) |^info |^evidence |^spent ' "$log" | tr '\n' ' '
	echo
done
echo "logs $logs"
