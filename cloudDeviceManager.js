"use strict";

var deviceRepository = require('./repositories/cloudDeviceRepository');
var fileDataRepository = require('./repositories/fileDataRepository');
var expireS3ObjectsRepository = require('./repositories/expireS3ObjectsRepository');

var cloudComponentProcessor = require('./cloudComponentProcessor');
var async = require('async');
var _ = require('underscore');
var helpers = require('./helpers');

function addToDeviceRepository(deviceResource, callback) {
    deviceRepository.addOrReplace(deviceResource, function(err) {
        if (err) {
            callback(err);
        } else {
            callback(null, deviceResource);
        }
    });
}

module.exports.add = function add(productDescriptorId, serialNumber, updateCloudDeviceResource, callback) {
    if (!updateCloudDeviceResource.components) {
        callback(new Error("Cloud Device Missing Components"));
    } else {
        async.waterfall([
            function (iterCallback) {
                remove(productDescriptorId, serialNumber, iterCallback);
            },
            function (iterCallback) {
                async.map(updateCloudDeviceResource.components, cloudComponentProcessor.processComponent, function (err, results) {
                    if (err) {
                        iterCallback(err);
                    } else {
                        addToDeviceRepository({
                            productDescriptorId: productDescriptorId,
                            serialNumber: serialNumber,
                            lastUpdate: updateCloudDeviceResource.lastUpdate,
                            components: results
                        }, iterCallback);
                    }
                });
            }
        ], callback);
    }
};

function remove(productDescriptorId, serialNumber, callback) {
    deviceRepository.findBy(productDescriptorId, serialNumber, function (err, data) {
        if (err) {
            callback(err);
        } else if (!data) {
            callback();
        } else {
            async.each(helpers.getS3FileIds(data.components), function deleteMeasurementFile(fileId, iterCallback) {
                expireS3ObjectsRepository.scheduleForExpirationById(fileId, iterCallback);
            }, function deleteCloudDevice(err) {
                if (err) {
                    callback(err);
                } else {
                    deviceRepository.removeBy(productDescriptorId, serialNumber, callback);
                }
            });
        }
    });
}
module.exports.remove = remove;