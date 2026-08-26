#!/bin/bash
#
# End-to-end check of the measurement pipeline against a deployed environment: publish a throwaway
# product descriptor and one device's measurements through THIS service, read them back through
# device-measurements-api, then remove both and prove they are gone.
#
# Usage:
#   smoke-test.sh --target sys
#   smoke-test.sh --target prod-dual --yes-write-to-prod
#   smoke-test.sh --env sys   --populator URL --measurements URL
#   smoke-test.sh --env prod  --populator URL --measurements URL --yes-write-to-prod
#
# --target names a known deployment and fills in the environment and both addresses:
#
#   sys        populator app-sys       -> measurements beta-cloud
#   prod-new   populator app           -> measurements cloud
#   prod-old   populator ecs-internal  -> measurements cloud
#   prod-dual  BOTH prod populators    -> measurements cloud   (the dual-homing check)
#
# It weakens no refusal: a prod target still requires --yes-write-to-prod. It cannot be combined with
# --env, and may be given once. Anything not listed above is refused rather than guessed at.
#
# Both --populator and --measurements are REPEATABLE. Every endpoint given is pinged and reported, a
# full publish/read/remove cycle runs through each populator, and each cycle is read back through every
# measurements endpoint. That is what makes this usable as the check on a dual-homed deployment: while
# the service is registered with two target groups on two load balancers, passing both addresses proves
# each one reaches a live instance, that they are serving the same build, and that a write through
# either is visible through either.
#
# WHAT IT WRITES, AND WHY IT IS SAFE TO RUN AGAINST PRODUCTION
#
# One product descriptor and one device, under a vendor and product type generated per run and belonging
# to no real product, with a serial range narrowed to the single generated serial - so the descriptor
# cannot be selected for any real device even if a vendor name were somehow to collide. Both are removed
# before the script exits, including when a step fails part-way (see the trap below), and removal is
# verified rather than assumed.
#
# It publishes VALUE measurements only, never file measurements, and that is deliberate rather than
# incidental: nothing in this service deletes from the object store - `unpublish` removes devices and the
# descriptor from DynamoDB, and no code path calls the file repository's remove - so a file-bearing
# measurement would leave an object behind that this script could not clean up. Value-only keeps the
# cleanup complete.
#
# PRECONDITIONS: bash, curl and node on PATH. No AWS credentials, no docker, no network access beyond
# the two services. Both services must be reachable from where this runs; the populator has no
# authentication in front of it.
#
set -e

usage () {
	sed -n '2,/^set -e$/p' "$0" | sed 's/^# \{0,1\}//; $d'
	exit 64
}

ENVIRONMENT=
POPULATOR_URLS=
MEASUREMENTS_URLS=
PROD_ACKNOWLEDGED=no
KEEP=no
ENV_GIVEN=no
TARGET_GIVEN=

# The live routing, read from AWS rather than assembled from a naming convention - the two halves are
# not addressed the same way and cannot be derived from each other:
#
#   - the populator target groups sit on INTERNAL load balancers whose listener rules match on PATH
#     alone, so any name resolving to the load balancer reaches them;
#   - the measurements listener rules match on HOST HEADER, so those entries must be the hostname. An
#     ALB address substituted there resolves and connects and then does not match any rule.
#
# prod-old is the only one with no hostname: its load balancer is reached by the raw ELB DNS its caller
# hardcodes, and it listens on HTTP:80 only.
#
# There is deliberately no int target. No int measurements-api exists, so a publish through the int
# populator could not be read back and the run could not complete.
apply_target () {
	case "$1" in
		sys)
			ENVIRONMENT=sys
			POPULATOR_URLS="$POPULATOR_URLS https://app-sys.linn.co.uk"
			MEASUREMENTS_URLS="$MEASUREMENTS_URLS https://beta-cloud.linn.co.uk"
			;;
		prod-new)
			ENVIRONMENT=prod
			POPULATOR_URLS="$POPULATOR_URLS https://app.linn.co.uk"
			MEASUREMENTS_URLS="$MEASUREMENTS_URLS https://cloud.linn.co.uk"
			;;
		prod-old)
			ENVIRONMENT=prod
			POPULATOR_URLS="$POPULATOR_URLS http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com"
			MEASUREMENTS_URLS="$MEASUREMENTS_URLS https://cloud.linn.co.uk"
			;;
		prod-dual)
			ENVIRONMENT=prod
			POPULATOR_URLS="$POPULATOR_URLS https://app.linn.co.uk http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com"
			MEASUREMENTS_URLS="$MEASUREMENTS_URLS https://cloud.linn.co.uk"
			;;
		*)
			echo "--target '$1' is not a known deployment. Known: sys, prod-new, prod-old, prod-dual." >&2
			exit 64
			;;
	esac
}

