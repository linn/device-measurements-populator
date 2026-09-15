'use strict';
var chai = require('chai');
/*jshint -W079 */
var expect = chai.expect;

var fs = require('node:fs');
var path = require('node:path');

// What the deployed template must say about logging.
//
// These assertions read RESOURCE BLOCKS, not the file's text. The first version of this spec matched
// regexes against the raw template and was worthless: every assertion passed with the whole
// LogConfiguration commented out, because the rationale comments beside it contain the same words,
// and `RetentionInDays: 3000` satisfied a `30` pattern that had no right-hand anchor. Both were
// demonstrated before this was rewritten.
//
// Nothing in this repository parses CloudFormation and adding a YAML parser would be a new
// dependency, so the reader below is deliberately small: it splits `Resources:` into its
// two-space-indented children and strips comments. That is enough to say WHICH resource carries a
// property, which is the thing the text version could not see. It still cannot evaluate !Sub or
// validate the schema - and this repository runs no cfn-lint, so nothing else does either.
//
// PRECONDITION: none. Reads a file in the repo.

var TEMPLATE = path.join(__dirname, '..', 'aws', 'deviceMeasurementsPopulatorCloudFormation.yaml');

function stripComments(line) {
    // Only whole-line and trailing comments; no value in this template contains a '#'.
    return line.replace(/\s+#.*$/, '');
}

function resourceBlocks() {
    var lines = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
    var start = lines.findIndex((l) => /^Resources:\s*$/.test(l));
    expect(start, 'the template has no Resources section').to.be.greaterThan(-1);

    var blocks = {};
    var current = null;
    for (let i = start + 1; i < lines.length; i++) {
        const raw = lines[i];
        if (/^\S/.test(raw) && raw.trim() !== '') {
            break;
        } // next top-level section
        if (/^\s*#/.test(raw) || raw.trim() === '') {
            continue;
        } // comment or blank
        const header = /^ {2}(\w+):\s*$/.exec(raw);
        if (header) {
            current = header[1];
            blocks[current] = [];
            continue;
        }
        if (current) {
            blocks[current].push(stripComments(raw));
        }
    }
    Object.keys(blocks).forEach((k) => {
        blocks[k] = blocks[k].join('\n');
    });
    return blocks;
}

function fieldValue(block, key) {
    var m = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(block || '');
    return m ? m[1] : null;
}

describe('populator logging template', () => {
    var blocks;

    before(() => {
        blocks = resourceBlocks();
    });

    it('sends the container output to CloudWatch', () => {
        expect(blocks.taskDefinition, 'no taskDefinition resource').to.be.a('string');
        expect(fieldValue(blocks.taskDefinition, 'LogDriver')).to.equal('awslogs');
    });

    it('writes to the group the template declares, not one the driver invents', () => {
        var driverGroup = fieldValue(blocks.taskDefinition, 'awslogs-group');
        var declaredGroup = fieldValue(blocks.serviceLogGroup, 'LogGroupName');
        expect(driverGroup, 'the driver names no group').to.not.equal(null);
        expect(declaredGroup, 'no group is declared').to.not.equal(null);
        // Quoting is not semantics: compare the expression, not how it was written.
        expect(driverGroup.replace(/['"]/g, '')).to.equal(declaredGroup.replace(/['"]/g, ''));
    });

    it('never lets the driver create the group itself', () => {
        // awslogs-create-group defaults to false, and must stay that way: a driver-created group is
        // created with NO retention and never expires, which is the estate-wide problem that
        // linn/linn-api-development#641 removed from eighteen groups.
        expect(blocks.taskDefinition).to.not.match(/awslogs-create-group/);
    });

    it('expires the group after exactly thirty days', () => {
        expect(fieldValue(blocks.serviceLogGroup, 'RetentionInDays')).to.equal('30');
    });

    it('makes the SERVICE wait for the group, since that is what starts tasks', () => {
        // On the taskDefinition this would order nothing: a task definition never runs anything.
        expect(fieldValue(blocks.service, 'DependsOn')).to.equal('serviceLogGroup');
    });

    it('names the log streams after the service, so a stream can be traced to a task', () => {
        expect(fieldValue(blocks.taskDefinition, 'awslogs-stream-prefix')).to.not.equal(null);
    });
});
