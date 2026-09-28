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
// PRECONDITION: bash on PATH. Nothing else - no docker, no network, no AWS.
describe('deploy arms', () => {
    var workDir, calls;

    var LEGACY_ARN = 'arn:aws:elasticloadbalancing:eu-west-1:545349016803:targetgroup/populator-temp/5426317c060e0e14';

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
        // DESCRIBE_EXIT, which is how a missing stack is simulated.
        var stub = path.join(workDir, 'bin', 'aws');
        fs.writeFileSync(
            stub,
            [
                '#!/bin/bash',
                `{ echo '--call--'; printf '%s\\n' "$@"; } >> "${calls}"`,
                '[ "$2" = describe-stacks ] && exit "${DESCRIBE_EXIT:-0}"',
                'exit 0',
                '',
            ].join('\n')
        );
        fs.chmodSync(stub, 0o755);
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
                    { PATH: `${path.join(workDir, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME },
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
        ].forEach(([what, args]) => {
            it(`refuses ${what}`, () => {
                var result = deploy(args);

                expect(result.status).to.equal(64);
                expect(result.calls).to.deep.equal([]);
            });
        });
    });
});
