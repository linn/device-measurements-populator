#!/bin/bash
#
# CI entry point, and the only file in this repository that reads CI-provider variables - so moving off
# Travis is a change to this file alone.
#
# Everything below runs in `script:`, where a failure fails the build. It must not be moved to
# `after_success`, whose exit status Travis ignores: a failed push or a failed deploy there yields a
# GREEN build with nobody told.
#
set -e
cd "${0%/*}" # ensure cwd is script dir

# Read before anything has a side effect that outlives the build: a value this script cannot interpret
# must stop it while stopping is still free, and refusing further down would leave a published image
# that nothing will ever deploy.
#
# Matched exhaustively rather than tested for inequality, because absence must not be read as a
# decision - and only a real pull-request number counts, so a shim's "0 means none" cannot reach the one
# arm that touches AWS.
case "${TRAVIS_PULL_REQUEST}" in
  false)          IS_PULL_REQUEST=no ;;
  [1-9]|[1-9][0-9]*) IS_PULL_REQUEST=yes ;;
  *)
    echo "TRAVIS_PULL_REQUEST is '${TRAVIS_PULL_REQUEST}' - neither 'false' nor a pull-request number, so refusing rather than guessing whether to deploy" >&2
    exit 1
    ;;
esac

# Every arm builds and tests. Declaring a `script:` key replaces the node_js language default, so if the
# suite is not named here it runs nowhere.
./build.sh
./test.sh

if [ "${TRAVIS_BRANCH}" != "master" ]; then
  echo "BRANCH BUILD - no image published"
  exit 0
fi

# Checked here rather than at the top: a branch build publishes nothing and has no use for a tag, so
# this is the first point at which the value is needed - and it is still before the first side effect
# that outlives the build.
case "${TRAVIS_BUILD_NUMBER}" in
  [1-9]|[1-9][0-9]*) ;;
  *)
    echo "TRAVIS_BUILD_NUMBER is '${TRAVIS_BUILD_NUMBER}' - it is the image tag, and a build cannot publish one it cannot name" >&2
    exit 1
    ;;
esac

# The image is tagged by build number and nothing else. A tag derived from the branch name cannot be
# formed for a branch containing '/', which docker rejects outright.
./build-dockers.sh
./push-dockers.sh

# A pull-request build reports the branch it TARGETS, not the branch it comes from, so a pull request
# into the default branch is what identifies "about to be merged" - and that is what gets sys.
if [ "$IS_PULL_REQUEST" = yes ]; then
  echo "PR BUILD - deploying sys"
  ./deploy.sh sys "$TRAVIS_BUILD_NUMBER"
else
  # Prod is deployed by hand: its target-group arrangement differs from sys, so a prod deploy is a
  # cutover rather than a like-for-like release. See deploy.sh.
  echo "MASTER BUILD - image published; prod is deployed by hand"
fi
