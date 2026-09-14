#!/bin/bash
set -e
cd "${0%/*}" # ensure cwd is script dir

# What the repository produces, declared once - see artefacts.sh.
#
# Sourced from the working directory rather than from $BASH_SOURCE: the cd above has ALREADY moved us
# into this script's directory, so resolving a relative $0 a second time applies that directory twice -
# scripts/scripts/artefacts.sh.
. ./artefacts.sh

# An empty map would walk the loop zero times, push nothing and exit 0 - a green publish step behind
# which the deploy then asks ECS for a tag that was never pushed.
[ "${#SERVICE_IMAGES[@]}" -gt 0 ] || { echo "artefacts.sh declares no images - nothing to push" >&2; exit 1; }

for IMAGE_NAME in "${!SERVICE_IMAGES[@]}"; do
	docker push "$IMAGE_NAME:$TRAVIS_BUILD_NUMBER"
done
