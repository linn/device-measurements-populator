#!/bin/bash

BRANCH=${1}
TARGET_HOST=${2}
PACKAGE_NAME="device-measurements-populator"-${BRANCH}

echo "*************************************"
echo "*"
echo "* Branch        : ${BRANCH}"
echo "* Target Host   : ${TARGET_HOST}"
echo "*"
echo "*************************************"

echo "update the service files"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo apt-get update"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo apt-get install ${PACKAGE_NAME}"

echo "Starting Service"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo /etc/init.d/device-measurements-populator start"