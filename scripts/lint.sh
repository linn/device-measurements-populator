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
  # The output is captured so the FILE COUNT can be checked, not just the exit code. `biome ci` exits 0
  # when it matches nothing but biome.json itself - its own "No files were processed" guard cannot fire,
  # because the config is always in scope and counts as a processed file. So a files.includes that stops
  # matching source, or a new .gitignore line (vcs.useIgnoreFile makes .gitignore a live input to the
  # lint set), empties this gate silently and it still reports success.
  '')
    out=$("$BIOME" ci --error-on-warnings . 2>&1) && status=0 || status=$?
    printf '%s\n' "$out"
    checked=$(printf '%s' "$out" | sed -n 's/.*Checked \([0-9][0-9]*\) file.*/\1/p' | head -1)
    [ -n "$checked" ] && [ "$checked" -ge 2 ] || {
      echo "lint inspected ${checked:-no} file(s) - it is not covering the source tree" >&2
      exit 1
    }
    exit "$status"
    ;;
  *)       echo "usage: lint.sh [--write]" >&2; exit 2 ;;
esac
