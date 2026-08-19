#!/bin/bash
#
# Deploys the populator's ECS service for one environment.
#
# Takes the environment and image tag as arguments and reads no CI variables of its own — see
# scripts/ci.sh, which owns that translation.
#
set -e
cd "${0%/*}/.."

ENVIRONMENT="${1:?environment required (sys)}"
DOCKER_TAG="${2:?docker tag required}"

# sys only, deliberately. Prod is still deployed by hand, and its deploy is not a like-for-like
# redeploy: the live prod service is registered to the hand-built populator-temp target group on the
# unmanaged ecs-internal load balancer, while the target group this template now imports is
# measurements-populator on the app load balancer. Adding a prod arm here would make a routing
# migration look like a routine release. Two things to know when that migration is written:
#   - the prod stack is named deviceMeasurementPopulator with no suffix (created 2016); renaming it
#     creates a second service rather than moving this one
#   - load-balancers/app.yaml in linn/aws-infrastructure exports the prod target group ARN as
#     measurements-populator-target-group-arn with NO environment suffix, unlike its -sys and -int
#     counterparts and unlike every other export in that file
case "$ENVIRONMENT" in
  sys)
    STACK_NAME=deviceMeasurementPopulator-sys
    DEVICES_TABLE=linn.cloud.devices.int
    PRODUCT_DESCRIPTORS_TABLE=linn.cloud.product-descriptors.int
    PRODUCT_DESCRIPTORS_TABLE_INDEX=linn.cloud.product-descriptors.int.index
    EXPIRE_FILE_DATA_TABLE=linn.cloud.expire-s3-objects.int
    DEVICE_FILE_DATA_BUCKET=linn.cloud.filedata.int
    TARGET_GROUP_ARN_EXPORT=measurements-populator-target-group-arn-sys
    ;;
  *)
    echo "deploy.sh: '$ENVIRONMENT' is not deployable from CI; only sys is." >&2
    exit 64
    ;;
esac

echo "Deploying $STACK_NAME (image tag $DOCKER_TAG)..."

aws cloudformation deploy \
  --stack-name="$STACK_NAME" \
  --template-file=./ContinuousIntegration/CloudFormation/deviceMeasurementsPopulatorCloudFormation.yaml \
  --capabilities=CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
      dockerTag="$DOCKER_TAG" \
      targetCluster="LinnApiClusterName-$ENVIRONMENT" \
      albTargetGroupArnExport="$TARGET_GROUP_ARN_EXPORT" \
      devicesTableName="$DEVICES_TABLE" \
      productDescriptorsTableName="$PRODUCT_DESCRIPTORS_TABLE" \
      productDescriptorsTableIndex="$PRODUCT_DESCRIPTORS_TABLE_INDEX" \
      expireFileDataTable="$EXPIRE_FILE_DATA_TABLE" \
      deviceFileDataBucket="$DEVICE_FILE_DATA_BUCKET" \
  --tags CIT=UI Project=device-measurements-populator environment="$ENVIRONMENT"
