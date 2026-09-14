"use strict";

var deviceRepository = require('./repositories/cloudDeviceRepository');
var cloudDeviceManager = require('./cloudDeviceManager');
var cloudProductDescriptorManager = require('./cloudProductDescriptorManager');
var async = require('async');
var _ = require('underscore');

module.exports.unpublish = function removeProductDescriptorAndDevices(productDescriptorId, callback) {
    async.waterfall([
        function findExistingDevices(iterCallback) {
            deviceRepository.filterByProductDescriptorId(productDescriptorId, function (err, data) {
                if (err) {
                    iterCallback(err);
                } else if (data) {
                    iterCallback(null, data);
                } else {
                    iterCallback(null, []);
                }
            });
        },
        function removeExistingDevices(devices, iterCallback) {
            // Bounded. Paging to exhaustion raised the largest descriptor group from roughly 749
            // devices to 1,571, each doing a read and a delete, and the SDK's default agent keeps
            // 50 sockets - an unbounded fan-out here turns a large group into connection timeouts.
            async.eachLimit(_.pluck(devices, 'serialNumber'), 10, function removeCloudDevice(serialNumber, jterCallback) {
                cloudDeviceManager.remove(productDescriptorId, serialNumber, jterCallback);
            }, function (err) {
                if (err) {
                    iterCallback(err);
                } else {
                    iterCallback();
                }
            });
        },
        function removeProductDescriptor(iterCallback) {
            cloudProductDescriptorManager.remove(productDescriptorId, iterCallback);
        }
    ], function (err) {
        if (err) {
            callback(err);
        } else {
            callback(null, true);
        }
    });
};