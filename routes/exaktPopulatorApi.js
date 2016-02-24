"use strict";

var cloudProductDescriptorManager = require('../cloudProductDescriptorManager');
var cloudDeviceManager = require('../cloudDeviceManager');
var unpublishService = require('../unpublishService');
var helpers = require('../helpers');
var _ = require('underscore');

function parseProductDescriptorId(updateCloudProductDescriptorResource) {
    var productDescriptorRel = _.findWhere(updateCloudProductDescriptorResource.links, { rel: 'product-descriptor' });
    if (productDescriptorRel) {
        return helpers.parseId(productDescriptorRel.href);
    } else {
        return void 0;
    }
}

function checkValidProductDescriptorRequest(req) {
    return (req.params.productDescriptorId === parseProductDescriptorId(req.body));
}

function checkValidDeviceRequest(req) {
    return (checkValidProductDescriptorRequest(req) && (req.params.serialNumber === req.body.serialNumber));
}

module.exports.addDevice = function addDevice(req, res, next) {
    if(checkValidDeviceRequest(req)) {
        cloudDeviceManager.add(req.params.productDescriptorId, req.params.serialNumber, req.body, function (err, results) {
            if (err) {
                next(err);
            } else {
                res.json(results).status(200);
            }
        });
    } else {
        var error = new Error("Not a valid request");
        error.status = 400;
        next(error);
    }
};

module.exports.removeDevice = function removeDevice(req, res, next) {
    cloudDeviceManager.remove(req.params.productDescriptorId, req.params.serialNumber, function(err) {
        if (err) {
            next(err);
        } else {
            res.sendStatus(204);
        }
    });
};

module.exports.addProductDescriptor = function addProductDescriptor(req, res, next) {
    if (checkValidProductDescriptorRequest(req)) {
        cloudProductDescriptorManager.add(req.params.productDescriptorId, req.body, function (err, results) {
            if (err) {
                next(err);
            } else {
                res.json(results).status(200);
            }
        });
    } else {
        var error = new Error("Not a valid request");
        error.status = 400;
        next(error);
    }
};

module.exports.removeProductDescriptor = function removeProductDescriptor(req, res, next) {
    unpublishService.unpublish(req.params.productDescriptorId, function(err) {
        if (err) {
            next(err);
        } else {
            res.sendStatus(204);
        }
    });
};