while [ $# -gt 0 ]; do
	case "$1" in
		--env)          ENVIRONMENT="${2:?--env needs a value}"; ENV_GIVEN=yes; shift 2 ;;
		# Refused rather than merged: two targets would silently produce a four-endpoint run, and a
		# second one naming a different environment would leave whichever ran last deciding where the
		# writes land.
		--target)
			[ -z "$TARGET_GIVEN" ] \
				|| { echo "--target given twice ('$TARGET_GIVEN' then '${2:-}') - name one deployment, or use --populator/--measurements directly" >&2; exit 64; }
			TARGET_GIVEN="${2:?--target needs a value}"
			apply_target "$TARGET_GIVEN"
			shift 2
			;;
		--populator)    POPULATOR_URLS="$POPULATOR_URLS ${2:?--populator needs a URL}"; shift 2 ;;
		--measurements) MEASUREMENTS_URLS="$MEASUREMENTS_URLS ${2:?--measurements needs a URL}"; shift 2 ;;
		--yes-write-to-prod) PROD_ACKNOWLEDGED=yes; shift ;;
		# Leaves the descriptor and device in place, for inspecting what was written. Never the default,
		# and it reports what it left and how to remove it.
		--keep)         KEEP=yes; shift ;;
		-h|--help)      usage ;;
		*)              echo "unknown argument: $1" >&2; usage ;;
	esac
done

# After the loop rather than in it: checked in the --target arm alone, `--env prod --target sys` would
# pass while `--target sys --env prod` would not, and the two orders mean the same thing.
[ -n "$TARGET_GIVEN" ] && [ "$ENV_GIVEN" = yes ] \
	&& { echo "--target and --env cannot be combined - --target already states the environment" >&2; exit 64; }

case "$ENVIRONMENT" in
	sys) ;;
	prod)
		# The script cannot tell where a URL points, so the operator declares it and the flag is the
		# confirmation. Refusing here rather than trusting the hostname keeps a copy-pasted prod address
		# under --env sys from writing to production unremarked.
		[ "$PROD_ACKNOWLEDGED" = yes ] \
			|| { echo "this writes a throwaway descriptor and device to PRODUCTION. Re-run with --yes-write-to-prod if that is what you mean." >&2; exit 1; }
		;;
	*) echo "--env must be sys or prod (got '${ENVIRONMENT}')" >&2; usage ;;
esac

[ -n "$POPULATOR_URLS" ]    || { echo "at least one --populator URL is required" >&2; usage; }
[ -n "$MEASUREMENTS_URLS" ] || { echo "at least one --measurements URL is required" >&2; usage; }

for tool in curl node; do
	command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not on PATH" >&2; exit 1; }
done

# ---------------------------------------------------------------------------- identifiers for this run
#
# The descriptor id is generated here and never taken from an argument. DELETE on a product descriptor
# unpublishes it AND every device under it, so an id supplied from outside would make this script a way
# to remove a real product; the assertion before the delete is what makes that impossible rather than
# merely unlikely.
RUN_ID=$(node -e 'process.stdout.write(Date.now().toString(36) + "-" + require("crypto").randomBytes(4).toString("hex"))')
DESCRIPTOR_ID="smoke-$RUN_ID"
VENDOR="smoketest"
PRODUCT_TYPE="smoke-$RUN_ID"
# Numeric: the api parses a serial with parseInt to test it against the descriptor's range.
SERIAL_NUMBER=$(node -e 'process.stdout.write(String(900000000 + Math.floor(Math.random() * 99999999)))')

SPL_VALUE=42.5
FN_VALUE=25.25
COMPONENT_NAME="SmokeTestComponent"
MEASURED_ON="1970-01-01T00:00:00Z"

