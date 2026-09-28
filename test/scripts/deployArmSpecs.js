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
// The prod values are the live 2016 stack's, read from AWS rather than derived from the naming
// convention, and a wrong one is not caught by anything else: a different stack name creates a second
// service, and a missing legacy target group drops the callers still on ecs-internal.
//
// PRECONDITION: bash on PATH. Nothing else - no docker, no network, no AWS.
describe('deploy arms', () => {
    var workDir, calls;

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
        // One argument per line, so a value containing '=' or ':' is compared whole.
        var stub = path.join(workDir, 'bin', 'aws');
        fs.writeFileSync(stub, ['#!/bin/bash', `printf '%s\\n' "$@" >> "${calls}"`, 'exit 0', ''].join('\n'));
        fs.chmodSync(stub, 0o755);
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    function deploy(environment) {
        var status = 0;
        try {
            execFileSync('bash', ['scripts/deploy.sh', environment, '77'], {
                cwd: workDir,
                env: { PATH: `${path.join(workDir, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME },
                stdio: 'pipe',
            });
        } catch (err) {
            status = err.status;
        }
        return {
            status: status,
            args: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [],
        };
    }

    describe('prod', () => {
        it('deploys onto the 2016 stack, on the cluster it runs on', () => {
            var result = deploy('prod');

            expect(result.status).to.equal(0);
            expect(result.args).to.include('--stack-name=deviceMeasurementPopulator');
            expect(result.args).to.include('targetCluster=production-cluster-v2');
        });

        it('stays registered with the legacy target group its current callers reach', () => {
            var result = deploy('prod');

            expect(result.args).to.include(
                'legacyAlbTargetGroupArn=arn:aws:elasticloadbalancing:eu-west-1:545349016803:targetgroup/populator-temp/5426317c060e0e14'
            );
            expect(result.args).to.include('albTargetGroupArnExport=measurements-populator-target-group-arn');
        });

        it('uses the production tables and bucket, not the int ones', () => {
            var result = deploy('prod');

            expect(result.args).to.include.members([
                'devicesTableName=linn.cloud.devices',
                'productDescriptorsTableName=linn.cloud.product-descriptors',
                'productDescriptorsTableIndex=linn.cloud.product-descriptors.index',
                'expireFileDataTable=linn.cloud.expire-s3-objects',
                'deviceFileDataBucket=linn.cloud.filedata',
            ]);
        });
    });

    describe('sys', () => {
        it('deploys single-homed onto its own stack and cluster', () => {
            var result = deploy('sys');

            expect(result.status).to.equal(0);
            expect(result.args).to.include.members([
                '--stack-name=deviceMeasurementPopulator-sys',
                'targetCluster=LinnApiClusterName-sys',
                'legacyAlbTargetGroupArn=none',
                'devicesTableName=linn.cloud.devices.int',
            ]);
        });
    });

    it('refuses any other environment without calling aws', () => {
        var result = deploy('int');

        expect(result.status).to.equal(64);
        expect(result.args).to.deep.equal([]);
    });
});
