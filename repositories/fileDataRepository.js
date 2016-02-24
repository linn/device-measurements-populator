"use strict";

var config = require('../config');
var CloudFileRepository = require('./lib/cloudFileRepository');

module.exports = new CloudFileRepository(config.deviceFileDataBucket);