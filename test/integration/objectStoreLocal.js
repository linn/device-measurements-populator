"use strict";

// Runtime precondition: docker must be running and able to pull the emulator image below. Travis
// already declares docker as a service for this repository.
//
// The endpoint is published as an IP rather than a hostname on purpose. The SDK addresses a bucket
// virtual-host style by default, which no local S3 implementation serves; against a bare IP it has
// no choice but path style, so the production client needs no forcePathStyle option and therefore
// carries no test seam.
//
// As with the DynamoDB harness, this fails loudly rather than skipping when docker is absent.

const { execFileSync } = require("child_process");
const net = require("net");
const { S3Client, CreateBucketCommand, ListBucketsCommand } = require("@aws-sdk/client-s3");

// MiniStack rather than minio, and the reason is not preference: `minio/minio` stopped being pullable
// from Docker Hub for us entirely. Measured 2026-09-14 - an anonymous pull token gets 401 for the
// pinned digest, for a release tag, and for :latest alike, while `library/alpine` and `library/busybox`
// answer 200 on the same probe; and CI's own build log shows `Login Succeeded` followed by the same
// denial, so it is the repository and not our credentials. That left this suite red and, because
// scripts/ci.sh runs the tests before the deploy decision, blocked the sys deploy behind it.
//
// MiniStack is the emulator ADR-025 selects for the estate's local AWS layer, so this moves toward the
// engine everything else is heading for rather than introducing a third-party of its own. Its S3 data
// plane was verified against THIS suite before the swap: all seven round-trip specs below pass, and the
// full suite goes from 136 passing / 1 failing to 143 passing.
//
// Worth stating plainly, because it is a real cost: minio was a mature, independent S3 implementation,
// and MiniStack is a young single-maintainer emulator. For a test whose purpose is to be the fixed
// reference the production code is compared to, that is weaker evidence than what it replaces. It is
// taken because the alternative is no round-trip test at all.
//
// Pinned by digest, not by tag. An untagged image is :latest, so these round trips would be validating
// against whatever the registry served that day.
const IMAGE = "ministackorg/ministack@sha256:cd4ac9bc91f7954b476dcdfdd46e3c5750c599f525660e4a42f6769e687e6af0";
const ENV_KEYS = ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];

function freePort() {
    const server = net.createServer();
    server.listen(0);
    const port = server.address().port;
    server.close();
    return port;
}

function docker(args) {
    // execFileSync blocks the event loop, so mocha's own timeout cannot fire while it runs.
    return execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180000,
        killSignal: "SIGKILL",
    }).trim();
}

function restore(saved) {
    ENV_KEYS.forEach(function (name) {
        if (saved[name] === undefined) { delete process.env[name]; }
        else { process.env[name] = saved[name]; }
    });
}

async function waitUntilAnswering(client, deadlineMs) {
    const giveUpAt = Date.now() + deadlineMs;
    for (;;) {
        try {
            await client.send(new ListBucketsCommand({}));
            return;
        } catch (err) {
            if (Date.now() > giveUpAt) {
                throw new Error("the object store did not answer within " + deadlineMs + "ms: " + err.message);
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
}

module.exports = {
    start: async function startObjectStore(buckets) {
        const port = freePort();
        // Saved and restored rather than overwritten: a developer or CI agent with real credentials
        // exported would otherwise run every later spec as localkey/localsecret against real AWS.
        const saved = {};
        ENV_KEYS.forEach(function (name) { saved[name] = process.env[name]; });

        // 4566 is the emulator's single AWS-facing port, and it needs no root credentials of its own -
        // it accepts any SigV4 signature, so the keys set below are only what the SDK requires to sign.
        const containerId = docker([
            "run", "-d", "--rm", "-p", "127.0.0.1:" + port + ":4566", IMAGE,
        ]);

        const reap = function () {
            try { docker(["rm", "-f", containerId]); } catch (ignored) { /* already gone */ }
        };
        process.once("exit", reap);

        process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:" + port;
        process.env.AWS_ACCESS_KEY_ID = "localkey";
        process.env.AWS_SECRET_ACCESS_KEY = "localsecret";

        const admin = new S3Client({ region: "eu-west-1" });

        try {
            await waitUntilAnswering(admin, 60000);
            for (const bucket of buckets) {
                await admin.send(new CreateBucketCommand({ Bucket: bucket }));
            }
        } catch (err) {
            process.removeListener("exit", reap);
            reap();
            restore(saved);
            throw err;
        }

        return {
            port: port,
            stop: function stopObjectStore() {
                process.removeListener("exit", reap);
                try { reap(); } finally { restore(saved); }
            },
        };
    },
};
