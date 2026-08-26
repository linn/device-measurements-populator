# shellcheck shell=bash
# shellcheck disable=SC2034
#
# No shebang: this file is sourced, never executed, and a shebang would invite someone to run it.
# The disable above covers "appears unused" - every value here is consumed by the scripts that source
# it, which the linter cannot see from this file alone.
#
# What this repository produces, declared once, so that a consumer cannot be taught a different set of
# artefacts from the one that is pushed.
#
# Deliberately free of CI variables and of anything about HOW the artefacts are built - no build image,
# no tag, no environment. Those belong to whatever drives the build and change when it does; this file
# states what the repository produces, which does not.
#
# Sourced rather than executed: it must not assume a working directory, and every consumer resolves it
# relative to its own location.

# Every image this repository publishes, mapped to the directory that produces it - a path relative to
# this file. The image name is spelled out in full rather than composed from a prefix, because no
# composition rule fits the estate: some repositories publish several images suffixed by service, and
# others publish exactly one named after the repository itself.
declare -A SERVICE_IMAGES
SERVICE_IMAGES=( [linn/device-measurements-populator]=.. )

# The source repository these artefacts come from, as the bare repo name.
SOURCE_REPO=device-measurements-populator

# SBOM_CRA_SCOPE is deliberately absent: this repository runs no SBOM emitter. The populator is an
# offline factory tool with no device depending on it at runtime, so it sits outside the CRA cloud SBOM
# boundary and outside the emit-membership register. Wiring an emitter in later means adding the
# assertion here - the emitter has no default and refuses without it, which is the intended behaviour.
