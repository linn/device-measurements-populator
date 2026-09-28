#!/bin/bash
#
# Emit a CycloneDX SBOM for each pushed service image and upload it to the environment's artefact
# store. Must run AFTER the images are pushed - the store keys an image document by its repo digest.
#
# Usage: emit-service-sbom.sh <docker-tag> <commit-sha>
# Caller supplies $ENVIRONMENT and $CI_BUILD_ENV.
#
# shellcheck source-path=SCRIPTDIR
set -e

# dirname of BASH_SOURCE, not ${0%/*}: the latter yields the script NAME when $0 has no slash, so the
# cd silently lands somewhere else.
cd "$(dirname "${BASH_SOURCE[0]}")"

[ $# -eq 2 ] || { echo "usage: emit-service-sbom.sh <docker-tag> <commit-sha>" >&2; exit 2; }
DOCKER_TAG="$1"
COMMIT_SHA="$2"

[ -n "${ENVIRONMENT:-}" ] || { echo "ENVIRONMENT is not set - cannot choose an SBOM store" >&2; exit 1; }

SBOM_BUCKET=linn-api-infrastructure-$ENVIRONMENT-sbom-store

# Required rather than defaulted: 'unknown' in a provenance field is a document quietly saying less
# than it should.
[ -n "${CI_BUILD_ENV:-}" ] || { echo "CI_BUILD_ENV is not set - cannot record what built the artefact" >&2; exit 1; }

WORK_DIR=$(mktemp -d)
CONTAINER_ID=""

cleanup() {
	if [ -n "$CONTAINER_ID" ]; then
		docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
	fi
	rm -rf "$WORK_DIR"
}
# Only EXIT cleans up. A bash signal handler RESUMES the script when it returns, so cleaning from
# INT/TERM would delete the work dir and carry on - and a build cancelled after the last upload would
# fall off the end reporting SUCCESS. These convert the signal into an exit, which runs EXIT once.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

. ./artefacts.sh
. ./sbom-pin.sh

[ -n "${SBOM_TOOL_IMAGE:-}" ] \
	|| { echo "sbom-pin.sh did not set SBOM_TOOL_IMAGE - refusing to guess which emitter produced this document" >&2; exit 1; }

[ ${#SERVICE_IMAGES[@]} -gt 0 ] || { echo "artefacts.sh declares no images - nothing to document" >&2; exit 1; }

for IMAGE_NAME in "${!SERVICE_IMAGES[@]}"; do
	IMAGE=$IMAGE_NAME:$DOCKER_TAG
	DOC=$WORK_DIR/${IMAGE_NAME##*/}.cdx.json

	echo "Emitting SBOM for $IMAGE..."

	# docker cp, not a bind mount. Where this runs inside a build container with the host's docker
	# socket mounted, a -v source is resolved by the HOST daemon: a path that exists here names a
	# different, empty directory over there, so the document is written where nobody can see it.
	CONTAINER_ID=$(docker create \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-e SBOM_COMMIT_SHA="$COMMIT_SHA" \
		-e SBOM_ARTEFACT_REF="$IMAGE" \
		-e SBOM_REPO="$SOURCE_REPO" \
		-e SBOM_ARTEFACT_CLASS=image \
		-e SBOM_CRA_SCOPE="$SBOM_CRA_SCOPE" \
		-e SBOM_BUILDER_IMAGE="$CI_BUILD_ENV" \
		"$SBOM_TOOL_IMAGE" emit-sbom.sh "docker:$IMAGE" /tmp/sbom.cdx.json)

	# The emitter prints the store key on stdout and nothing else; --attach proxies its exit status.
	STORE_KEY=$(docker start --attach "$CONTAINER_ID")

	docker cp "$CONTAINER_ID:/tmp/sbom.cdx.json" "$DOC"

	# || true: the document is already out of the container, and aborting here would lose it and skip
	# every image after it. The EXIT trap force-removes anything left behind.
	docker rm "$CONTAINER_ID" >/dev/null 2>&1 || true
	CONTAINER_ID=""

	# Both failures are SILENT. An empty key makes the destination end in '/', which aws s3 cp reads
	# as a prefix - uploading to the bucket root under the local filename, exit 0, where no consumer
	# looks. An empty document uploads just as cleanly.
	[ -n "$STORE_KEY" ] || { echo "emit produced no store key for $IMAGE" >&2; exit 1; }
	[ -s "$DOC" ] || { echo "no document retrieved for $IMAGE" >&2; exit 1; }

	aws s3 cp "$DOC" "s3://$SBOM_BUCKET/$STORE_KEY"

	echo "Emitted SBOM for $IMAGE to s3://$SBOM_BUCKET/$STORE_KEY"
done
