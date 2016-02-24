"use strict";
var _ = require('underscore');

let config = require('../config');
let Repository = require('repository-dynamodb');
var repository = new Repository(config.expireS3ObjectsTableName, "id");

repository.scheduleForExpirationById = function scheduleForExpirationByIdFromDynamoDb(id, callback) {
    var expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 1);
    repository.addOrReplace({
        id: id,
        expiration: expirationDate.toISOString()
    }, callback);
};

repository.listObjectsDueForRemoval = function listObjectsDueForRemoval(callback) {
    var params = {
        TableName: config.expireS3ObjectsTableName,
        ExpressionAttributeNames: {
            "#E": "expiration"
        },
        ExpressionAttributeValues: {
            ":NOW": new Date().toISOString()
        },
        FilterExpression: ':NOW > #E'
    };
    this.docClient.scan(params, function (err, data) {
        if (err) {
            callback(err);
        } else {
            callback(null, data.Items);
        }
    });
};

module.exports = repository;