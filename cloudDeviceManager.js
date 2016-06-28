"use strict";

var deviceRepository = require('./repositories/cloudDeviceRepository');

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
            deviceRepository.removeBy(productDescriptorId, serialNumber, callback);
        }
    });
}
module.exports.remove = remove;