"use strict";

var _ = require('underscore');

function parseId(href) {
    return href.substring(href.lastIndexOf("/") + 1, href.length);
}
module.exports.parseId = parseId;

module.exports.getS3FileIds = function getS3FileIds(components) {
    return _.chain(components)
        .pluck('measurements')
        .map(function convertMeasurementObjectToValuesArray(namedMeasurements) { return _.values(namedMeasurements); })
        .flatten()
        .map(function extractFileHrefs(measurement) {
            return measurement.file ? _.pluck(measurement.file.files, 'href') : [];
        })
        .flatten()
        .map(parseId)
        .value();
};