"use strict";

let config = require('12factor-config');
let dotenv = require('dotenv');

dotenv.config({silent: true});

let cfg = config({
    stackTraceOnError: {
        env      : 'STACK_TRACE_ON_ERROR',
        type     : 'boolean',
        default  : 'true',
        required : false
    },
    requestLoggerFormat: {
        env      : 'REQUEST_LOGGER_FORMAT',
        type     : 'string',
        default  : ':remote-addr :method :url :status :response-time',
        required : true
    },
    awsRegion : {
        env      : 'AWS_REGION',
        type     : 'string',
        required : true
    },
    port : {
        env      : 'PORT',
        type     : 'integer',
        required : true
    },
    devicesTableName: {
        env      : 'DEVICES_TABLE_NAME',
        type     : 'string',
        required : true
    },
    productDescriptorsTableName: {
        env      : 'PRODUCT_DESCRIPTORS_TABLE_NAME',
        type     : 'string',
        required : true
    },
    productDescriptorsTableIndex: {
        env      : 'PRODUCT_DESCRIPTORS_TABLE_INDEX',
        type     : 'string',
        required : true
    },
    expireS3ObjectsTableName: {
        env      : 'EXPIRE_S3_OBJECTS_TABLE_NAME',
        type     : 'string',
        required : true
    },
    deviceFileDataBucket: {
        env      : 'DEVICE_FILE_DATA_BUCKET',
        type     : 'string',
        required : true
    },
    env : {
        env      : 'NODE_ENV',
        type     : 'enum',
        values   : [ 'test', 'debug', 'int', 'release' ]
    }
});

module.exports = cfg;