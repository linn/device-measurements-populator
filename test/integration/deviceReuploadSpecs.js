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

const DEVICES = "devices";

Object.assign(process.env, {
    REQUEST_LOGGER_FORMAT: ":method :url",
    AWS_REGION: "eu-west-1",
    PORT: "0",
    DEVICES_TABLE_NAME: DEVICES,
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

    before(async function () {
        // Named from this file's own env, NOT read back from a required config. proxyquire's
        // '@global' disables the module cache for the whole graph, so config is re-evaluated from
        // live process.env when the subject is loaded below - i.e. from the values this file sets.
        // A `require("../../config")` here would instead return the CACHED config, belonging to
        // whichever spec file loaded it first, and the two disagree the moment any spec sets a
        // different table name. Verified: changing appSpecs' DEVICES_TABLE_NAME breaks this spec
        // when it reads config back, and does not when it uses its own constant.
        container = await dynamoLocal.start([{
            TableName: DEVICES,
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

    const upload = function () {
        return new Promise(function (resolve) {
            // The failure mode is a callback that never fires, so a timeout is the observable -
            // asserting only on the error would hang the suite instead of failing it. The timer is
            // cleared on success: an uncleared one holds the event loop open for its full duration
            // and, under a regression, lets the async body resume after `after()` has torn the
            // container down, which reports as ECONNREFUSED rather than as the bug.
            const timer = setTimeout(function () { resolve({ fired: false }); }, 8000);
            manager.add("pd-1", "sn-1", { lastUpdate: "L", components: [{ componentName: "t", measurements: {} }] },
                function (err) { clearTimeout(timer); resolve({ fired: true, err: err }); });
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
        // No assertion on an uncaught exception: mocha installs its own handler and attributes the
        // throw to the running test, so a regression fails here before any such check is reached.
        expect(result.err || null).to.equal(null);
    });
});
