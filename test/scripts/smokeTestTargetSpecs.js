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
// curl is replaced by a recorder, so nothing leaves the machine and a PRODUCTION target is safe to
// assert on here. The addresses are taken from the requests the script actually makes - the publish and
// the read-back - rather than from a probe, because there is no longer a probe to read them from.
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

        // Records every URL argument and answers 200 with an empty body, so the script walks its whole
        // sequence instead of stopping at the first request. Only URLs are recorded: a payload contains
        // newlines and would corrupt a line-per-call log.
        var stub = path.join(workDir, 'bin', 'curl');
        fs.writeFileSync(stub, [
            '#!/bin/bash',
            'out=; prev=',
            'for a in "$@"; do',
            '  case "$a" in http://*|https://*) printf "%s\\n" "$a" >> "' + calls + '" ;; esac',
            '  [ "$prev" = "-o" ] && out="$a"',
            '  prev="$a"',
            'done',
            '[ -n "$out" ] && printf "{}" > "$out"',
            'printf "%s" "${STUB_STATUS:-200}"',
            ''
        ].join('\n'));
        fs.chmodSync(stub, 0o755);
    });

    afterEach(function () {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    // PATH is PREPENDED rather than replaced: the script needs the real node, mktemp and coreutils, and
    // only curl is being shadowed.
    function run(args, stubEnv) {
        var status = 0;
        var stderr = '';
        var stdout = '';
        try {
            execFileSync('bash', ['scripts/smoke-test.sh'].concat(args), {
                cwd: workDir,
                env: Object.assign({}, process.env, {
                    PATH: path.join(workDir, 'bin') + path.delimiter + process.env.PATH
                }, stubEnv || {}),
                stdio: 'pipe',
                encoding: 'utf8'
            });
        } catch (err) {
            status = err.status;
            stderr = String(err.stderr || '');
            stdout = String(err.stdout || '');
        }
        return {
            status: status,
            stderr: stderr,
            stdout: stdout,
            requested: fs.existsSync(calls)
                ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean)
                : []
        };
    }

    // The base addresses actually used, in the order first seen. Split by the path each service owns,
    // so a populator address and a measurements address cannot be confused for one another.
    function basesUsed(result, marker) {
        var seen = [];
        result.requested.forEach(function (url) {
            var at = url.indexOf(marker);
            if (at === -1) { return; }
            var base = url.slice(0, at);
            if (seen.indexOf(base) === -1) { seen.push(base); }
        });
        return seen;
    }

    function populators(result)   { return basesUsed(result, '/cloud-product-descriptors/'); }
    function measurements(result) { return basesUsed(result, '/device-measurements/'); }

    describe('a named deployment', function () {
        it('resolves sys to the app-sys populator and the beta-cloud measurements api', function () {
            var result = run(['--target', 'sys']);

            expect(populators(result)).to.deep.equal(['https://app-sys.linn.co.uk']);
            expect(measurements(result)).to.deep.equal(['https://beta-cloud.linn.co.uk']);
        });

        it('resolves prod-new to the app populator and the cloud measurements api', function () {
            var result = run(['--target', 'prod-new', '--yes-write-to-prod']);

            expect(populators(result)).to.deep.equal(['https://app.linn.co.uk']);
            expect(measurements(result)).to.deep.equal(['https://cloud.linn.co.uk']);
        });

        it('resolves prod-old to the ecs-internal populator over plain http, which is all it listens on', function () {
            var result = run(['--target', 'prod-old', '--yes-write-to-prod']);

            expect(populators(result)).to.deep.equal([
                'http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com'
            ]);
            expect(measurements(result)).to.deep.equal(['https://cloud.linn.co.uk']);
        });

        // The case that separates prod-dual from prod-new: both name the app populator and the cloud
        // api, and only the SECOND populator tells them apart. A resolver that dropped it would satisfy
        // every other assertion here.
        it('resolves prod-dual to BOTH prod populators, which is what makes it the dual-homing check', function () {
            var result = run(['--target', 'prod-dual', '--yes-write-to-prod']);

            expect(populators(result)).to.deep.equal([
                'https://app.linn.co.uk',
                'http://internal-ecs-internal-288575285.eu-west-1.elb.amazonaws.com'
            ]);
            expect(measurements(result)).to.deep.equal(['https://cloud.linn.co.uk']);
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

        // Asserted on the MESSAGE, not on the exit code. An unknown target leaves the environment
        // unset, so the pre-existing --env validation would refuse it anyway, with the same status and
        // the same absence of requests - an outcome-only assertion here passes with this arm deleted
        // and pins nothing. What the arm buys is a diagnosis that names the flag the caller actually
        // typed, and that is the only thing that distinguishes the two paths.
        it('names the unknown target and the known ones, rather than complaining about --env', function () {
            var result = run(['--target', 'staging']);

            expect(result.status).to.equal(64);
            expect(result.requested).to.deep.equal([]);
            expect(result.stderr).to.contain("--target 'staging' is not a known deployment");
            expect(result.stderr).to.contain('sys, prod-new, prod-old, prod-dual');
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

    // The failure Iain actually hit running --target sys against the real deployment: /ping was in no
    // listener rule, so the load balancer answered its default instead of the service. The probe that
    // provoked it is gone, but the same status can still come back from a publish, and a bare "-> 302"
    // sends a reader hunting for a fault in a service that never saw the request.
    describe('a load balancer answering instead of the service', function () {
        ['302', '403', '401'].forEach(function (status) {
            it('explains a ' + status + ' as a routing gap rather than reporting it bare', function () {
                var result = run(['--target', 'sys'], { STUB_STATUS: status });

                expect(result.stdout).to.contain("the load balancer's default action");
                expect(result.stdout).to.contain('check a listener rule forwards this path');
            });
        });

        it('does not explain away a genuine service error', function () {
            var result = run(['--target', 'sys'], { STUB_STATUS: '500' });

            expect(result.stdout).to.not.contain("the load balancer's default action");
        });
    });

    describe('the explicit form', function () {
        it('is unchanged by the shorthand existing', function () {
            var result = run([
                '--env', 'sys',
                '--populator', 'http://populator.example',
                '--measurements', 'http://measurements.example'
            ]);

            expect(populators(result)).to.deep.equal(['http://populator.example']);
            expect(measurements(result)).to.deep.equal(['http://measurements.example']);
        });

        it('still adds addresses given alongside a target', function () {
            var result = run(['--target', 'sys', '--populator', 'http://extra.example']);

            expect(populators(result)).to.include('https://app-sys.linn.co.uk');
            expect(populators(result)).to.include('http://extra.example');
        });
    });
});
