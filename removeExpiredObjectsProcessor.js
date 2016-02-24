"use strict";

var fileDataRepository = require('./repositories/fileDataRepository');
var expireS3ObjectsRepository = require('./repositories/expireS3ObjectsRepository');
var async = require('async');
var logger = require('./logger');

function removeBothObjectsById(id, callback){
    async.series([
            function(iterCallback) {
                fileDataRepository.removeBy(id, iterCallback);
            },
            function(iterCallback){
                expireS3ObjectsRepository.removeBy(id, iterCallback);
            }
        ], function(err){
            if (err) {
                logger.error('Failed to remove obsolete object with id ' + id);
                callback(err);
            } else {
                logger.info('Removed expired object with id ' + id);
                callback();
            }
    });
}

module.exports.removeExpiredObjects = function removeExpiredObjects() {
    expireS3ObjectsRepository.listObjectsDueForRemoval(function (err, data) {
        async.eachSeries(data, function (item, iterCallback) {
            removeBothObjectsById(item.id, iterCallback);
        }, function (err) {
            if (err) {
                logger.error('Failed to remove obsolete s3 objects failed');
            } else {
                logger.info('Removal of expired objects process successful');
            }
        });
    });
};