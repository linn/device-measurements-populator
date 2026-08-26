"use strict";

// AWS SDK v3. The callback signatures are unchanged from the v2 implementation, and so is the shape
// each one yields, including `findBy` returning `data` as a Buffer - v3 hands back a stream where v2
// handed back a Buffer, so that conversion is doing real work rather than tidying.

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    waitUntilObjectExists,
    waitUntilObjectNotExists,
} = require("@aws-sdk/client-s3");
const { v1: uuidv1 } = require("uuid");

// v2's waitFor('objectExists') defaulted to 20 attempts at 5s. Kept at the same order of magnitude
// so a slow consistency window that used to succeed still does.
const WAIT_SECONDS = 100;

// The callback is invoked outside the promise chain - identical treatment to dynamoRepository's
// adapt(), and for the same reason: inside it, a throw from the caller's callback becomes an
// unhandled rejection carrying the SDK's stack instead of an error at the site that threw.
function settle(promise, onResolved, callback) {
    promise.then(
        function (result) {
            let value;
            try {
                value = onResolved(result);
            } catch (err) {
                return process.nextTick(function () { callback(err); });
            }
            process.nextTick(function () { callback(null, value); });
        },
        function (err) { process.nextTick(function () { callback(err); }); }
    );
}

module.exports = function S3Repository(awsRegion, bucketName) {
    const s3 = new S3Client({ region: awsRegion });

    function generateUri(key) {
        return 'http://' + bucketName + ".s3.amazonaws.com/" + key;
    }

    function saveFileToS3(id, filename, buffer, callback) {
        const params = {
            Bucket: bucketName,
            Key: id,
            Body: buffer,
            ContentDisposition: 'attachment; filename=' + filename,
            Metadata: {
                'originalfilename': filename
            }
        };
        settle(
            s3.send(new PutObjectCommand(params)).then(function () {
                return waitUntilObjectExists(
                    { client: s3, maxWaitTime: WAIT_SECONDS },
                    { Bucket: params.Bucket, Key: params.Key }
                );
            }),
            function () { return { key: params.Key, href: generateUri(params.Key) }; },
            callback
        );
    }

    function addFileByIdToS3(id, filename, buffer, callback) {
        saveFileToS3(id, filename, buffer, callback);
    }

    function addFileToS3(filename, buffer, callback) {
        saveFileToS3(uuidv1(), filename, buffer, callback);
    }

    function loadFileFromS3(id, callback) {
        settle(
            s3.send(new GetObjectCommand({ Bucket: bucketName, Key: id })).then(async function (results) {
                return {
                    filename: results.Metadata && results.Metadata.originalfilename,
                    data: Buffer.from(await results.Body.transformToByteArray())
                };
            }),
            function (result) { return result; },
            callback
        );
    }

    function removeFileFromS3(id, callback) {
        const params = { Bucket: bucketName, Key: id };
        settle(
            s3.send(new DeleteObjectCommand(params)).then(function () {
                return waitUntilObjectNotExists({ client: s3, maxWaitTime: WAIT_SECONDS }, params);
            }),
            function (result) { return result; },
            callback
        );
    }

    return {
        generateUri: generateUri,
        addOrReplace: addFileByIdToS3,
        add: addFileToS3,
        findBy: loadFileFromS3,
        removeBy: removeFileFromS3
    };
};
