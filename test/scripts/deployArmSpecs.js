'use strict';
var chai = require('chai');
/*jshint -W079 */
var expect = chai.expect;

var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var execFileSync = require('node:child_process').execFileSync;

// What each arm of scripts/deploy.sh sends to CloudFormation, asserted through the real script with
// `aws` replaced by a recorder on PATH, so nothing is deployed.
//
// These pin the values against accidental edits; they cannot prove the values right. The prod ones were
// read from the live account (the 2016 stack's parameters, the populator-temp target group and the
// export list), and a wrong one is not caught by anything else here: a different stack name would create
// a second service, and a missing legacy target group drops the callers still on ecs-internal.
//
// `docker` is replaced the same way, answering the registry lookup the prod arm makes for the image's
// digest.
//
// PRECONDITION: bash on PATH. Nothing else - no docker, no network, no AWS.
describe('deploy arms', () => {
    var workDir, calls;

    var LEGACY_ARN = 'arn:aws:elasticloadbalancing:eu-west-1:545349016803:targetgroup/populator-temp/5426317c060e0e14';

    var DIGEST = `sha256:${'c'.repeat(64)}`;
    var CHILD_DIGEST = `sha256:${'d'.repeat(64)}`;
    // What `docker buildx imagetools inspect --format '{{json .Manifest}}'` prints for a single image.
    var SINGLE_MANIFEST = [
        '{',
        '  "mediaType": "application/vnd.docker.distribution.manifest.v2+json",',
        `  "digest": "${DIGEST}",`,
        '  "size": 2209',
        '}',
    ].join('\n');
    // And for a multi-platform index, as buildx 0.10 prints it: the index's digest, then its children's.
    var INDEX_MANIFEST = [
        '{',
        '  "mediaType": "application/vnd.oci.image.index.v1+json",',
        `  "digest": "${DIGEST}",`,
        '  "manifests": [',
        `    { "mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": "${CHILD_DIGEST}" }`,
        '  ]',
        '}',
    ].join('\n');

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-arm-'));
        ['scripts', 'aws', 'bin'].forEach((dir) => {
            fs.mkdirSync(path.join(workDir, dir));
        });
        fs.copyFileSync(
            path.join(__dirname, '..', '..', 'scripts', 'deploy.sh'),
            path.join(workDir, 'scripts', 'deploy.sh')
        );
        calls = path.join(workDir, 'calls.txt');
        // Each call is recorded as a marker line then one argument per line, so a value containing '=' or
        // ':' is compared whole and each call's arguments stay separate. describe-stacks answers with
        // DESCRIBE_EXIT, which is how a missing stack is simulated, and head-object with HEAD_EXIT, which
        // is how a missing SBOM document is.
        var stub = path.join(workDir, 'bin', 'aws');
        fs.writeFileSync(
            stub,
            [
                '#!/bin/bash',
                `{ echo '--call--'; printf '%s\\n' "$@"; } >> "${calls}"`,
                '[ "$2" = describe-stacks ] && exit "${DESCRIBE_EXIT:-0}"',
                '[ "$2" = head-object ] && exit "${HEAD_EXIT:-0}"',
                'exit 0',
                '',
            ].join('\n')
        );
        fs.chmodSync(stub, 0o755);
        // Prints MANIFEST_JSON for the tag it is asked about, and records that tag.
        var dockerStub = path.join(workDir, 'bin', 'docker');
        fs.writeFileSync(
            dockerStub,
            [
                '#!/bin/bash',
                `printf '%s\\n' "$*" >> "${path.join(workDir, 'docker-calls.txt')}"`,
                '[ "${DOCKER_EXIT:-0}" = 0 ] || { echo "docker: lookup failed" >&2; exit "$DOCKER_EXIT"; }',
                'printf \'%s\\n\' "$MANIFEST_JSON"',
                '',
            ].join('\n')
        );
        fs.chmodSync(dockerStub, 0o755);
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    function deploy(args, extraEnv) {
        var status = 0;
        try {
            execFileSync('bash', ['scripts/deploy.sh'].concat(args), {
                cwd: workDir,
                env: Object.assign(
                    {
                        PATH: `${path.join(workDir, 'bin')}:${process.env.PATH}`,
                        HOME: process.env.HOME,
                        MANIFEST_JSON: SINGLE_MANIFEST,
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
            calls: all,
            // The one call that deploys, or undefined if none did.
            deployArgs: all.find((call) => call[0] === 'cloudformation' && call[1] === 'deploy'),
        };
    }

    // The value a parameter override is given; undefined if absent. Fails on a duplicate, because with
    // `aws cloudformation deploy` the last one wins and an `include` would not notice the override.
    function param(args, name) {
        var matches = args.filter((arg) => arg.startsWith(`${name}=`));
        expect(matches, `${name} given more than once`).to.have.length.at.most(1);
        return matches.length ? matches[0].slice(name.length + 1) : undefined;
    }

    describe('prod', () => {
        it('deploys onto the 2016 stack, on the estate cluster', () => {
            var result = deploy(['prod', '77']);

            expect(result.status).to.equal(0);
            expect(result.deployArgs).to.include('--stack-name=deviceMeasurementPopulator');
            expect(param(result.deployArgs, 'targetCluster')).to.equal('LinnApiClusterName-prod');
            expect(param(result.deployArgs, 'dockerTag')).to.equal('77');
            expect(result.deployArgs).to.include('environment=prod');
        });

        it('stays registered with the legacy target group its current callers reach', () => {
            var result = deploy(['prod', '77']);

            expect(param(result.deployArgs, 'legacyAlbTargetGroupArn')).to.equal(LEGACY_ARN);
            expect(param(result.deployArgs, 'albTargetGroupArnExport')).to.equal(
                'measurements-populator-target-group-arn'
            );
        });

        it('uses the production tables and bucket, not the int ones', () => {
            var result = deploy(['prod', '77']);

            expect(param(result.deployArgs, 'devicesTableName')).to.equal('linn.cloud.devices');
            expect(param(result.deployArgs, 'productDescriptorsTableName')).to.equal('linn.cloud.product-descriptors');
            expect(param(result.deployArgs, 'productDescriptorsTableIndex')).to.equal(
                'linn.cloud.product-descriptors.index'
            );
            expect(param(result.deployArgs, 'expireFileDataTable')).to.equal('linn.cloud.expire-s3-objects');
            expect(param(result.deployArgs, 'deviceFileDataBucket')).to.equal('linn.cloud.filedata');
        });

        it('refuses to create a stack when the 2016 one is not found', () => {
            var result = deploy(['prod', '77'], { DESCRIBE_EXIT: '255' });

            expect(result.status).to.equal(1);
            expect(result.deployArgs).to.equal(undefined);
        });

        it('with --review creates the change set without executing it', () => {
            var result = deploy(['prod', '77', '--review']);

            expect(result.status).to.equal(0);
            expect(result.deployArgs).to.include('--no-execute-changeset');
        });

        it('executes the change set without --review', () => {
            var result = deploy(['prod', '77']);

            expect(result.deployArgs).to.not.include('--no-execute-changeset');
        });
    });

    describe("prod ships only an image with an SBOM in prod's store", () => {
        var PROD_STORE = 'linn-api-infrastructure-prod-sbom-store';
        var KEY = `components/image/linn/device-measurements-populator/${DIGEST}.cdx.json`;

        function headObject(result) {
            return result.calls.find((call) => call[0] === 's3api' && call[1] === 'head-object');
        }

        it('asks for the document keyed by the digest of the tag it deploys, before deploying', () => {
            var result = deploy(['prod', '77']);

            expect(result.status).to.equal(0);
            expect(fs.readFileSync(path.join(workDir, 'docker-calls.txt'), 'utf8')).to.include(
                'linn/device-measurements-populator:77'
            );
            expect(headObject(result)).to.deep.equal(['s3api', 'head-object', '--bucket', PROD_STORE, '--key', KEY]);
            expect(result.calls.indexOf(headObject(result))).to.be.below(result.calls.indexOf(result.deployArgs));
        });

        it("keys a multi-platform image by the index's digest, not a child's", () => {
            var result = deploy(['prod', '77'], { MANIFEST_JSON: INDEX_MANIFEST });

            expect(result.status).to.equal(0);
            expect(headObject(result)).to.include(KEY);
        });

        it('refuses to deploy when the store has no document for the image', () => {
            var result = deploy(['prod', '77'], { HEAD_EXIT: '254' });

            expect(result.status).to.equal(1);
            expect(result.deployArgs).to.equal(undefined);
        });

        it('refuses under --review too, so a rehearsal reports what the real run would refuse', () => {
            var result = deploy(['prod', '77', '--review'], { HEAD_EXIT: '254' });

            expect(result.status).to.equal(1);
            expect(result.deployArgs).to.equal(undefined);
        });

        [
            ['the registry lookup fails', { DOCKER_EXIT: '1' }],
            ['the lookup prints no digest', { MANIFEST_JSON: '{ "mediaType": "x" }' }],
            ['the digest is truncated', { MANIFEST_JSON: `"digest": "sha256:${'c'.repeat(63)}"` }],
        ].forEach(([what, env]) => {
            it(`refuses to deploy, without asking the store, when ${what}`, () => {
                var result = deploy(['prod', '77'], env);

                expect(result.status).to.equal(1);
                expect(headObject(result)).to.equal(undefined);
                expect(result.deployArgs).to.equal(undefined);
            });
        });
    });

    describe('sys', () => {
        it('deploys single-homed onto its own stack, cluster and int data', () => {
            var result = deploy(['sys', '77']);

            expect(result.status).to.equal(0);
            expect(result.deployArgs).to.include('--stack-name=deviceMeasurementPopulator-sys');
            expect(param(result.deployArgs, 'targetCluster')).to.equal('LinnApiClusterName-sys');
            expect(param(result.deployArgs, 'legacyAlbTargetGroupArn')).to.equal('none');
            expect(param(result.deployArgs, 'devicesTableName')).to.equal('linn.cloud.devices.int');
            expect(param(result.deployArgs, 'productDescriptorsTableName')).to.equal(
                'linn.cloud.product-descriptors.int'
            );
            expect(param(result.deployArgs, 'productDescriptorsTableIndex')).to.equal(
                'linn.cloud.product-descriptors.int.index'
            );
            expect(param(result.deployArgs, 'expireFileDataTable')).to.equal('linn.cloud.expire-s3-objects.int');
            expect(param(result.deployArgs, 'deviceFileDataBucket')).to.equal('linn.cloud.filedata.int');
        });

        it('does not look the stack up, since only prod guards against creating one', () => {
            var result = deploy(['sys', '77']);

            expect(result.calls).to.have.length(1);
        });
    });

    describe('refusals, none of which call aws', () => {
        [
            ['any other environment', ['int', '77']],
            ['a tag that is not a build number', ['prod', 'latest']],
            ['a zero-padded tag', ['prod', '077']],
            ['an unknown option', ['prod', '77', '--yes']],
            ['an argument after the option', ['prod', '77', '--review', 'typo']],
        ].forEach(([what, args]) => {
            it(`refuses ${what}`, () => {
                var result = deploy(args);

                expect(result.status).to.equal(64);
                expect(result.calls).to.deep.equal([]);
            });
        });
    });
});
