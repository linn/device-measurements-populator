"use strict";

let config = require('../config');
let Repository = require('./lib/dynamoRepository');
let repository = new Repository(config.awsRegion, config.productDescriptorsTableName, 'id');

repository.filterBy = function loadCloudProductDescriptorsFromDynamoDb(vendor, productType, callback) {
    repository.queryByEquality({
        indexName: config.productDescriptorsTableIndex,
        equals: { vendor: vendor, productType: productType }
    }, callback);
};

module.exports = repository;
