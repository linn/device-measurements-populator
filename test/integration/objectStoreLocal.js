"use strict";

// Runtime precondition: docker must be running and able to pull `minio/minio`. Travis already
// declares docker as a service for this repository.
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

const IMAGE = "minio/minio";

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
            await client.send(new ListBucketsCommand({}));
            return;
        } catch (err) {
            if (Date.now() > giveUpAt) {
                throw new Error("MinIO did not answer within " + deadlineMs + "ms: " + err.message);
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
}

module.exports = {
    start: async function startObjectStore(buckets) {
        const port = freePort();
        const containerId = docker([
            "run", "-d", "--rm", "-p", port + ":9000",
            "-e", "MINIO_ROOT_USER=localkey", "-e", "MINIO_ROOT_PASSWORD=localsecret",
            IMAGE, "server", "/data",
        ]);

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
            docker(["rm", "-f", containerId]);
            throw err;
        }

        return {
            port: port,
            stop: function stopObjectStore() {
                docker(["rm", "-f", containerId]);
                delete process.env.AWS_ENDPOINT_URL_S3;
            },
        };
    },
};
