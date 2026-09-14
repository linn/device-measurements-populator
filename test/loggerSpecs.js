"use strict";

const chai = require("chai");
const expect = chai.expect;

const log = require("../logger");

describe("logger", function () {
    // winston 3 assigns `level` and `timestamp` ONTO an object handed to it. The express error
    // handler logs the Error and then serialises that same Error into the response body, so logging
    // it directly put winston's own fields in front of a client. Asserted here rather than through a
    // request because the handler only logs at 5xx, and no cheaply reachable route produces one -
    // an assertion on a 404 passes with this fix removed, which is how it was written the first time.
    it("does not modify an Error it is given", function () {
        const err = new Error("something failed");
        err.status = 503;
        const before = Object.keys(err).slice().sort();

        log.error(err);

        expect(Object.keys(err).slice().sort()).to.deep.equal(before);
        expect(err).to.not.have.property("level");
        expect(err).to.not.have.property("timestamp");
    });

    it("accepts an Error without throwing", function () {
        expect(function () { log.error(new Error("boom")); }).to.not.throw();
    });
});
