"use strict";

// The re-measurement path, end to end, with the REAL DynamoDB repository and only S3 stubbed.
//
// This is the shape that broke: cloudDeviceManager.add runs a two-task async.waterfall whose first
// task deletes any existing device. async.waterfall forwards every argument after `err`, so a
// delete that called back with a value shifted task two's arguments and bound its continuation to
// undefined - an uncaught "callback is not a function", the request never answered, the process
// gone. It only appears on the SECOND write of a device, because the first takes the not-found
// branch, and no stub-based spec can see it: the stubs encode the repository's contract rather
// than exercise it.

const chai = require("chai");
const expect = chai.expect;
const proxyquire = require("proxyquire");

const dynamoLocal = require("./dynamoLocal");

Object.assign(process.env, {
    REQUEST_LOGGER_FORMAT: ":method :url",
    AWS_REGION: "eu-west-1",
    PORT: "0",
    DEVICES_TABLE_NAME: "devices",
    PRODUCT_DESCRIPTORS_TABLE_NAME: "descriptors",
    PRODUCT_DESCRIPTORS_TABLE_INDEX: "descriptors-index",
    EXPIRE_S3_OBJECTS_TABLE_NAME: "expiries",
    DEVICE_FILE_DATA_BUCKET: "file-data",
    NODE_ENV: "test"
});

describe("uploading the same device twice", function () {
    this.timeout(120000);

    let container;
    let manager;
    let uncaught;

    before(async function () {
        // The table is named from config rather than from a constant. config is evaluated on its
        // first require anywhere in the run, which may be another spec file - proxyquire preserves
        // the module cache, so the repository this spec exercises is already bound to whatever
        // table name won that race. Reading it back removes the ordering coupling entirely.
        const config = require("../../config");
        container = await dynamoLocal.start([{
            TableName: config.devicesTableName,
            AttributeDefinitions: [
                { AttributeName: "productDescriptorId", AttributeType: "S" },
                { AttributeName: "serialNumber", AttributeType: "S" }
            ],
            KeySchema: [
                { AttributeName: "productDescriptorId", KeyType: "HASH" },
                { AttributeName: "serialNumber", KeyType: "RANGE" }
            ],
            BillingMode: "PAY_PER_REQUEST"
        }]);

        const fileDataStub = Object.assign({
            add: function (filename, data, cb) { cb(null, { key: "k", href: "h" }); },
            addOrReplace: function (id, filename, data, cb) { cb(null, { key: id, href: "h" }); },
            findBy: function (id, cb) { cb(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" })); },
            removeBy: function (id, cb) { cb(); },
            generateUri: function (key) { return "http://example/" + key; }
        }, { "@global": true });

        proxyquire.noCallThru();
        manager = proxyquire("../../cloudDeviceManager", {
            "./repositories/fileDataRepository": fileDataStub
        });
    });

    after(function () {
        if (container) { container.stop(); }
    });

    beforeEach(function () {
        uncaught = null;
        process.once("uncaughtException", function (err) { uncaught = err; });
    });

    const upload = function () {
        return new Promise(function (resolve) {
            let fired = false;
            manager.add("pd-1", "sn-1", { lastUpdate: "L", components: [{ componentName: "t", measurements: {} }] },
                function (err) { fired = true; resolve({ fired: true, err: err }); });
            // The failure mode is a callback that never fires, so a timeout is the observable -
            // asserting only on the error would hang the suite instead of failing it.
            setTimeout(function () { if (!fired) { resolve({ fired: false }); } }, 8000);
        });
    };

    it("accepts the first upload", async function () {
        const result = await upload();
        expect(result.fired).to.equal(true);
        expect(result.err || null).to.equal(null);
    });

    it("accepts a second upload of the same device, and answers it", async function () {
        await upload();
        const result = await upload();
        expect(result.fired, "the callback never fired - the request would hang").to.equal(true);
        expect(result.err || null).to.equal(null);
        expect(uncaught, "an uncaught exception escaped").to.equal(null);
    });
});
