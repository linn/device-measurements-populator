'use strict';

// Drives the real entry point, so these fail when bin/www stops wiring the drain in - the install()
// call or the keep-alive assignment deleted - which no spec against the config module can see. The
// drain's own mechanics are @linn-cloud/graceful-shutdown's to prove; what is proved here is that this
// service is plugged into it. No AWS is touched: the request used is one the route rejects as invalid.

const chai = require('chai');
const expect = chai.expect;
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const shutdownConfig = require('../../shutdownConfig');

const ENTRY_POINT = path.join(__dirname, '..', '..', 'bin', 'www');

// 12factor-config exits the process if a required key is absent. DEBUG is what makes bin/www report
// the port it bound, which PORT=0 leaves to the OS.
const ENV = Object.assign({}, process.env, {
    REQUEST_LOGGER_FORMAT: ':method :url',
    AWS_REGION: 'eu-west-1',
    PORT: '0',
    DEVICES_TABLE_NAME: 'devices',
    PRODUCT_DESCRIPTORS_TABLE_NAME: 'descriptors',
    PRODUCT_DESCRIPTORS_TABLE_INDEX: 'descriptors-index',
    EXPIRE_S3_OBJECTS_TABLE_NAME: 'expiries',
    DEVICE_FILE_DATA_BUCKET: 'file-data',
    NODE_ENV: 'test',
    DEBUG: 'CloudExaktPopulator:server',
});

describe('shutting down the real entry point on SIGTERM', () => {
    let child;

    afterEach(() => {
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
    });

    it('lets a request already in flight finish, then exits cleanly', async () => {
        child = start();
        const port = Number((await child.waitFor(/Listening on port (\d+)/))[1]);

        const socket = await connect(port);
        const response = collect(socket);
        // The body is left one byte short, so the request is genuinely in flight when the signal lands.
        socket.write(
            'PUT /cloud-product-descriptors/x HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n' +
                'Content-Length: 2\r\n\r\n{'
        );

        child.kill('SIGTERM');
        await child.waitFor(/draining in-flight requests/);
        socket.write('}');

        const statusLine = (await response).split('\r\n')[0];
        expect(statusLine).to.equal('HTTP/1.1 400 Bad Request');
        expect(await child.exited).to.deep.equal({ code: 0, signal: null });
    });

    it('holds an idle keep-alive connection open past node’s 5s default', async () => {
        // Deleting the keepAliveTimeout assignment leaves node retiring idle sockets at 5s, which is
        // below the load balancer's idle timeout - the 502 race this setting exists to close.
        child = start();
        const port = Number((await child.waitFor(/Listening on port (\d+)/))[1]);

        const socket = await connect(port);
        let closed = false;
        socket.on('close', () => {
            closed = true;
        });
        socket.write('GET /ping HTTP/1.1\r\nHost: x\r\n\r\n');
        await once(socket, 'data');

        await pause(7500);

        expect(closed, 'the server retired an idle keep-alive socket').to.equal(false);
        expect(shutdownConfig.KEEP_ALIVE_TIMEOUT_MS).to.be.above(7500);
        socket.destroy();
    });
});

// Subscribes to `exit` at spawn: it is a one-shot event with no replay, so attaching later races the
// child's own exit.
function start() {
    const proc = spawn(process.execPath, [ENTRY_POINT], { env: ENV });
    let output = '';
    const waiters = [];
    const onChunk = (chunk) => {
        output += chunk.toString();
        for (const waiter of waiters.slice()) {
            waiter();
        }
    };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    proc.exited = new Promise((resolve) => {
        proc.on('exit', (code, signal) => {
            resolve({ code: code, signal: signal });
        });
    });

    // Bounded, so a child that never gets there fails with its output rather than as a mocha timeout.
    proc.waitFor = (pattern) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                done();
                reject(new Error(`never saw ${pattern}; output was: ${output}`));
            }, 8000);
            const check = () => {
                const match = output.match(pattern);
                if (match) {
                    done();
                    resolve(match);
                }
            };
            const done = () => {
                clearTimeout(timer);
                waiters.splice(waiters.indexOf(check), 1);
            };
            waiters.push(check);
            check();
        });

    return proc;
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => resolve(socket));
        socket.on('error', reject);
    });
}

function collect(socket) {
    return new Promise((resolve) => {
        let received = '';
        socket.on('data', (chunk) => {
            received += chunk.toString();
        });
        socket.on('close', () => resolve(received));
    });
}

function once(emitter, event) {
    return new Promise((resolve) => emitter.once(event, resolve));
}

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
