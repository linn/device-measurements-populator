"use strict";

var fileDataRepository = require('./repositories/fileDataRepository');

var _ = require('underscore');
var async = require('async');
var clone = require('clone');

function addFileToRepository(file, callback) {
    async.waterfall([
        function addFileIfNotPresent(itercallback){
            fileDataRepository.findBy(file.id, function(err) {
                if (err && err.code === "NoSuchKey") {
                    fileDataRepository.addOrReplace(file.id, file.filename, new Buffer(file.data), itercallback);
                } else if (err) {
                    itercallback(err);
                } else {
                    itercallback(null, {
                        filename: file.filename,
                        href: fileDataRepository.generateUri(file.id)
                    });
                }
            });
        }
    ], function(err, data) {
        if (err) {
            callback(err);
        } else {
            callback(null, {
                filename: file.filename,
                href: data.href
            });
        }
    });
}

function processFile(measurement) {
    return function (callback) {
        if (measurement.file) {
            async.map(measurement.file.files, addFileToRepository, function (err, data) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, {
                        measuredOn: measurement.file.measuredOn,
                        sourceName: measurement.file.sourceName,
                        version: measurement.file.version,
                        sourceVersion: measurement.file.sourceVersion,
                        fileType: measurement.file.fileType,
                        files: data
                    });
                }
            });
        } else {
            callback(null, null);
        }
    };
}

function processValue(measurement) {
    return function (callback) {
        callback(null, clone(measurement.value));
    };
}

function measurementProcessor(measurement) {
    return function(callback) {
        async.parallel({
            file: processFile(measurement),
            value: processValue(measurement)
        }, callback);
    };
}

module.exports.processComponent = function processComponent(component, callback) {
    var measurements = _.mapObject(component.measurements, measurementProcessor);
    async.parallel(measurements, function (err, results) {
        if (err) {
            callback(err);
        } else {
            callback(null, {
                componentName: component.componentName,
                measurements: results
            });
        }
    });
};