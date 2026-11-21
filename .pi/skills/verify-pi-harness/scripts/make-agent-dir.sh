#!/bin/sh
set -eu
checkout=$1
dest=$2
mkdir -p "$dest"
for entry in $(sed -n 's#^!/agent/\([^/]*\)/\{0,1\}$#\1#p' "$checkout/.gitignore"); do
	[ -e "$checkout/agent/$entry" ] && ln -sfn "$checkout/agent/$entry" "$dest/$entry"
done
ln -sfn "$HOME/.pi/agent/auth.json" "$dest/auth.json"
for file in settings.json models.json models-store.json; do
	[ -e "$HOME/.pi/agent/$file" ] && cp "$HOME/.pi/agent/$file" "$dest/$file"
done
ls -l "$dest"
