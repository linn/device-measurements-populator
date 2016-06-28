"use strict";

var productDescriptorRepository = require('./repositories/cloudProductDescriptorRepository');

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

module.exports.remove = function remove(productDescriptorId, callback) {
    async.series({
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