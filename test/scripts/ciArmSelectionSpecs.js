"use strict";
var chai = require("chai");
/*jshint -W079 */
var expect = chai.expect;

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

// Which arm of the build runs, asserted through the real scripts/ci.sh rather than by reading it.
//
// The sub-scripts are replaced by recorders, so nothing is built, pushed or deployed. What that buys is
// the two questions a reader of ci.sh cannot answer by inspection: which inputs reach the arm that
// touches AWS, and whether a failure part-way through stops the ones after it.
//
// PRECONDITION: bash on PATH. Nothing else - no docker, no network, no AWS.
describe('CI arm selection', function () {
    var workDir, calls;

    var SUB_SCRIPTS = ['build', 'test', 'build-dockers', 'push-dockers', 'deploy'];

    beforeEach(function () {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-arm-'));
        fs.mkdirSync(path.join(workDir, 'scripts'));
        fs.copyFileSync(
            path.join(__dirname, '..', '..', 'scripts', 'ci.sh'),
            path.join(workDir, 'scripts', 'ci.sh')
        );
        calls = path.join(workDir, 'calls.txt');
        SUB_SCRIPTS.forEach(function (name) {
            stubSubScript(name, 0);
        });
    });

    afterEach(function () {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    // Appends its own name and arguments, so the assertions can be about ORDER as well as membership -
    // "deploy did not run" and "deploy ran before the push" are different defects.
    function stubSubScript(name, exitCode) {
        var file = path.join(workDir, 'scripts', name + '.sh');
        fs.writeFileSync(file, [
            '#!/bin/bash',
            'echo "' + name + ' $*" >> "' + calls + '"',
            'exit ' + exitCode,
            ''
        ].join('\n'));
        fs.chmodSync(file, 0o755);
    }

    // Returns the exit status and what ran. `env` replaces the whole environment rather than extending
    // it, so a TRAVIS_* variable set in the shell running the suite cannot change a result.
    function runCi(travisEnv) {
        var status = 0;
        try {
            execFileSync('bash', ['scripts/ci.sh'], {
                cwd: workDir,
                env: Object.assign({ PATH: process.env.PATH, HOME: process.env.HOME }, travisEnv),
                stdio: 'pipe'
            });
        } catch (err) {
            status = err.status;
        }
        return {
            status: status,
            ran: fs.existsSync(calls)
                ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(function (line) {
                    return line.trim();
                })
                : []
        };
    }

    function onMaster(extra) {
        return Object.assign({ TRAVIS_BRANCH: 'master', TRAVIS_BUILD_NUMBER: '77' }, extra);
    }

    describe('a branch build', function () {
        it('tests but publishes nothing', function () {
            var result = runCi({ TRAVIS_BRANCH: 'feat/some-branch', TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'test']);
        });

        it('still tests when the branch name contains a slash, which no longer reaches a docker tag', function () {
            var result = runCi({ TRAVIS_BRANCH: 'feat/a/b', TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.include('test');
        });

        it('is not failed for a build number it never uses', function () {
            var result = runCi({ TRAVIS_BRANCH: 'feat/some-branch', TRAVIS_PULL_REQUEST: 'false' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'test']);
        });

        it('is not failed for a pull-request value it never reads', function () {
            var result = runCi({ TRAVIS_BRANCH: 'feat/some-branch', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'test']);
        });
    });

    describe('a master build', function () {
        it('publishes an image and does not deploy, because prod is deployed by hand', function () {
            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: 'false' }));

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'test', 'build-dockers', 'push-dockers']);
        });

        it('deploys sys for a pull request, after the image has been pushed', function () {
            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'test', 'build-dockers', 'push-dockers', 'deploy sys 77']);
        });
    });

    describe('a value it cannot interpret', function () {
        // Each of these reached an accepting arm at some point during this change. The trailing-text
        // cases are the ones that matter: a case pattern's `*` is "any string", not "repeat the previous
        // class", so `[1-9][0-9]*` looks like it validates an integer and validates two characters.
        var REFUSED_PULL_REQUESTS = [
            '', '0', '007', '+1', 'true', 'False', 'false ', ' false', 'abc',
            '10x', '12abc', '12 x', '12; echo pwned', '1 2', '1e9', '*', '?', '10.5'
        ];

        REFUSED_PULL_REQUESTS.forEach(function (value) {
            it('refuses to decide on TRAVIS_PULL_REQUEST=' + JSON.stringify(value) + ', and publishes nothing', function () {
                var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: value }));

                expect(result.status).to.equal(1);
                expect(result.ran).to.not.include('deploy sys 77');
                expect(result.ran).to.not.include('push-dockers');
            });
        });

        it('refuses when TRAVIS_PULL_REQUEST is absent entirely, rather than reading absence as a pull request', function () {
            var result = runCi(onMaster({}));

            expect(result.status).to.equal(1);
            expect(result.ran).to.not.include('push-dockers');
        });

        var REFUSED_BUILD_NUMBERS = ['', '0', '007', 'abc', '12abc', '12; echo pwned', '1 2'];

        REFUSED_BUILD_NUMBERS.forEach(function (value) {
            it('refuses to publish under TRAVIS_BUILD_NUMBER=' + JSON.stringify(value) + ', which would be the image tag', function () {
                var result = runCi({ TRAVIS_BRANCH: 'master', TRAVIS_PULL_REQUEST: '10', TRAVIS_BUILD_NUMBER: value });

                expect(result.status).to.equal(1);
                expect(result.ran).to.not.include('build-dockers');
            });
        });

        // The silent one: an empty branch misses the master gate, takes the branch arm and exits 0, so
        // the whole build reads as a successful no-publish.
        it('refuses an empty TRAVIS_BRANCH rather than silently publishing nothing', function () {
            var result = runCi({ TRAVIS_BRANCH: '', TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(1);
            expect(result.ran).to.deep.equal([]);
        });

        it('refuses an absent TRAVIS_BRANCH for the same reason', function () {
            var result = runCi({ TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(1);
            expect(result.ran).to.deep.equal([]);
        });
    });

    describe('a failure part-way through', function () {
        // This is the property that moving the docker steps out of Travis's after_success bought, and it
        // is invisible to any assertion about a passing build.
        it('stops at a failing suite and publishes nothing', function () {
            stubSubScript('test', 3);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(3);
            expect(result.ran).to.deep.equal(['build', 'test']);
        });

        it('does not deploy when the push failed', function () {
            stubSubScript('push-dockers', 5);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(5);
            expect(result.ran).to.not.include('deploy sys 77');
        });

        it('does not push when the image build failed', function () {
            stubSubScript('build-dockers', 7);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(7);
            expect(result.ran).to.not.include('push-dockers');
        });
    });
});
