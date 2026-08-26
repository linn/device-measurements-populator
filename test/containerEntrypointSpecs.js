"use strict";

// A structural proxy, deliberately. The behaviour it stands for - a SIGTERM reaching node - is only
// observable inside a container, so nothing in this suite can assert it directly. What it CAN do is
// refuse the one edit that silently disables the drain: putting npm back in front of node, which
// makes node a grandchild of PID 1 and leaves the forwarded signal at the intervening shell.

const chai = require("chai");
const expect = chai.expect;
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

const entrypointLines = dockerfile
    .split("\n")
    .filter(function (line) { return line.trim().startsWith("ENTRYPOINT"); });

describe("the container entrypoint", function () {
    it("is declared exactly once", function () {
        expect(entrypointLines).to.have.lengthOf(1);
    });

    it("uses the exec form, not the shell form", function () {
        // Checked before parsing, and as its own assertion: a string ENTRYPOINT is run via /bin/sh -c,
        // which reintroduces the very indirection the array form exists to remove - and it would
        // otherwise surface as an opaque JSON.parse error rather than as this.
        expect(entrypointLines[0]).to.contain("[");
    });

    it("executes node directly rather than through npm", function () {
        const argv = JSON.parse(entrypointLines[0].slice(entrypointLines[0].indexOf("[")));
        expect(argv[0]).to.equal("node");
    });

    it("runs exactly what `npm start` would have run", function () {
        // If the start script ever grows a flag, production would silently stop getting it.
        const argv = JSON.parse(entrypointLines[0].slice(entrypointLines[0].indexOf("[")));
        expect(argv.join(" ")).to.equal(packageJson.scripts.start);
    });

    it("declares no CMD, which would only be arguments to node", function () {
        const cmd = dockerfile
            .split("\n")
            .filter(function (line) { return line.trim().startsWith("CMD"); });
        expect(cmd).to.deep.equal([]);
    });
});

describe("the shutdown budget against the ECS stop timeout", function () {
    const template = fs.readFileSync(
        path.join(REPO_ROOT, "ContinuousIntegration", "CloudFormation",
                  "deviceMeasurementsPopulatorCloudFormation.yaml"), "utf8");
    const config = require("../shutdownConfig");

    it("declares exactly one StopTimeout", function () {
        // Parser-free on purpose. Attributing a value to a container means working out where its block
        // begins and ends, and that logic is easy to get subtly wrong in a way that silently reads a
        // neighbour's number. Counting cannot be wrong that way: the moment a second container exists
        // to be confused with ours, this fails and a human decides.
        const declared = template.split("\n").filter(function (l) { return /^\s*StopTimeout:/.test(l); });
        expect(declared).to.have.lengthOf(1);
    });

    it("finishes draining AND flushing before ECS would kill the container", function () {
        const match = template.match(/^\s*StopTimeout:\s*(\d+)\s*$/m);
        expect(match, "no StopTimeout in the template").to.not.equal(null);
        const budget = config.DRAIN_TIMEOUT_MS + config.EXIT_FLUSH_TIMEOUT_MS;
        expect(budget).to.be.below(Number(match[1]) * 1000);
    });

    it("holds a connection open for longer than the ALB will", function () {
        // The direction is the point: node closing first is what lets the ALB dispatch onto a socket
        // it thinks is reusable and report the reset as a 502.
        expect(config.KEEP_ALIVE_TIMEOUT_MS).to.be.above(60000);
    });
});
