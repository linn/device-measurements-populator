#!/bin/bash
#
# CI entry point: the file that turns CI-provider variables into decisions, so which arm runs is settled
# here alone. build-dockers.sh and push-dockers.sh still read TRAVIS_BUILD_NUMBER, TRAVIS_BRANCH and
# TRAVIS_COMMIT from the environment themselves, so this is not the only file naming them and the checks
# below are not a guarantee for anyone invoking those directly.
#
# Everything below runs in `script:`, where a failure fails the build. It must not be moved to
# `after_success`, whose exit status Travis ignores: a failed push or a failed deploy there yields a
# GREEN build with nobody told.
#
set -e
cd "${0%/*}" # ensure cwd is script dir

# Refuses a value it cannot interpret rather than reading absence as a decision. The refusal arm is the
# one that lists patterns, so a spelling nobody anticipated lands there instead of in an accepting arm:
#   ''        - unset or empty
#   *[!0-9]*  - anything holding a non-digit, at any position
#   0*        - a leading zero, which covers 0 itself and a shim's "0 means none"
# Written this way round because `[1-9][0-9]*` looks like a regex and is not: in a case pattern `*` is
# "any string", so it accepts "12abc" and "12; echo".
is_positive_integer () {
	case "$1" in
		''|*[!0-9]*|0*) return 1 ;;
		*) return 0 ;;
	esac
}

# Unset or misspelled, this is the one variable whose failure is SILENT: it would miss the master gate
# below, take the branch arm, publish nothing and exit 0 with nobody told. Every other arm here fails
# loudly, so this is checked first and at the top.
[ -n "${TRAVIS_BRANCH:-}" ] \
	|| { echo "TRAVIS_BRANCH is empty or unset - a build that cannot tell which branch it is on would silently publish nothing" >&2; exit 1; }

# Every arm builds and tests. Declaring a `script:` key replaces the node_js language default, so if the
# suite is not named here it runs nowhere.
./build.sh
# After build.sh, which installs the tree biome comes from, and before the suite: a formatting or lint
# violation is the cheapest failure available here, and reporting it after a deploy wastes the job.
./lint.sh
./test.sh

if [ "${TRAVIS_BRANCH}" != "master" ]; then
	echo "BRANCH BUILD - no image published"
	exit 0
fi

# Both checked here rather than at the top: a branch build reaches neither the tag nor the deploy
# decision, so refusing it for either would reject a run that never needed the value. This is still
# before the first side effect that outlives the build.
is_positive_integer "${TRAVIS_BUILD_NUMBER:-}" \
	|| { echo "TRAVIS_BUILD_NUMBER is '${TRAVIS_BUILD_NUMBER:-}' - it is the image tag, and a build cannot publish one it cannot name" >&2; exit 1; }

# A pull-request build reports the branch it TARGETS, not the branch it comes from, so a pull request
# into the default branch is what identifies "about to be merged" - and that is what gets sys.
#
# Decided immediately above its only consumer. Held apart from it, an added arm that forgot to set the
# variable would default to the non-deploy path and publish silently.
#
# ENVIRONMENT is decided in the same place for the same reason, and exported for emit-service-sbom.sh,
# which files each image's document in that environment's store. A master build's image is the only
# one prod is deployed from, so its document goes to prod's store at publication: prod is deployed by
# hand, and the store keys an image by the digest this push fixes, so nothing the deploy adds is needed.
case "${TRAVIS_PULL_REQUEST:-}" in
	false)
		DEPLOY_SYS=no
		export ENVIRONMENT=prod
		;;
	*)
		is_positive_integer "${TRAVIS_PULL_REQUEST:-}" \
			|| { echo "TRAVIS_PULL_REQUEST is '${TRAVIS_PULL_REQUEST:-}' - neither 'false' nor a pull-request number, so refusing rather than guessing whether to deploy" >&2; exit 1; }
		DEPLOY_SYS=yes
		export ENVIRONMENT=sys
		;;
esac

# What built the artefact, recorded in its SBOM as provenance. The image is built on the CI VM rather
# than in a build image, so the honest value is the VM image Travis was asked for. Required rather than
# defaulted, and checked before the first push, so a publish never outruns its document.
[ -n "${TRAVIS_DIST:-}" ] \
	|| { echo "TRAVIS_DIST is not set - cannot record what built the artefact" >&2; exit 1; }
export CI_BUILD_ENV="travis-dist:${TRAVIS_DIST}"

# The image is tagged by build number and nothing else. A tag derived from the branch name cannot be
# formed for a branch containing '/', which docker rejects outright.
./build-dockers.sh
./push-dockers.sh

if [ "$DEPLOY_SYS" = yes ]; then
	echo "PR BUILD - deploying sys"
	./deploy.sh sys "$TRAVIS_BUILD_NUMBER"
else
	# Prod is deployed by hand: its target-group arrangement differs from sys, so a prod deploy is a
	# cutover rather than a like-for-like release. deploy.sh refuses a prod image with no document in
	# prod's store, which is what makes the emit below a precondition of shipping rather than a hope.
	echo "MASTER BUILD - image published; prod is deployed by hand"
fi

# Last, so a failure to document the artefact cannot hold up shipping it to sys - but still under set -e,
# because an evidence store with silent gaps is worse than a red build.
#
# On a pull request Travis builds an ephemeral merge commit that ceases to exist once the branch merges,
# so the pull request's own head is recorded instead - the one of the two that can still be dereferenced.
./emit-service-sbom.sh "$TRAVIS_BUILD_NUMBER" "${TRAVIS_PULL_REQUEST_SHA:-$TRAVIS_COMMIT}"
