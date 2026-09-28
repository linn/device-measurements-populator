#!/bin/bash
#
# Deploys the populator's ECS service for one environment.
#
# Takes the environment and image tag as arguments and reads no CI variables of its own - scripts/ci.sh
# owns that translation, so this file is the same whether CI or a human invokes it.
#
set -e
cd "${0%/*}" # ensure cwd is script dir

cd ../aws

if [ $# -gt 3 ]; then
  echo "deploy.sh: too many arguments - usage: deploy.sh <sys|prod> <build-number> [--review]" >&2
  exit 64
fi

ENVIRONMENT="${1:?environment required (sys or prod)}"
DOCKER_TAG="${2:?docker tag required}"
# --review creates the change set and stops, so what a deploy would replace can be read before it runs.
MODE="${3:-}"

case "$DOCKER_TAG" in
  ''|*[!0-9]*|0*)
    echo "deploy.sh: docker tag '$DOCKER_TAG' is not a build number" >&2
    exit 64
    ;;
esac
case "$MODE" in
  ''|--review) ;;
  *)
    echo "deploy.sh: unknown option '$MODE' (only --review)" >&2
    exit 64
    ;;
esac

# CI deploys sys only (scripts/ci.sh); prod is run by hand. Prod is not a like-for-like release of sys:
# its first deploy of this template is a cutover, and the order it has to go in is in README.md
# (background: https://github.com/linn/device-measurements-populator/issues/12).
#
# CLUSTER is the NAME of the SSM parameter holding the cluster name - the template's targetCluster is
# AWS::SSM::Parameter::Value<String> - which linn-api-infrastructure publishes per environment.
case "$ENVIRONMENT" in
  sys)
    STACK_NAME=deviceMeasurementPopulator-sys
    CLUSTER=LinnApiClusterName-sys
    DEVICES_TABLE=linn.cloud.devices.int
    PRODUCT_DESCRIPTORS_TABLE=linn.cloud.product-descriptors.int
    PRODUCT_DESCRIPTORS_TABLE_INDEX=linn.cloud.product-descriptors.int.index
    EXPIRE_FILE_DATA_TABLE=linn.cloud.expire-s3-objects.int
    DEVICE_FILE_DATA_BUCKET=linn.cloud.filedata.int
    TARGET_GROUP_ARN_EXPORT=measurements-populator-target-group-arn-sys
    # sys has no load balancer to be moved off, so it registers with one target group. Stated
    # explicitly on every deploy, never omitted: `aws cloudformation deploy` sends UsePreviousValue for
    # a parameter it is not given, so omitting this would retain whatever the stack last held.
    LEGACY_TARGET_GROUP_ARN=none
    ;;
  prod)
    # The stack created by hand in 2016. Its name is the live value, not the naming convention: any
    # other name would create a second service beside this one, which the existence check below refuses.
    # The service moves off the 2016 stack's production-cluster-v2 onto the estate cluster as it is
    # replaced (see README.md).
    STACK_NAME=deviceMeasurementPopulator
    CLUSTER=LinnApiClusterName-prod
    DEVICES_TABLE=linn.cloud.devices
    PRODUCT_DESCRIPTORS_TABLE=linn.cloud.product-descriptors
    PRODUCT_DESCRIPTORS_TABLE_INDEX=linn.cloud.product-descriptors.index
    EXPIRE_FILE_DATA_TABLE=linn.cloud.expire-s3-objects
    DEVICE_FILE_DATA_BUCKET=linn.cloud.filedata
    TARGET_GROUP_ARN_EXPORT=measurements-populator-target-group-arn
    # Dual-homed until every caller has moved off ecs-internal: this is the hand-built target group the
    # 2016 service is registered with, which those callers reach. Set it to none only as the last step
    # of the cutover.
    LEGACY_TARGET_GROUP_ARN=arn:aws:elasticloadbalancing:eu-west-1:545349016803:targetgroup/populator-temp/5426317c060e0e14
    ;;
  *)
    echo "deploy.sh: '$ENVIRONMENT' is not deployable from here; only sys and prod are." >&2
    exit 64
    ;;
esac

if [ "$ENVIRONMENT" = prod ]; then
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null \
    || { echo "deploy.sh: could not read prod stack $STACK_NAME (missing, or no access) - refusing to deploy, so a new one is never created" >&2; exit 1; }
fi

if [ "$MODE" = --review ]; then
  EXECUTE=--no-execute-changeset
  echo "Creating a change set for $STACK_NAME (image tag $DOCKER_TAG), NOT executing it..."
else
  EXECUTE=
  echo "Deploying $STACK_NAME (image tag $DOCKER_TAG)..."
fi

aws cloudformation deploy \
  --stack-name="$STACK_NAME" \
  --template-file=./deviceMeasurementsPopulatorCloudFormation.yaml \
  --capabilities=CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  ${EXECUTE:+"$EXECUTE"} \
  --parameter-overrides \
      dockerTag="$DOCKER_TAG" \
      targetCluster="$CLUSTER" \
      albTargetGroupArnExport="$TARGET_GROUP_ARN_EXPORT" \
      legacyAlbTargetGroupArn="$LEGACY_TARGET_GROUP_ARN" \
      devicesTableName="$DEVICES_TABLE" \
      productDescriptorsTableName="$PRODUCT_DESCRIPTORS_TABLE" \
      productDescriptorsTableIndex="$PRODUCT_DESCRIPTORS_TABLE_INDEX" \
      expireFileDataTable="$EXPIRE_FILE_DATA_TABLE" \
      deviceFileDataBucket="$DEVICE_FILE_DATA_BUCKET" \
  --tags CIT=UI Project=device-measurements-populator environment="$ENVIRONMENT"
