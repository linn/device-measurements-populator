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

# Every arm builds and tests. Declaring a `script:` key replaces the node_js language default, so if the
# suite is not named here it runs nowhere.
./build.sh
./test.sh

if [ "${TRAVIS_BRANCH}" != "master" ]; then
  echo "BRANCH BUILD - no image published"
  exit 0
fi

# The image is tagged by build number and nothing else. A tag derived from the branch name cannot be
# formed for a branch containing '/', which docker rejects outright.
./build-dockers.sh
./push-dockers.sh

# A pull-request build reports the branch it TARGETS, not the branch it comes from, so a pull request
# into the default branch is what identifies "about to be merged" - and that is what gets sys.
#
# Matched exhaustively rather than tested against "false", because absence must not read as "this is a
# pull request". This is the only arm that touches AWS, so it is the one place an unset or malformed
# value must refuse instead of proceeding - a CI shim that sets TRAVIS_BRANCH and forgets this variable
# would otherwise deploy.
case "${TRAVIS_PULL_REQUEST}" in
  false)
    # Prod is deployed by hand: its target-group arrangement differs from sys, so a prod deploy is a
    # cutover rather than a like-for-like release. See deploy.sh.
    echo "MASTER BUILD - image published; prod is deployed by hand"
    ;;
  *[!0-9]*|'')
    echo "TRAVIS_PULL_REQUEST is '${TRAVIS_PULL_REQUEST}' - neither 'false' nor a pull-request number, so refusing rather than guessing whether to deploy" >&2
    exit 1
    ;;
  *)
    echo "PR BUILD - deploying sys"
    ./deploy.sh sys "$TRAVIS_BUILD_NUMBER"
    ;;
esac
