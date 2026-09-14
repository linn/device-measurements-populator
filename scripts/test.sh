#!/bin/bash
set -e
cd "${0%/*}" # ensure cwd is script dir

cd ../

# shellcheck disable=SC2209  # env-var prefix on a command, not an assignment from `test`
NODE_ENV=test npm test
