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

function freePort() {
    const server = net.createServer();
    server.listen(0);
    const port = server.address().port;
    server.close();
    return port;
}

function docker(args) {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
    // Returns a handle whose `stop()` removes the container. The endpoint is published through
    // AWS_ENDPOINT_URL_DYNAMODB, which the SDK reads by itself - production code has no test seam.
    start: async function startDynamoDbLocal(tables) {
        const port = freePort();
        const containerId = docker(["run", "-d", "--rm", "-p", port + ":8000", IMAGE]);

        process.env.AWS_ENDPOINT_URL_DYNAMODB = "http://localhost:" + port;
        // DynamoDB Local rejects a request with no credentials at all; it never validates them.
        process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "local";
        process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "local";

        const admin = new DynamoDBClient({ region: "eu-west-1" });

        try {
            await waitUntilAnswering(admin, 30000);
            for (const table of tables) {
                await admin.send(new CreateTableCommand(table));
            }
        } catch (err) {
            docker(["rm", "-f", containerId]);
            throw err;
        }

        return {
            port: port,
            stop: function stopDynamoDbLocal() {
                docker(["rm", "-f", containerId]);
                delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
            },
        };
    },
};
