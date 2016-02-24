"use strict";

let config = require('../config');
let Repository = require('repository-dynamodb');
let repository = new Repository(config.awsRegion, config.devicesTableName, 'productDescriptorId', 'serialNumber');

repository.filterByProductDescriptorId = function loadCloudDevicesByProductDescriptorFromDynamoDb(productDescriptorId, callback) {
    let params = {
        TableName: config.devicesTableName,
        KeyConditions : [
            this.docClient.Condition("productDescriptorId", "EQ", productDescriptorId)
        ]
    };
    this.docClient.query(params, function(err, results) {
        if (err) {
            callback(err);
        } else {
            callback(null, results.Items);
        }
    });
};

module.exports = repository;