# What has actually been published, so the cleanup trap only removes what exists.
DESCRIPTOR_PUBLISHED=no
DEVICE_PUBLISHED=no
CLEANUP_FAILED=no
FAILURES=0

say ()  { printf '%s\n' "$*"; }
step () { printf '\n== %s\n' "$*"; }
ok ()   { printf '   ok    %s\n' "$*"; }
bad ()  { printf '   FAIL  %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

# Strips a trailing slash so a base URL is accepted with or without one.
base () { printf '%s' "${1%/}"; }

# ------------------------------------------------------------------------------------------- http
#
# Writes the body to $BODY_FILE and returns the status code on stdout, so a caller can assert on the
# status and then inspect the body. curl's own failures are not hidden behind -f: a status is what every
# caller here wants to compare, including the 404 that proves a delete worked.
BODY_FILE=$(mktemp)
request () {
	local method="$1" url="$2" payload="${3:-}"
	if [ -n "$payload" ]; then
		curl -sS -o "$BODY_FILE" -w '%{http_code}' \
			-X "$method" "$url" \
			-H 'Content-Type: application/json' \
			--data-binary "$payload" \
			--connect-timeout 15 --max-time 120 || printf 'curl-failed'
	else
		curl -sS -o "$BODY_FILE" -w '%{http_code}' \
			-X "$method" "$url" \
			--connect-timeout 15 --max-time 120 || printf 'curl-failed'
	fi
}

# Same, for a GET that has to negotiate a representation.
request_accepting () {
	curl -sS -o "$BODY_FILE" -w '%{http_code}' \
		"$1" -H "Accept: $2" \
		--connect-timeout 15 --max-time 120 || printf 'curl-failed'
}

# ------------------------------------------------------------------------------------------- payloads
#
# The link is what the service validates the URL against: it parses the id as everything after the last
# slash and requires it to equal the path parameter, so a descriptor cannot be published under an id its
# own body does not claim.
descriptor_payload () {
	cat <<EOF
{
  "vendor": "$VENDOR",
  "productType": "$PRODUCT_TYPE",
  "firstSerialNumber": $SERIAL_NUMBER,
  "lastSerialNumber": $SERIAL_NUMBER,
  "components": [
    {
      "componentName": "$COMPONENT_NAME",
      "measurements": {
        "fn": {
          "file": null,
          "value": {
            "measuredOn": "$MEASURED_ON",
            "sourceName": "SmokeTest",
            "sourceVersion": "1.0",
            "version": 2,
            "value": $FN_VALUE,
            "metadata": {}
          }
        }
      }
    }
  ],
  "links": [
    { "href": "/product-descriptors/$DESCRIPTOR_ID", "rel": "product-descriptor" }
  ]
}
EOF
}

device_payload () {
	cat <<EOF
{
  "serialNumber": "$SERIAL_NUMBER",
  "lastUpdate": "$MEASURED_ON",
  "components": [
    {
      "componentName": "$COMPONENT_NAME",
      "measurements": {
        "spl": {
          "file": null,
          "value": {
            "measuredOn": "$MEASURED_ON",
            "sourceName": "SmokeTest",
            "sourceVersion": "1.0",
            "version": 2,
            "value": $SPL_VALUE,
            "metadata": {}
          }
        }
      }
    }
  ],
  "links": [
    { "href": "/product-descriptors/$DESCRIPTOR_ID", "rel": "product-descriptor" }
  ]
}
EOF
}

# ------------------------------------------------------------------------------------------- cleanup
#
# Runs on every exit path, so a failure between publishing and reading back still removes what was
# written. Tolerant of its own failures - each removal is attempted whatever the previous one did - and
# it says what it could not remove, because a message naming the ids is the only way anyone will find
# them afterwards.
remove_published () {
	local populator="$1"

	if [ "$DEVICE_PUBLISHED" = yes ]; then
		local status
		status=$(request DELETE "$populator/cloud-devices/$DESCRIPTOR_ID/$SERIAL_NUMBER") || true
		if [ "$status" = "204" ]; then
			ok "device removed"
			DEVICE_PUBLISHED=no
		else
			bad "device NOT removed (status $status) - serial $SERIAL_NUMBER under descriptor $DESCRIPTOR_ID"
			CLEANUP_FAILED=yes
		fi
	fi

	if [ "$DESCRIPTOR_PUBLISHED" = yes ]; then
		# The guard that makes this safe against a supplied id. Unpublishing takes every device under the
		# descriptor with it, so it must be impossible to point at anything this run did not create.
		case "$DESCRIPTOR_ID" in
			smoke-*) ;;
			*)
				bad "refusing to unpublish '$DESCRIPTOR_ID': not an id this script generated"
				CLEANUP_FAILED=yes
				return
				;;
		esac
		local status
		status=$(request DELETE "$populator/cloud-product-descriptors/$DESCRIPTOR_ID") || true
		if [ "$status" = "204" ]; then
			ok "product descriptor removed"
			DESCRIPTOR_PUBLISHED=no
		else
			bad "product descriptor NOT removed (status $status) - id $DESCRIPTOR_ID"
			CLEANUP_FAILED=yes
		fi
	fi
}

