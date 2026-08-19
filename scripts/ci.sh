#!/bin/bash
#
# CI entry point. The only place in this repo's scripts that reads CI-provider variables, so moving
# off Travis is a change to this file alone. (The Makefile still reads TRAVIS_* directly for image
# tagging — pre-existing, and untouched here.)
#
set -e
cd "${0%/*}/.."

BRANCH="${TRAVIS_BRANCH:-}"
PULL_REQUEST="${TRAVIS_PULL_REQUEST:-false}"
BUILD_NUMBER="${TRAVIS_BUILD_NUMBER:-}"

# A pull request build reports the branch it targets, not the branch it comes from, so a PR into the
# default branch is what identifies "about to be merged" — that is what gets a sys deployment.
if [ "$BRANCH" = "master" ] && [ "$PULL_REQUEST" != "false" ]; then
  DEPLOY_ENVIRONMENT=sys
else
  DEPLOY_ENVIRONMENT=none
fi

echo "branch=$BRANCH pull_request=$PULL_REQUEST deploy=$DEPLOY_ENVIRONMENT"

make test
make all-the-dockers
make docker-push

if [ "$DEPLOY_ENVIRONMENT" = "none" ]; then
  # Includes pushes to master: prod is deployed by hand, so a merge publishes an image and stops
  # there. See scripts/deploy.sh for what a prod deploy would have to do differently.
  echo "No deployment for this build."
  exit 0
fi

bash scripts/deploy.sh "$DEPLOY_ENVIRONMENT" "$BUILD_NUMBER"
