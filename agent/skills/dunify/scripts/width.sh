#!/bin/sh
usage='usage: width.sh <limits file> <source root>...'
[ $# -ge 2 ] && [ -f "$1" ] || { echo "$usage" >&2; exit 2; }
limits=$1
shift
git rev-parse 2>/dev/null && in_git=1
for root do
	[ -d "$root" ] || { echo "$root is not a folder. $usage" >&2; exit 2; }
	[ -z "$in_git" ] || { git check-ignore -q "$root" 2>/dev/null; [ $? -le 1 ]; } || { echo "$root is outside this git repo. $usage" >&2; exit 2; }
done
find "$@" -mindepth 1 | if [ "$in_git" ]; then git check-ignore --stdin -nv | grep '^::' | cut -f 2-; else cat; fi |
	awk -v limits="$limits" '
		BEGIN { while ((getline line < limits) > 0) { split(line, field, " "); max[field[1]] = field[2]; baseline[field[1]] = field[3] == "baseline" } }
		sub("/[^/]*$", "") { count[$0]++ }
		END {
			for (dir in count) {
				cap = dir in max ? max[dir] : 20
				if (count[dir] > cap) { print dir " holds " count[dir] " entries, over " cap ". Folder rule: move each concept into a folder named for it, with its edge file inside."; bad = 1 }
				else if (baseline[dir] && count[dir] < cap) { print dir " holds " count[dir] " entries. " (count[dir] > 20 ? "Lower its baseline line in " limits " to " count[dir] "." : "Delete its baseline line in " limits "."); bad = 1 }
			}
			exit bad
		}'
