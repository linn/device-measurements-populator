#!/bin/bash
#
# Format and lint the whole repository with Biome, from one configuration at the root.
#
# Usage: lint.sh [--write]
#   default   check only, non-zero on any violation - what CI runs
#   --write   rewrite files in place - what to run before committing
set -e
cd "${0%/*}" # ensure cwd is script dir

cd ../

# Biome comes from the tree build.sh already installed, so this must be ordered after it. Running its
# own install here would either duplicate that work or, worse, install unlocked and leave the malware
# gate reporting on a tree the build does not use.
BIOME=./node_modules/.bin/biome

[ -x "$BIOME" ] \
  || { echo "biome is not installed - lint.sh must run after build.sh" >&2; exit 1; }

case "${1:-}" in
  --write) "$BIOME" check --write . ;;
  '')      "$BIOME" ci --error-on-warnings . ;;
  *)       echo "usage: lint.sh [--write]" >&2; exit 2 ;;
esac
