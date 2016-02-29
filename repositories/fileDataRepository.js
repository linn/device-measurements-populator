"use strict";

var config = require('../config');
var S3Repository = require('./lib/s3Repository');

module.exports = new S3Repository(config.awsRegion, config.deviceFileDataBucket);