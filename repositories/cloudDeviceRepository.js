const config = require('../config');
const Repository = require('./lib/dynamoRepository');
const repository = new Repository(config.awsRegion, config.devicesTableName, 'productDescriptorId', 'serialNumber');

repository.filterByProductDescriptorId = function loadCloudDevicesByProductDescriptorFromDynamoDb(
    productDescriptorId,
    callback
) {
    repository.queryByEquality(
        {
            equals: { productDescriptorId: productDescriptorId },
        },
        callback
    );
};

module.exports = repository;
