"use strict";

var productDescriptorRepository = require('./repositories/cloudProductDescriptorRepository');
var fileDataRepository = require('./repositories/fileDataRepository');
var expireS3ObjectsRepository = require('./repositories/expireS3ObjectsRepository');

var cloudComponentProcessor = require('./cloudComponentProcessor');
var async = require('async');
var _ = require('underscore');
var helpers = require('./helpers');

function addToProductDescriptorRepository(productDescriptorResource, callback) {
    productDescriptorRepository.addOrReplace(productDescriptorResource, function(err) {
        if (err) {
            callback(err);
        } else {
            callback(null, productDescriptorResource);
        }
    });
}

function cleanupOldProductDescriptorFiles(productDescriptorId) {
    return function (iterCallback) {
        productDescriptorRepository.findBy(productDescriptorId, function (err, data) {
            if (err) {
                iterCallback(err);
            } else {
                if (data) {
                    async.each(helpers.getS3FileIds(data.components), expireS3ObjectsRepository.scheduleForExpirationById, iterCallback);
                } else {
                    iterCallback();
                }
            }
        });
    };
}

module.exports.remove = function remove(productDescriptorId, callback) {
    async.series({
        cleanupOldProductDescriptorFiles: cleanupOldProductDescriptorFiles(productDescriptorId),
        deleteProductDescriptor: function (iterCallback) {
            productDescriptorRepository.removeBy(productDescriptorId, iterCallback);
        }
    }, function (err) {
        if (err) {
            callback(err);
        } else {
            callback();
        }
    });
};

module.exports.add = function add(productDescriptorId, updateCloudProductDescriptorResource, callback) {
    if (!updateCloudProductDescriptorResource.components) {
        callback(new Error('Cloud Product Descriptor Missing Components'));
    } else {
        async.series({
            cleanupOldProductDescriptorFiles: cleanupOldProductDescriptorFiles(productDescriptorId),
            uploadNewProductDescriptor: function (iterCallback) {
                async.map(updateCloudProductDescriptorResource.components, cloudComponentProcessor.processComponent, function (err, results) {
                    if (err) {
                        iterCallback(err);
                    } else {
                        addToProductDescriptorRepository({
                            id: productDescriptorId,
                            vendor: updateCloudProductDescriptorResource.vendor,
                            productType: updateCloudProductDescriptorResource.productType,
                            firstSerialNumber: updateCloudProductDescriptorResource.firstSerialNumber,
                            lastSerialNumber: updateCloudProductDescriptorResource.lastSerialNumber,
                            components: results
                        }, iterCallback);
                    }
                });
            }
        }, function (err, results) {
            if (err) {
                callback(err);
            } else {
                callback(null, results.uploadNewProductDescriptor);
            }
        });
    }
};