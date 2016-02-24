"use strict";

var aws = require('aws-sdk');
var config = require('../../config');
var uuid = require('node-uuid');

aws.config.region = config.awsRegion;
var s3 = new aws.S3();

module.exports.CloudFileRepository = function CloudFileRepository(bucketName) {
    function generateUri(key) {
        return 'http://' + bucketName + ".s3.amazonaws.com/" + key;
    }
    function saveFileToS3(id, filename, buffer, callback) {
        var params = {
            Bucket: bucketName,
            Key: id,
            Body: buffer,
            ContentDisposition: 'attachment; filename=' + filename,
            Metadata: {
                'originalfilename': filename
            }
        };
        s3.putObject(params, function(err) {
            if (err) {
                callback(err);
            } else {
                s3.waitFor('objectExists', { Bucket: params.Bucket, Key: params.Key }, function (err) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, {
                            key: params.Key,
                            href: generateUri(params.Key)
                        });
                    }
                });
            }
        });
    }
    function addFileByIdToS3(id, filename, buffer, callback) {
        saveFileToS3(id, filename, buffer, callback);
    }
    function addFileToS3(filename, buffer, callback) {
        saveFileToS3(uuid.v1(), filename, buffer, callback);
    }
    function loadFileFromS3(id, callback) {
        var params = {
            Bucket: config.s3.buckets.fileData,
            Key: id
        };
        s3.getObject(params, function (err, results) {
            if (err) {
                callback(err);
            } else {
                callback(null, {
                    filename: results.Metadata.originalfilename,
                    data: results.Body
                });
            }
        });
    }
    function removeFileFromS3(id, callback) {
        var params = {
            Bucket: config.s3.buckets.fileData,
            Key: id
        };
        s3.deleteObject(params, function (err) {
            if (err) {
                callback(err);
            } else {
                s3.waitFor('objectNotExists', params, callback);
            }
        });
    }
    return {
        generateUri: generateUri,
        addOrReplace: addFileByIdToS3,
        add: addFileToS3,
        findBy: loadFileFromS3,
        removeBy: removeFileFromS3
    };
};