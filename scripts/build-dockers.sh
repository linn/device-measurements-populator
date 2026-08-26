#!/bin/bash
set -e
cd "${0%/*}" # ensure cwd is script dir

TIMESTAMP=$(date -u +%FT%TZ)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
VCS_REF=$(git rev-parse --short HEAD)

echo "{ \"timeStamp\": \"${TIMESTAMP}\", \"branch\": \"${TRAVIS_BRANCH}\", \"build\": \"${TRAVIS_BUILD_NUMBER}\", \"commit\": \"${TRAVIS_COMMIT}\" }" > ../ping.json

docker build -t linn/device-measurements-populator:"$TRAVIS_BUILD_NUMBER" \
	--build-arg VCS_REF="$VCS_REF" \
	--build-arg VERSION="$TRAVIS_BUILD_NUMBER" \
	--build-arg BUILD_DATE="$BUILD_DATE" \
	../
