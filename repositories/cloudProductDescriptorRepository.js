"use strict";

let config = require('../config');
let Repository = require('repository-dynamodb');
let repository = new Repository(config.awsRegion, config.productDescriptorsTableName, 'id');

repository.filterBy = function loadCloudProductDescriptorsFromDynamoDb(vendor, productType, callback) {
    let params = {
        TableName: config.productDescriptorsTableName,
        IndexName: config.productDescriptorsTableIndex,
        KeyConditions : [
            this.docClient.Condition("vendor", "EQ", vendor),
            this.docClient.Condition("productType", "EQ", productType)
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