#!/bin/bash

CONFIGURATION=${1}
START_POPULATOR=${2}
TARGET_HOST=${3}
PACKAGE_NAME="device-measurements-populator"

echo "*************************************"
echo "*"
echo "* Configuration : ${CONFIGURATION}"
echo "* Target Host   : ${TARGET_HOST}"
echo "* Populator     : ${START_POPULATOR}"
echo "*"
echo "*************************************"

echo "update the service files"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo apt-get update"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo apt-get install ${PACKAGE_NAME}"

echo "Starting Service"
ssh -oStrictHostKeyChecking=no linn-service@${TARGET_HOST} "sudo /etc/init.d/device-measurements-populator start"