#!/bin/bash

SYSROOT=deb-src/sysroot
TARGET_DIR=${SYSROOT}/opt/linn/device-measurements-populator
DEBIAN=deb-src/DEBIAN

CONFIGURATION=${1}
BRANCH=${2}
BUILD_NUMBER=${3}
PRODUCTION_RELEASE=${4}

GIT_COMMIT=`git show-ref origin/${BRANCH} | grep remotes | cut -d ' ' -f 1`
TIMESTAMP=`date --utc +%FT%TZ`
PACKAGE_NAME="device-measurements-populator"
PACKAGE_VERSION="0.${BUILD_NUMBER}"

if [ ${PRODUCTION_RELEASE} = true ]
	then
	PACKAGE_VERSION="1.${BUILD_NUMBER}"
fi

echo "*************************************"
echo "*"
echo "* Configuration : ${CONFIGURATION}"
echo "* Branch        : ${BRANCH}"
echo "* Build Number  : ${BUILD_NUMBER}"
echo "* Git Commit    : ${GIT_COMMIT}"
echo "* Package Name  : ${PACKAGE_NAME}"
echo "* Package Ver   : ${PACKAGE_VERSION}"
echo "*"
echo "*************************************"

echo "Setup directories"
mkdir -p ${DEBIAN}
mkdir -p ${SYSROOT}
mkdir -p ${TARGET_DIR}
mkdir -p ${SYSROOT}/etc/init.d

# Get files for Deb file
echo "Packaging Template"
git archive --format=tar origin/${BRANCH} | tar --directory=${TARGET_DIR} -xf -

# Libs
echo "Downloading dependant libraries"
npm install
cp -Rpu node_modules ${TARGET_DIR}

# Create ping resources
echo "Creating ping resources"
echo "{ \"timeStamp\": \"${TIMESTAMP}\", \"config\": \"${CONFIGURATION}\", \"branch\": \"${BRANCH}\", \"build\": \"${BUILD_NUMBER}\", \"commit\": \"${GIT_COMMIT}\" }" > ${TARGET_DIR}/ping.json

echo "Copying Init Script"

git archive --format=tar origin/${BRANCH}:ContinuousIntegration/Package/init.d device-measurements-populator | tar --directory=${SYSROOT}/etc/init.d/ -xf -
chmod +x ${SYSROOT}/etc/init.d/device-measurements-populator

echo "Create preinst file"
echo "if [ -e /etc/init.d/device-measurements-populator ]" >> ${DEBIAN}/preinst
echo "then" >> ${DEBIAN}/preinst
echo "/etc/init.d/device-measurements-populator stop" >> ${DEBIAN}/preinst
echo "fi" >> ${DEBIAN}/preinst

echo "Copy preinst file to prerm to stop service when uninstalling"
cp ${DEBIAN}/preinst ${DEBIAN}/prerm

echo "Create postinst file"
echo "adduser --system --group device-measurements-populator" > ${DEBIAN}/postinst

echo "Make control file"
echo "Package: ${PACKAGE_NAME}" > ${DEBIAN}/control
echo "Version: ${PACKAGE_VERSION}" >> ${DEBIAN}/control
echo "Section: base" >> ${DEBIAN}/control
echo "Priority: optional" >> ${DEBIAN}/control
echo "Architecture: amd64" >> ${DEBIAN}/control
INSTALLED_SIZE=`du -s ${SYSROOT}`
echo "Installed-Size: ${INSTALLED_SIZE}" >> ${DEBIAN}/control
echo "Depends: nodejs (>= 4.0)" >> ${DEBIAN}/control
echo "Maintainer: IT  <it.developers@linn.co.uk>" >> ${DEBIAN}/control
echo "Description: Device measurements populator service" >> ${DEBIAN}/control

echo "Creating deb package"
pushd deb-src/

pushd sysroot/
fakeroot -- tar czf ../data.tar.gz *
popd

pushd DEBIAN/
fakeroot -- tar czf ../control.tar.gz *
popd

echo 2.0 > debian-binary
fakeroot -- ar r ../${PACKAGE_NAME}-${PACKAGE_VERSION}-${CONFIGURATION}.deb debian-binary control.tar.gz data.tar.gz
popd