#!/bin/sh
exempt=${1:?usage: width.sh <exempt list> <source root>...}
shift
find "$@" -type d | sort | while IFS= read -r dir; do
	git check-ignore -q "$dir" 2>/dev/null && continue
	cut -d ' ' -f 1 "$exempt" | grep -qxF "$dir" && continue
	count=$(ls -A "$dir" | while IFS= read -r entry; do git check-ignore -q "$dir/$entry" 2>/dev/null || echo "$entry"; done | wc -l)
	[ "$count" -gt 20 ] && echo "$dir holds $count entries, over 20. Folder rule: move each concept into a folder named for it, with its edge file inside."
done | awk '{ print } END { exit NR > 0 }'
