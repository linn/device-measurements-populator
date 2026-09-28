#!/bin/bash
set -e
cd "${0%/*}" # ensure cwd is script dir

cd ../

npm ci
