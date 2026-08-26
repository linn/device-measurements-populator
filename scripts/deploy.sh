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

ENVIRONMENT="${1:?environment required (sys)}"
DOCKER_TAG="${2:?docker tag required}"

# sys only. Prod's target-group arrangement is not the same as sys's, so deploying prod is a cutover
# with a sequence to it rather than a like-for-like release; an arm here would make the two look
# interchangeable. What prod needs is recorded on
# https://github.com/linn/device-measurements-populator/issues/12
case "$ENVIRONMENT" in
  sys)
    STACK_NAME=deviceMeasurementPopulator-sys
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
  *)
    echo "deploy.sh: '$ENVIRONMENT' is not deployable from here; only sys is." >&2
    exit 64
    ;;
esac

echo "Deploying $STACK_NAME (image tag $DOCKER_TAG)..."

aws cloudformation deploy \
  --stack-name="$STACK_NAME" \
  --template-file=./deviceMeasurementsPopulatorCloudFormation.yaml \
  --capabilities=CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
      dockerTag="$DOCKER_TAG" \
      targetCluster="LinnApiClusterName-$ENVIRONMENT" \
      albTargetGroupArnExport="$TARGET_GROUP_ARN_EXPORT" \
      legacyAlbTargetGroupArn="$LEGACY_TARGET_GROUP_ARN" \
      devicesTableName="$DEVICES_TABLE" \
      productDescriptorsTableName="$PRODUCT_DESCRIPTORS_TABLE" \
      productDescriptorsTableIndex="$PRODUCT_DESCRIPTORS_TABLE_INDEX" \
      expireFileDataTable="$EXPIRE_FILE_DATA_TABLE" \
      deviceFileDataBucket="$DEVICE_FILE_DATA_BUCKET" \
  --tags CIT=UI Project=device-measurements-populator environment="$ENVIRONMENT"
