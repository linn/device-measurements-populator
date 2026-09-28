'use strict';
var chai = require('chai');
/*jshint -W079 */
var expect = chai.expect;

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var execFileSync = require('node:child_process').execFileSync;

// Which arm of the build runs, asserted through the real scripts/ci.sh rather than by reading it.
//
// The sub-scripts are replaced by recorders, so nothing is built, pushed or deployed. What that buys is
// the two questions a reader of ci.sh cannot answer by inspection: which inputs reach the arm that
// touches AWS, and whether a failure part-way through stops the ones after it.
//
// PRECONDITION: bash on PATH. Nothing else - no docker, no network, no AWS.
describe('CI arm selection', () => {
    var workDir, calls;

    var SUB_SCRIPTS = ['build', 'lint', 'test', 'build-dockers', 'push-dockers', 'deploy', 'emit-service-sbom'];

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-arm-'));
        fs.mkdirSync(path.join(workDir, 'scripts'));
        fs.copyFileSync(path.join(__dirname, '..', '..', 'scripts', 'ci.sh'), path.join(workDir, 'scripts', 'ci.sh'));
        calls = path.join(workDir, 'calls.txt');
        SUB_SCRIPTS.forEach((name) => {
            stubSubScript(name, 0);
        });
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    // Appends its own name and arguments, so the assertions can be about ORDER as well as membership -
    // "deploy did not run" and "deploy ran before the push" are different defects.
    //
    // The SBOM emitter reads which store and what provenance from the environment rather than its
    // arguments, so its line records those too.
    function stubSubScript(name, exitCode) {
        var file = path.join(workDir, 'scripts', `${name}.sh`);
        var record =
            name === 'emit-service-sbom'
                ? `echo "${name} $* ENVIRONMENT=\${ENVIRONMENT:-} CI_BUILD_ENV=\${CI_BUILD_ENV:-}" >> "${calls}"`
                : `echo "${name} $*" >> "${calls}"`;
        fs.writeFileSync(file, ['#!/bin/bash', record, `exit ${exitCode}`, ''].join('\n'));
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
                stdio: 'pipe',
            });
        } catch (err) {
            status = err.status;
        }
        return {
            status: status,
            ran: fs.existsSync(calls)
                ? fs
                      .readFileSync(calls, 'utf8')
                      .trim()
                      .split('\n')
                      .map((line) => line.trim())
                : [],
        };
    }

    var PUSH_SHA = 'a'.repeat(40);
    var PR_HEAD_SHA = 'b'.repeat(40);

    function onMaster(extra) {
        return Object.assign(
            { TRAVIS_BRANCH: 'master', TRAVIS_BUILD_NUMBER: '77', TRAVIS_DIST: 'noble', TRAVIS_COMMIT: PUSH_SHA },
            extra
        );
    }

    function onPullRequest(extra) {
        return onMaster(Object.assign({ TRAVIS_PULL_REQUEST: '10', TRAVIS_PULL_REQUEST_SHA: PR_HEAD_SHA }, extra));
    }

    describe('a branch build', () => {
        it('tests but publishes nothing', () => {
            var result = runCi({
                TRAVIS_BRANCH: 'feat/some-branch',
                TRAVIS_PULL_REQUEST: 'false',
                TRAVIS_BUILD_NUMBER: '77',
            });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'lint', 'test']);
        });

        it('still tests when the branch name contains a slash, which no longer reaches a docker tag', () => {
            var result = runCi({ TRAVIS_BRANCH: 'feat/a/b', TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.include('test');
        });

        it('is not failed for a build number it never uses', () => {
            var result = runCi({ TRAVIS_BRANCH: 'feat/some-branch', TRAVIS_PULL_REQUEST: 'false' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'lint', 'test']);
        });

        it('is not failed for a pull-request value it never reads', () => {
            var result = runCi({ TRAVIS_BRANCH: 'feat/some-branch', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal(['build', 'lint', 'test']);
        });
    });

    describe('a master build', () => {
        // Prod's document is filed here, at publication, because prod is deployed by hand from this image
        // and deploy.sh refuses one that prod's store has no document for.
        it("publishes an image and documents it in prod's store, and does not deploy", () => {
            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: 'false' }));

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal([
                'build',
                'lint',
                'test',
                'build-dockers',
                'push-dockers',
                `emit-service-sbom 77 ${PUSH_SHA} ENVIRONMENT=prod CI_BUILD_ENV=travis-dist:noble`,
            ]);
        });

        it("deploys sys for a pull request after the push, then documents the image in sys's store", () => {
            var result = runCi(onPullRequest({}));

            expect(result.status).to.equal(0);
            expect(result.ran).to.deep.equal([
                'build',
                'lint',
                'test',
                'build-dockers',
                'push-dockers',
                'deploy sys 77',
                `emit-service-sbom 77 ${PR_HEAD_SHA} ENVIRONMENT=sys CI_BUILD_ENV=travis-dist:noble`,
            ]);
        });

        it('records the pushed commit for a pull request when Travis gives no head sha', () => {
            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.ran).to.include(
                `emit-service-sbom 77 ${PUSH_SHA} ENVIRONMENT=sys CI_BUILD_ENV=travis-dist:noble`
            );
        });
    });

    describe('a value it cannot interpret', () => {
        // Each of these reached an accepting arm at some point during this change. The trailing-text
        // cases are the ones that matter: a case pattern's `*` is "any string", not "repeat the previous
        // class", so `[1-9][0-9]*` looks like it validates an integer and validates two characters.
        var REFUSED_PULL_REQUESTS = [
            '',
            '0',
            '007',
            '+1',
            'true',
            'False',
            'false ',
            ' false',
            'abc',
            '10x',
            '12abc',
            '12 x',
            '12; echo pwned',
            '1 2',
            '1e9',
            '*',
            '?',
            '10.5',
        ];

        REFUSED_PULL_REQUESTS.forEach((value) => {
            it(`refuses to decide on TRAVIS_PULL_REQUEST=${JSON.stringify(value)}, and publishes nothing`, () => {
                var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: value }));

                expect(result.status).to.equal(1);
                expect(result.ran).to.not.include('deploy sys 77');
                expect(result.ran).to.not.include('push-dockers');
            });
        });

        ['', undefined].forEach((dist) => {
            it(`refuses to publish with TRAVIS_DIST=${JSON.stringify(dist)}, which the SBOM records as provenance`, () => {
                var env = onPullRequest({});
                if (dist === undefined) {
                    delete env.TRAVIS_DIST;
                } else {
                    env.TRAVIS_DIST = dist;
                }

                var result = runCi(env);

                expect(result.status).to.equal(1);
                expect(result.ran).to.deep.equal(['build', 'lint', 'test']);
            });
        });

        it('refuses when TRAVIS_PULL_REQUEST is absent entirely, rather than reading absence as a pull request', () => {
            var result = runCi(onMaster({}));

            expect(result.status).to.equal(1);
            expect(result.ran).to.not.include('push-dockers');
        });

        var REFUSED_BUILD_NUMBERS = ['', '0', '007', 'abc', '12abc', '12; echo pwned', '1 2'];

        REFUSED_BUILD_NUMBERS.forEach((value) => {
            it(
                'refuses to publish under TRAVIS_BUILD_NUMBER=' +
                    JSON.stringify(value) +
                    ', which would be the image tag',
                () => {
                    var result = runCi({
                        TRAVIS_BRANCH: 'master',
                        TRAVIS_PULL_REQUEST: '10',
                        TRAVIS_BUILD_NUMBER: value,
                    });

                    expect(result.status).to.equal(1);
                    expect(result.ran).to.not.include('build-dockers');
                }
            );
        });

        // The silent one: an empty branch misses the master gate, takes the branch arm and exits 0, so
        // the whole build reads as a successful no-publish.
        it('refuses an empty TRAVIS_BRANCH rather than silently publishing nothing', () => {
            var result = runCi({ TRAVIS_BRANCH: '', TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(1);
            expect(result.ran).to.deep.equal([]);
        });

        it('refuses an absent TRAVIS_BRANCH for the same reason', () => {
            var result = runCi({ TRAVIS_PULL_REQUEST: 'false', TRAVIS_BUILD_NUMBER: '77' });

            expect(result.status).to.equal(1);
            expect(result.ran).to.deep.equal([]);
        });
    });

    describe('a failure part-way through', () => {
        // This is the property that moving the docker steps out of Travis's after_success bought, and it
        // is invisible to any assertion about a passing build.
        it('stops at a failing suite and publishes nothing', () => {
            stubSubScript('test', 3);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(3);
            expect(result.ran).to.deep.equal(['build', 'lint', 'test']);
        });

        it('does not deploy when the push failed', () => {
            stubSubScript('push-dockers', 5);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(5);
            expect(result.ran).to.not.include('deploy sys 77');
        });

        it('does not document an image the sys deploy failed to ship', () => {
            stubSubScript('deploy', 6);

            var result = runCi(onPullRequest({}));

            expect(result.status).to.equal(6);
            expect(result.ran[result.ran.length - 1]).to.equal('deploy sys 77');
        });

        it('does not document an image whose push failed', () => {
            stubSubScript('push-dockers', 5);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: 'false' }));

            expect(result.status).to.equal(5);
            expect(result.ran[result.ran.length - 1]).to.equal('push-dockers');
        });

        // The step is last, so this is the one failure that could be swallowed without anyone noticing.
        ['false', '10'].forEach((pullRequest) => {
            it(`fails the build when the SBOM emit fails (TRAVIS_PULL_REQUEST=${pullRequest})`, () => {
                stubSubScript('emit-service-sbom', 9);

                var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: pullRequest }));

                expect(result.status).to.equal(9);
            });
        });

        it('does not push when the image build failed', () => {
            stubSubScript('build-dockers', 7);

            var result = runCi(onMaster({ TRAVIS_PULL_REQUEST: '10' }));

            expect(result.status).to.equal(7);
            expect(result.ran).to.not.include('push-dockers');
        });
    });
});