CURRENT_POPULATOR=
# shellcheck disable=SC2329  # invoked by the EXIT trap below, which shellcheck cannot see
on_exit () {
	local rc=$?
	if [ "$KEEP" = yes ] && [ "$DESCRIPTOR_PUBLISHED" = yes ]; then
		say ""
		say "--keep: leaving descriptor $DESCRIPTOR_ID (vendor $VENDOR, productType $PRODUCT_TYPE, serial $SERIAL_NUMBER) in place."
		say "        Remove it with: curl -X DELETE $CURRENT_POPULATOR/cloud-product-descriptors/$DESCRIPTOR_ID"
	elif [ "$DESCRIPTOR_PUBLISHED" = yes ] || [ "$DEVICE_PUBLISHED" = yes ]; then
		step "cleaning up after an incomplete run"
		remove_published "$CURRENT_POPULATOR"
	fi
	rm -f "$BODY_FILE"
	if [ "$CLEANUP_FAILED" = yes ]; then
		say ""
		say "*** DATA WAS LEFT BEHIND. descriptor=$DESCRIPTOR_ID vendor=$VENDOR productType=$PRODUCT_TYPE serial=$SERIAL_NUMBER"
		exit 1
	fi
	exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ------------------------------------------------------------------------------- phase 1: reachability
#
# Every endpoint, before anything is written. /ping carries the build number the running image was built
# from, which is what turns "both addresses answered" into "both addresses reach the same deployment" -
# the question a dual-homed cutover actually needs answered.
step "reachability and build identity"
BUILDS=
for url in $POPULATOR_URLS $MEASUREMENTS_URLS; do
	url=$(base "$url")
	status=$(request GET "$url/ping")
	if [ "$status" = "200" ]; then
		build=$(node -e '
			let raw = "";
			try { raw = require("fs").readFileSync(process.argv[1], "utf8"); } catch (e) { process.stdout.write("unreadable"); process.exit(0); }
			try {
				const ping = JSON.parse(raw);
				process.stdout.write(String(ping.build || "unstamped") + " (" + String(ping.commit || "no commit").slice(0, 12) + ")");
			} catch (e) { process.stdout.write("unparseable"); }
		' "$BODY_FILE")
		ok "$url -> build $build"
		BUILDS="$BUILDS $(printf '%s' "$build" | cut -d' ' -f1)"
	else
		bad "$url/ping -> $status"
	fi
done

if [ "$FAILURES" -gt 0 ]; then
	say ""
	say "Not every endpoint answered, so nothing has been written. Fix reachability first."
	exit 1
fi

DISTINCT_BUILDS=$(printf '%s' "$BUILDS" | tr ' ' '\n' | grep -v '^$' | sort -u | wc -l | tr -d ' ')
if [ "$DISTINCT_BUILDS" -gt 1 ]; then
	say ""
	say "   NOTE  the endpoints are serving $DISTINCT_BUILDS different builds. Expected while a deployment is"
	say "         in flight or when comparing two load balancers mid-cutover; not expected otherwise."
fi

# ------------------------------------------------------------- phase 2: publish, read back, remove
for populator in $POPULATOR_URLS; do
	populator=$(base "$populator")
	CURRENT_POPULATOR="$populator"

	step "publishing through $populator"
	say "   descriptor $DESCRIPTOR_ID  vendor $VENDOR  productType $PRODUCT_TYPE  serial $SERIAL_NUMBER"

	status=$(request PUT "$populator/cloud-product-descriptors/$DESCRIPTOR_ID" "$(descriptor_payload)")
	if [ "$status" = "200" ]; then
		DESCRIPTOR_PUBLISHED=yes
		ok "product descriptor published"
	else
		bad "publishing the product descriptor -> $status"
		say "        $(head -c 300 "$BODY_FILE")"
		break
	fi

	status=$(request PUT "$populator/cloud-devices/$DESCRIPTOR_ID/$SERIAL_NUMBER" "$(device_payload)")
	if [ "$status" = "200" ]; then
		DEVICE_PUBLISHED=yes
		ok "device measurements published"
	else
		bad "publishing the device -> $status"
		say "        $(head -c 300 "$BODY_FILE")"
		break
	fi

	for measurements in $MEASUREMENTS_URLS; do
		measurements=$(base "$measurements")
		read_url="$measurements/device-measurements/$VENDOR/$PRODUCT_TYPE/$SERIAL_NUMBER"

		step "reading back through $measurements"

		status=$(request_accepting "$read_url" 'application/vnd.linn.device-measurements+json; version=4')
		if [ "$status" = "200" ]; then
			ok "json representation served"
			# Asserts the measurement made the round trip, not merely that something did. The device's spl
			# and the descriptor's fn come from different writes, so finding both proves the api combined
			# them rather than serving one of the two.
			if verdict=$(node -e '
				const fs = require("fs");
				const [file, serial, component, spl, fn] = process.argv.slice(1);
				let doc;
				try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
				catch (e) { console.log("unparseable json: " + e.message); process.exit(1); }
				const found = JSON.stringify(doc);
				const problems = [];
				if (!found.includes(serial)) { problems.push("serial " + serial + " absent"); }
				if (!found.includes(component)) { problems.push("component " + component + " absent"); }
				if (!found.includes(spl)) { problems.push("device spl value " + spl + " absent"); }
				if (!found.includes(fn)) { problems.push("descriptor fn value " + fn + " absent"); }
				if (problems.length) { console.log(problems.join("; ")); process.exit(1); }
				console.log("serial, component, and both measurement values present");
			' "$BODY_FILE" "$SERIAL_NUMBER" "$COMPONENT_NAME" "$SPL_VALUE" "$FN_VALUE"); then
				ok "$verdict"
			else
				bad "json round trip: $verdict"
			fi
		else
			bad "json read back -> $status"
			say "        $(head -c 300 "$BODY_FILE")"
		fi

		# The xml representation is what devices consume, so a check that only exercised json would pass
		# with the device-facing contract broken.
		status=$(request_accepting "$read_url" 'application/vnd.linn.device-measurements+xml; version=4')
		if [ "$status" = "200" ]; then
			if grep -q "$SERIAL_NUMBER" "$BODY_FILE"; then
				ok "xml representation served, and carries the serial"
			else
				bad "xml representation served but does not carry serial $SERIAL_NUMBER"
			fi
		else
			bad "xml read back -> $status"
		fi
	done

	# --keep is honoured HERE and not only in the exit trap: the trap runs after this, so removing
	# unconditionally would mean the flag never kept anything.
	if [ "$KEEP" = yes ]; then
		step "leaving what this run published in place (--keep)"
		break
	fi

	step "removing what this run published"
	remove_published "$populator"

	# Proving the removal, rather than trusting a 204. The descriptor is what the api selects on, so its
	# absence is what makes the measurements unreachable.
	for measurements in $MEASUREMENTS_URLS; do
		measurements=$(base "$measurements")
		status=$(request GET "$measurements/device-measurements/$VENDOR/$PRODUCT_TYPE/$SERIAL_NUMBER")
		if [ "$status" = "404" ]; then
			ok "gone from $measurements (404)"
		else
			bad "still readable from $measurements after removal (status $status)"
		fi
	done
done

step "result"
if [ "$FAILURES" -eq 0 ]; then
	say "   $ENVIRONMENT: published, read back and removed cleanly."
	exit 0
fi
say "   $ENVIRONMENT: $FAILURES check(s) failed."
exit 1
