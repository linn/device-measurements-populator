#!/bin/bash
set -e
cd "${0%/*}" # ensure cwd is script dir

# What the repository produces, declared once - see artefacts.sh.
. "$(dirname "${BASH_SOURCE[0]}")/artefacts.sh"

for IMAGE_NAME in "${!SERVICE_IMAGES[@]}"; do
	docker push "$IMAGE_NAME:$TRAVIS_BUILD_NUMBER"
done
