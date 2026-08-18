"use strict";

// app.js had no coverage, and this change rewires it: express 4 to 5, body-parser to express's own
// parsers, and the jade view engine to pug. None of those failures is visible to the specs that
// exercise routes in isolation - each shows up only when the assembled app serves a request.

const chai = require("chai");
const expect = chai.expect;
const http = require("http");

// 12factor-config reads these at require time and exits the process if a required key is absent.
Object.assign(process.env, {
    REQUEST_LOGGER_FORMAT: ":method :url",
    AWS_REGION: "eu-west-1",
    PORT: "0",
    DEVICES_TABLE_NAME: "devices",
    PRODUCT_DESCRIPTORS_TABLE_NAME: "descriptors",
    PRODUCT_DESCRIPTORS_TABLE_INDEX: "descriptors-index",
    EXPIRE_S3_OBJECTS_TABLE_NAME: "expiries",
    DEVICE_FILE_DATA_BUCKET: "file-data",
    NODE_ENV: "test",
});

const app = require("../../app");

describe("the assembled application", function () {
    let server;
    let origin;

    before(function (done) {
        server = http.createServer(app).listen(0, "127.0.0.1", function () {
            origin = "http://127.0.0.1:" + server.address().port;
            done();
        });
    });

    after(function (done) {
        server.close(done);
    });

    it("serves the ping route", async function () {
        const response = await fetch(origin + "/ping");
        expect(response.status).to.equal(200);
    });

    it("answers an unknown route as JSON when HTML is not acceptable", async function () {
        const response = await fetch(origin + "/no-such-route", { headers: { Accept: "application/json" } });
        expect(response.status).to.equal(404);
        expect(await response.json()).to.include({ message: "Not Found" });
    });

    it("renders the error view when HTML is acceptable", async function () {
        const response = await fetch(origin + "/no-such-route", { headers: { Accept: "text/html" } });
        expect(response.status).to.equal(404);
        const body = await response.text();
        // Proves the view engine resolved and rendered a template; a missing or unrenderable view
        // surfaces as a 500 with no markup rather than as a rendered 404.
        expect(body).to.contain("<!DOCTYPE html>");
        expect(body).to.contain("Not Found");
    });

    it("parses a JSON request body before the route sees it", async function () {
        // Malformed JSON is the only observable that separates "the parser ran" from "the parser is
        // absent": both end in an error, but only a mounted parser reports a parse failure.
        const response = await fetch(origin + "/cloud-product-descriptors/abc", {
            method: "PUT",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: "{not json",
        });
        expect(response.status).to.equal(400);
        const body = await response.json();
        expect(body.message).to.contain("JSON");
        expect(body.message).to.not.equal("Not a valid request");
    });

    it("rejects an unparsed body as a bad request rather than a server error", async function () {
        // express 4 handed an unparsed body through as {}; express 5 leaves it undefined. Without a
        // guard the first property read throws and the contract's 400 becomes a 500, so the status
        // is what discriminates here - the message alone is the same shape either way.
        const response = await fetch(origin + "/cloud-product-descriptors/abc", {
            method: "PUT",
            headers: { "Content-Type": "text/plain", Accept: "application/json" },
            body: "not json at all",
        });
        expect(response.status).to.be.below(500);
        expect(response.status).to.equal(400);
    });

});
