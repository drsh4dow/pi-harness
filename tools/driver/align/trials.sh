#!/bin/sh
# Runs each case of the alignment contract N times (default 3), one round of the five cases in parallel at a time,
# and prints each run's verdict and evidence folder. Every run costs real model calls.
#   1 vague build asks first      pantry
#   2 audit runs with no question invoicer
#   2 report runs with no question tidepool
#   2 specified edit runs         weatherline
#   3 settled build designs first shortlinks
set -u
here=$(cd "$(dirname "$0")" && pwd)
trials=${1:-3}
logs=$(mktemp -d "${TMPDIR:-/tmp}/align-trials-XXXXXX")
for trial in $(seq "$trials"); do
	for case in pantry invoicer tidepool weatherline shortlinks; do
		bun "$here/$case.scenario.ts" >"$logs/$case-$trial.log" 2>&1 &
	done
	wait
done
for log in "$logs"/*.log; do
	grep -E '^(pass|fail|broken|interrupted) |^evidence |^spent ' "$log" | tr '\n' ' '
	echo
done
echo "logs $logs"
