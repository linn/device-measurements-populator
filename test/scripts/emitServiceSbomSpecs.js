'use strict';
var chai = require('chai');
/*jshint -W079 */
var expect = chai.expect;

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var execFileSync = require('node:child_process').execFileSync;

// scripts/emit-service-sbom.sh, run for real with `docker` and `aws` replaced by recorders on PATH, beside
// this repository's own artefacts.sh and sbom-pin.sh - so what is asserted is what this repository hands
// the estate emitter, and which of the emitter's refusals stop an upload. The emitter image itself (key
// derivation, commit-sha validation) is not run here; linn-api-infrastructure's src/sbom-tool/test.sh
// covers it.
//
// PRECONDITION: bash on PATH. The cases past the argument checks also need bash 4 or newer, because
// artefacts.sh declares an associative array. They are skipped on an older bash, except under CI, where a
// skip would let the suite go green without them.
describe('emit-service-sbom.sh', () => {
    var workDir, calls;

    var COMMIT = 'a'.repeat(40);
    var KEY = `components/image/linn/device-measurements-populator/sha256:${'c'.repeat(64)}.cdx.json`;

    var bashHasAssociativeArrays = (() => {
        try {
            execFileSync('bash', ['-c', 'declare -A probe'], { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    })();

    function needsBash4(context) {
        if (bashHasAssociativeArrays) {
            return;
        }
        if (process.env.CI) {
            throw new Error('bash on PATH has no associative arrays, and CI must not skip these specs');
        }
        context.skip();
    }

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-sbom-'));
        ['scripts', 'bin'].forEach((dir) => {
            fs.mkdirSync(path.join(workDir, dir));
        });
        ['emit-service-sbom.sh', 'artefacts.sh', 'sbom-pin.sh'].forEach((name) => {
            fs.copyFileSync(path.join(__dirname, '..', '..', 'scripts', name), path.join(workDir, 'scripts', name));
        });
        calls = path.join(workDir, 'calls.txt');
        // Both record each call as a marker line then one argument per line. docker answers `start` with
        // STORE_KEY (or fails with START_EXIT), and `cp` writes DOC_CONTENT to the destination.
        writeStub(
            'docker',
            [
                '#!/bin/bash',
                `{ echo '--call--'; echo docker; printf '%s\\n' "$@"; } >> "${calls}"`,
                'case "$1" in',
                '  create) echo container-1 ;;',
                '  start) [ "${START_EXIT:-0}" = 0 ] || exit "$START_EXIT"; printf \'%s\\n\' "$STORE_KEY" ;;',
                '  cp) printf \'%s\' "$DOC_CONTENT" > "$3" ;;',
                'esac',
                '',
            ].join('\n')
        );
        writeStub(
            'aws',
            ['#!/bin/bash', `{ echo '--call--'; echo aws; printf '%s\\n' "$@"; } >> "${calls}"`, ''].join('\n')
        );
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    function writeStub(name, content) {
        var file = path.join(workDir, 'bin', name);
        fs.writeFileSync(file, content);
        fs.chmodSync(file, 0o755);
    }

    function emit(args, extraEnv) {
        var status = 0;
        try {
            execFileSync('bash', ['scripts/emit-service-sbom.sh'].concat(args), {
                cwd: workDir,
                env: Object.assign(
                    {
                        PATH: `${path.join(workDir, 'bin')}:${process.env.PATH}`,
                        HOME: process.env.HOME,
                        ENVIRONMENT: 'sys',
                        CI_BUILD_ENV: 'travis-dist:noble',
                        STORE_KEY: KEY,
                        DOC_CONTENT: '{"bomFormat":"CycloneDX"}',
                    },
                    extraEnv
                ),
                stdio: 'pipe',
            });
        } catch (err) {
            status = err.status;
        }
        var recorded = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
        var all = recorded
            .split('--call--\n')
            .filter((call) => call.length)
            .map((call) => call.trim().split('\n'));
        return {
            status: status,
            docker: all.filter((call) => call[0] === 'docker').map((call) => call.slice(1)),
            aws: all.filter((call) => call[0] === 'aws').map((call) => call.slice(1)),
        };
    }

    describe('refuses before touching docker', () => {
        [
            ['no arguments', [], {}, 2],
            ['one argument', ['77'], {}, 2],
            ['no ENVIRONMENT, which names the store', ['77', COMMIT], { ENVIRONMENT: '' }, 1],
            ['no CI_BUILD_ENV, which is the provenance', ['77', COMMIT], { CI_BUILD_ENV: '' }, 1],
        ].forEach(([what, args, env, expected]) => {
            it(`with ${what}`, () => {
                var result = emit(args, env);

                expect(result.status).to.equal(expected);
                expect(result.docker).to.deep.equal([]);
                expect(result.aws).to.deep.equal([]);
            });
        });
    });

    describe("with this repository's artefacts and pin", () => {
        beforeEach(function () {
            needsBash4(this);
        });

        it('hands the pinned emitter this image, its commit, its repository and its CRA scope', () => {
            var result = emit(['77', COMMIT]);

            expect(result.status).to.equal(0);
            var create = result.docker.find((call) => call[0] === 'create');
            [
                `SBOM_COMMIT_SHA=${COMMIT}`,
                'SBOM_ARTEFACT_REF=linn/device-measurements-populator:77',
                'SBOM_REPO=device-measurements-populator',
                'SBOM_ARTEFACT_CLASS=image',
                'SBOM_CRA_SCOPE=true',
                'SBOM_BUILDER_IMAGE=travis-dist:noble',
            ].forEach((value) => {
                expect(create, value).to.include(value);
            });
            expect(create.slice(-3)).to.deep.equal([
                'emit-sbom.sh',
                'docker:linn/device-measurements-populator:77',
                '/tmp/sbom.cdx.json',
            ]);
            expect(create[create.length - 4]).to.equal('linn/sbom-tool:1635');
        });

        it("uploads the document to the environment's store under the key the emitter printed", () => {
            var result = emit(['77', COMMIT], { ENVIRONMENT: 'prod' });

            expect(result.status).to.equal(0);
            expect(result.aws).to.have.length(1);
            var upload = result.aws[0];
            expect(upload.slice(0, 2)).to.deep.equal(['s3', 'cp']);
            expect(upload[3]).to.equal(`s3://linn-api-infrastructure-prod-sbom-store/${KEY}`);
        });

        [
            ['the emitter printed no store key', { STORE_KEY: '' }],
            ['the emitter produced an empty document', { DOC_CONTENT: '' }],
            ['the emitter container failed', { START_EXIT: '3' }],
        ].forEach(([what, env]) => {
            it(`uploads nothing and fails when ${what}`, () => {
                var result = emit(['77', COMMIT], env);

                expect(result.status).to.not.equal(0);
                expect(result.aws).to.deep.equal([]);
            });
        });
    });
});
