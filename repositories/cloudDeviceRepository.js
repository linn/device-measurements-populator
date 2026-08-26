"use strict";

let config = require('../config');
let Repository = require('./lib/dynamoRepository');
let repository = new Repository(config.awsRegion, config.devicesTableName, 'productDescriptorId', 'serialNumber');

repository.filterByProductDescriptorId = function loadCloudDevicesByProductDescriptorFromDynamoDb(productDescriptorId, callback) {
    repository.queryByEquality({
        equals: { productDescriptorId: productDescriptorId }
    }, callback);
};

module.exports = repository;
