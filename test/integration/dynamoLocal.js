"use strict";

// Runtime precondition: docker must be running and able to pull `amazon/dynamodb-local`.
// Travis already declares docker as a service for this repository, so CI satisfies it.
//
// This deliberately does NOT skip when docker is absent. A skipped round-trip test reads exactly
// like a passing one in the summary, and the data-access layer it covers has no other coverage.

const { execFileSync } = require("child_process");
const net = require("net");
const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require("@aws-sdk/client-dynamodb");

const IMAGE = "amazon/dynamodb-local";
const ENV_KEYS = ["AWS_ENDPOINT_URL_DYNAMODB", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];

function freePort() {
    const server = net.createServer();
    server.listen(0);
    const port = server.address().port;
    server.close();
    return port;
}

function docker(args) {
    // execFileSync blocks the event loop, so mocha's own timeout cannot fire while it runs. Without
    // a bound here a slow or unreachable registry hangs the suite rather than failing it.
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
            await client.send(new ListTablesCommand({}));
            return;
        } catch (err) {
            if (Date.now() > giveUpAt) {
                throw new Error("DynamoDB Local did not answer within " + deadlineMs + "ms: " + err.message);
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
}

module.exports = {
    // Returns a handle whose `stop()` removes the container and puts the environment back as it was.
    // The endpoint is published through AWS_ENDPOINT_URL_DYNAMODB, which the SDK reads by itself, so
    // production code carries no test seam; a bare IP makes it address path-style.
    start: async function startDynamoDbLocal(tables) {
        const port = freePort();
        const saved = {};
        ENV_KEYS.forEach(function (name) { saved[name] = process.env[name]; });

        const containerId = docker(["run", "-d", "--rm", "-p", port + ":8000", IMAGE]);

        // --rm reaps the container when the CONTAINER exits, not when this process does. Without
        // this an uncaught exception or a CI kill leaves it running and holding its port.
        const reap = function () {
            try { docker(["rm", "-f", containerId]); } catch (ignored) { /* already gone */ }
        };
        process.once("exit", reap);

        process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://127.0.0.1:" + port;
        // DynamoDB Local rejects a request carrying no credentials at all; it never validates them.
        process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "local";
        process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "local";

        const admin = new DynamoDBClient({ region: "eu-west-1" });

        try {
            await waitUntilAnswering(admin, 30000);
            for (const table of tables) {
                await admin.send(new CreateTableCommand(table));
            }
        } catch (err) {
            process.removeListener("exit", reap);
            reap();
            restore(saved);
            throw err;
        }

        return {
            port: port,
            stop: function stopDynamoDbLocal() {
                process.removeListener("exit", reap);
                try { reap(); } finally { restore(saved); }
            },
        };
    },
};
