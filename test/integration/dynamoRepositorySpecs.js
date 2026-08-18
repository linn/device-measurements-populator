"use strict";

// Round-trip coverage for the data-access layer. It had none: every other spec in this suite
// replaces the repository modules wholesale with proxyquire stubs, so the code that actually talks
// to DynamoDB was never executed by a test. A malformed key condition is accepted by a stub and
// rejected by DynamoDB, which is exactly the class of defect a stub cannot see.

const chai = require("chai");
const expect = chai.expect;

const dynamoLocal = require("./dynamoLocal");
const Repository = require("../../repositories/lib/dynamoRepository");

const REGION = "eu-west-1";
const DEVICES = "test-devices";
const DESCRIPTORS = "test-product-descriptors";
const DESCRIPTORS_INDEX = "vendor-productType-index";
const EXPIRIES = "test-expire-s3-objects";

// Mirrors the tables this service actually writes to, named by its own config: devices keyed by
// product descriptor plus serial number, descriptors by id with a vendor/productType index, and the
// expiry table it uses to schedule S3 cleanup.
const TABLES = [
    {
        TableName: DEVICES,
        AttributeDefinitions: [
            { AttributeName: "productDescriptorId", AttributeType: "S" },
            { AttributeName: "serialNumber", AttributeType: "S" },
        ],
        KeySchema: [
            { AttributeName: "productDescriptorId", KeyType: "HASH" },
            { AttributeName: "serialNumber", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
    },
    {
        TableName: DESCRIPTORS,
        AttributeDefinitions: [
            { AttributeName: "id", AttributeType: "S" },
            { AttributeName: "vendor", AttributeType: "S" },
            { AttributeName: "productType", AttributeType: "S" },
        ],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        GlobalSecondaryIndexes: [
            {
                IndexName: DESCRIPTORS_INDEX,
                KeySchema: [
                    { AttributeName: "vendor", KeyType: "HASH" },
                    { AttributeName: "productType", KeyType: "RANGE" },
                ],
                Projection: { ProjectionType: "ALL" },
            },
        ],
        BillingMode: "PAY_PER_REQUEST",
    },
    {
        TableName: EXPIRIES,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
    },
];

function promised(fn) {
    return new Promise(function (resolve, reject) {
        fn(function (err, result) {
            if (err) { reject(err); } else { resolve(result); }
        });
    });
}

describe("DynamoDB repository (round trip against DynamoDB Local)", function () {
    this.timeout(120000);

    let container;
    let devices;
    let descriptors;
    let expiries;

    before(async function () {
        container = await dynamoLocal.start(TABLES);
        devices = new Repository(REGION, DEVICES, "productDescriptorId", "serialNumber");
        descriptors = new Repository(REGION, DESCRIPTORS, "id");
        expiries = new Repository(REGION, EXPIRIES, "id");
    });

    after(function () {
        if (container) { container.stop(); }
    });

    describe("a table with a composite key", function () {
        it("returns what was written, by both key parts", async function () {
            await promised((cb) => devices.addOrReplace({ productDescriptorId: "pd-1", serialNumber: "sn-1", spl: 42 }, cb));
            const found = await promised((cb) => devices.findBy("pd-1", "sn-1", cb));
            expect(found).to.deep.equal({ productDescriptorId: "pd-1", serialNumber: "sn-1", spl: 42 });
        });

        it("does not return an item whose range key differs", async function () {
            await promised((cb) => devices.addOrReplace({ productDescriptorId: "pd-2", serialNumber: "sn-a", spl: 1 }, cb));
            const found = await promised((cb) => devices.findBy("pd-2", "sn-b", cb));
            expect(found).to.equal(undefined);
        });

        it("removes only the addressed item", async function () {
            await promised((cb) => devices.addOrReplace({ productDescriptorId: "pd-3", serialNumber: "keep", spl: 1 }, cb));
            await promised((cb) => devices.addOrReplace({ productDescriptorId: "pd-3", serialNumber: "drop", spl: 2 }, cb));
            await promised((cb) => devices.removeBy("pd-3", "drop", cb));

            expect(await promised((cb) => devices.findBy("pd-3", "drop", cb))).to.equal(undefined);
            expect(await promised((cb) => devices.findBy("pd-3", "keep", cb))).to.include({ spl: 1 });
        });

        // Pins a dependency behaviour rather than our own code: the v2 document client dropped
        // undefined-valued attributes and callers here still pass them. lib-dynamodb does the same
        // by default, so this fails if a future SDK writes NULL instead or rejects the write.
        it("drops an undefined attribute instead of writing null or failing", async function () {
            await promised((cb) => devices.addOrReplace({ productDescriptorId: "pd-4", serialNumber: "sn-4", spl: 7, absent: undefined }, cb));
            const found = await promised((cb) => devices.findBy("pd-4", "sn-4", cb));
            expect(found).to.deep.equal({ productDescriptorId: "pd-4", serialNumber: "sn-4", spl: 7 });
        });
    });

    describe("a table with a hash key only", function () {
        it("round-trips and removes without a range key", async function () {
            await promised((cb) => expiries.addOrReplace({ id: "obj-1", expiresAt: 123 }, cb));
            expect(await promised((cb) => expiries.findBy("obj-1", cb))).to.deep.equal({ id: "obj-1", expiresAt: 123 });

            await promised((cb) => expiries.removeBy("obj-1", cb));
            expect(await promised((cb) => expiries.findBy("obj-1", cb))).to.equal(undefined);
        });

        it("returns undefined for an item that was never written", async function () {
            expect(await promised((cb) => expiries.findBy("never-written", cb))).to.equal(undefined);
        });
    });

    describe("querying a secondary index by equality", function () {
        before(async function () {
            await promised((cb) => descriptors.addOrReplace({ id: "d-1", vendor: "linn", productType: "akubarik" }, cb));
            await promised((cb) => descriptors.addOrReplace({ id: "d-2", vendor: "linn", productType: "akubarik" }, cb));
            await promised((cb) => descriptors.addOrReplace({ id: "d-3", vendor: "linn", productType: "akudorik" }, cb));
            await promised((cb) => descriptors.addOrReplace({ id: "d-4", vendor: "other", productType: "akubarik" }, cb));
        });

        it("returns every item matching both key attributes", async function () {
            const items = await promised((cb) =>
                descriptors.queryByEquality({ indexName: DESCRIPTORS_INDEX, equals: { vendor: "linn", productType: "akubarik" } }, cb));
            expect(items.map((i) => i.id).sort()).to.deep.equal(["d-1", "d-2"]);
        });

        it("excludes items matching only the partition key", async function () {
            const items = await promised((cb) =>
                descriptors.queryByEquality({ indexName: DESCRIPTORS_INDEX, equals: { vendor: "linn", productType: "akudorik" } }, cb));
            expect(items.map((i) => i.id)).to.deep.equal(["d-3"]);
        });

        it("returns nothing when no item matches", async function () {
            const items = await promised((cb) =>
                descriptors.queryByEquality({ indexName: DESCRIPTORS_INDEX, equals: { vendor: "linn", productType: "nonesuch" } }, cb));
            expect(items).to.deep.equal([]);
        });

        it("queries the base table when no index is named", async function () {
            const items = await promised((cb) => descriptors.queryByEquality({ equals: { id: "d-3" } }, cb));
            expect(items.map((i) => i.id)).to.deep.equal(["d-3"]);
        });
    });

    describe("failures reach the caller", function () {
        it("passes a DynamoDB error to the callback rather than throwing", async function () {
            const missing = new Repository(REGION, "table-that-does-not-exist", "id");
            let raised;
            try {
                await promised((cb) => missing.findBy("anything", cb));
            } catch (err) {
                raised = err;
            }
            expect(raised).to.be.an("error");
            expect(raised.name).to.equal("ResourceNotFoundException");
        });
    });
});
