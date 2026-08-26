"use strict";
var chai = require("chai");
/*jshint -W079 */
var expect = chai.expect;

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

// Which addresses a --target resolves to, asserted through the real scripts/smoke-test.sh rather than
// by reading its table.
//
// curl is replaced by a recorder that fails, so the reachability phase reports every endpoint as
// unreachable and the script exits before it writes anything. That is what makes a PRODUCTION target
// safe to assert on here: the recorded calls are the addresses it was about to use, and no request
// ever leaves the machine.
//
// PRECONDITION: bash and node on PATH. No network, no AWS.
describe('smoke-test target resolution', function () {
    var workDir, calls;

    beforeEach(function () {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-target-'));
        fs.mkdirSync(path.join(workDir, 'scripts'));
        fs.mkdirSync(path.join(workDir, 'bin'));
        fs.copyFileSync(
            path.join(__dirname, '..', '..', 'scripts', 'smoke-test.sh'),
            path.join(workDir, 'scripts', 'smoke-test.sh')
        );
        calls = path.join(workDir, 'calls.txt');

        // Records every argument and fails, so `request` yields "curl-failed" and the run stops at the
        // reachability gate. Recording ALL arguments rather than just URLs is what lets a test assert
        // that nothing was requested at all.
        var stub = path.join(workDir, 'bin', 'curl');
        fs.writeFileSync(stub, [
            '#!/bin/bash',
            'printf "%s\\n" "$*" >> "' + calls + '"',
            'exit 7',
            ''
        ].join('\n'));
        fs.chmodSync(stub, 0o755);
    });

    afterEach(function () {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    // PATH is PREPENDED rather than replaced: the script needs the real node, mktemp and coreutils, and
    // only curl is being shadowed.
    function run(args) {
        var status = 0;
        try {
            execFileSync('bash', ['scripts/smoke-test.sh'].concat(args), {
                cwd: workDir,
                env: Object.assign({}, process.env, {
                    PATH: path.join(workDir, 'bin') + path.delimiter + process.env.PATH
                }),
                stdio: 'pipe'
            });
        } catch (err) {
            status = err.status;
        }
        return {
            status: status,
            requested: fs.existsSync(calls)
                ? fs.readFileSync(calls, 'utf8').trim().split('\n')
                : []
        };
    }

    // The addresses attempted during the reachability phase, in order, without curl's other flags.
    function pinged(result) {
        return result.requested
            .map(function (line) {
                var match = line.match(/(https?:\/\/[^\s]*\/ping)/);
                return match ? match[1] : null;
            })
            .filter(function (url) { return url !== null; });
    }

    describe('a named deployment', function () {
        it('resolves sys to the app-sys populator and the beta-cloud measurements api', function () {
            var result = run(['--target', 'sys']);

            expect(pinged(result)).to.deep.equal([
                'https://app-sys.linn.co.uk/ping',
                'https://beta-cloud.linn.co.uk/ping'
            ]);
        });

        it('resolves prod-new to the app populator and the cloud measurements api', function () {
            var result = run(['--target', 'prod-new', '--yes-write-to-prod']);

            expect(pinged(result)).to.deep.equal([
                'https://app.linn.co.uk/ping',
                'https://cloud.linn.co.uk/ping'
            ]);
        });

        it('resolves prod-old to the ecs-internal populator over plain http, which is all it listens on', function () {
            var result = run(['--target', 'prod-old', '--yes-write-to-prod']);

            expect(pinged(result)).to.deep.equal([
                'http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com/ping',
                'https://cloud.linn.co.uk/ping'
            ]);
        });

        // The case that separates prod-dual from prod-new: both name the app populator and the cloud
        // api, and only the SECOND populator tells them apart. A resolver that dropped it would satisfy
        // every other assertion here.
        it('resolves prod-dual to BOTH prod populators, which is what makes it the dual-homing check', function () {
            var result = run(['--target', 'prod-dual', '--yes-write-to-prod']);

            expect(pinged(result)).to.deep.equal([
                'https://app.linn.co.uk/ping',
                'http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com/ping',
                'https://cloud.linn.co.uk/ping'
            ]);
        });
    });

    describe('refusals', function () {
        // The shorthand must not become a way past the production acknowledgement. Asserting that
        // NOTHING was requested is the point: an exit code alone would still pass if the refusal
        // happened after the first request went out.
        ['prod-new', 'prod-old', 'prod-dual'].forEach(function (target) {
            it('refuses ' + target + ' without --yes-write-to-prod, before making any request', function () {
                var result = run(['--target', target]);

                expect(result.status).to.not.equal(0);
                expect(result.requested).to.deep.equal([]);
            });
        });

        it('refuses a target it does not know rather than running with no addresses', function () {
            var result = run(['--target', 'staging']);

            expect(result.status).to.equal(64);
            expect(result.requested).to.deep.equal([]);
        });

        // Both orders, deliberately. A check made inside the --target arm alone would accept
        // `--env sys --target sys`, because --env has already been consumed by the time it runs.
        it('refuses --target after --env', function () {
            var result = run(['--env', 'sys', '--target', 'sys']);

            expect(result.status).to.equal(64);
            expect(result.requested).to.deep.equal([]);
        });

        it('refuses --env after --target', function () {
            var result = run(['--target', 'sys', '--env', 'sys']);

            expect(result.status).to.equal(64);
            expect(result.requested).to.deep.equal([]);
        });

        it('refuses a second --target rather than running a four-endpoint mixture', function () {
            var result = run(['--target', 'sys', '--target', 'prod-new']);

            expect(result.status).to.equal(64);
            expect(result.requested).to.deep.equal([]);
        });
    });

    describe('the explicit form', function () {
        it('is unchanged by the shorthand existing', function () {
            var result = run([
                '--env', 'sys',
                '--populator', 'http://populator.example',
                '--measurements', 'http://measurements.example'
            ]);

            expect(pinged(result)).to.deep.equal([
                'http://populator.example/ping',
                'http://measurements.example/ping'
            ]);
        });

        it('still adds addresses given alongside a target', function () {
            var result = run(['--target', 'sys', '--populator', 'http://extra.example']);

            expect(pinged(result)).to.include('http://extra.example/ping');
            expect(pinged(result)).to.include('https://app-sys.linn.co.uk/ping');
        });
    });
});
