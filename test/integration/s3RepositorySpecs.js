"use strict";

// The S3 layer had no coverage: every spec that touches it replaces it with a mockery stub. This
// change moves it from AWS SDK v2 to v3, where GetObject returns a stream rather than a Buffer, so
// the shape callers receive is the thing most likely to break and the thing a stub cannot check.

const chai = require("chai");
const expect = chai.expect;

const objectStore = require("./objectStoreLocal");
const S3Repository = require("../../repositories/lib/s3Repository");

const REGION = "eu-west-1";
const BUCKET = "test-file-data";

function promised(fn) {
    return new Promise(function (resolve, reject) {
        fn(function (err, result) {
            if (err) { reject(err); } else { resolve(result); }
        });
    });
}

describe("S3 repository (round trip against a local object store)", function () {
    this.timeout(120000);

    let container;
    let repository;

    before(async function () {
        container = await objectStore.start([BUCKET]);
        repository = new S3Repository(REGION, BUCKET);
    });

    after(function () {
        if (container) { container.stop(); }
    });

    it("returns the stored bytes as a Buffer, not a stream", async function () {
        const body = Buffer.from("measurement,1,2,3\n");
        await promised((cb) => repository.addOrReplace("file-1", "measurements.csv", body, cb));

        const loaded = await promised((cb) => repository.findBy("file-1", cb));
        // v3 hands back a stream here; a caller doing .toString() on one gets "[object Object]"
        // rather than a failure, so the type is asserted directly.
        expect(Buffer.isBuffer(loaded.data)).to.equal(true);
        expect(loaded.data.equals(body)).to.equal(true);
    });

    it("round-trips the original filename through object metadata", async function () {
        await promised((cb) => repository.addOrReplace("file-2", "Serial 123 Measurements.csv", Buffer.from("x"), cb));
        const loaded = await promised((cb) => repository.findBy("file-2", cb));
        expect(loaded.filename).to.equal("Serial 123 Measurements.csv");
    });

    it("reports the key and href it stored under", async function () {
        const result = await promised((cb) => repository.addOrReplace("file-3", "a.csv", Buffer.from("x"), cb));
        expect(result.key).to.equal("file-3");
        expect(result.href).to.equal("http://" + BUCKET + ".s3.amazonaws.com/file-3");
    });

    it("generates a key when none is supplied, and stores under it", async function () {
        const result = await promised((cb) => repository.add("generated.csv", Buffer.from("y"), cb));
        expect(result.key).to.match(/^[0-9a-f-]{36}$/);

        const loaded = await promised((cb) => repository.findBy(result.key, cb));
        expect(loaded.data.toString()).to.equal("y");
    });

    it("replaces the object when the same key is written twice", async function () {
        await promised((cb) => repository.addOrReplace("file-4", "first.csv", Buffer.from("first"), cb));
        await promised((cb) => repository.addOrReplace("file-4", "second.csv", Buffer.from("second"), cb));

        const loaded = await promised((cb) => repository.findBy("file-4", cb));
        expect(loaded.data.toString()).to.equal("second");
        expect(loaded.filename).to.equal("second.csv");
    });

    it("removes an object so that loading it afterwards fails", async function () {
        await promised((cb) => repository.addOrReplace("file-5", "gone.csv", Buffer.from("z"), cb));
        await promised((cb) => repository.removeBy("file-5", cb));

        let raised;
        try {
            await promised((cb) => repository.findBy("file-5", cb));
        } catch (err) {
            raised = err;
        }
        expect(raised).to.be.an("error");
        expect(raised.name).to.equal("NoSuchKey");
    });

    it("passes a failure to the callback rather than throwing", async function () {
        const missing = new S3Repository(REGION, "bucket-that-does-not-exist");
        let raised;
        try {
            await promised((cb) => missing.findBy("anything", cb));
        } catch (err) {
            raised = err;
        }
        expect(raised).to.be.an("error");
        expect(raised.name).to.equal("NoSuchBucket");
    });
});
