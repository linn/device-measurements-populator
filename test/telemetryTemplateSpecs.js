"use strict";
var chai = require("chai");
/*jshint -W079 */
var expect = chai.expect;

var fs = require('fs');
var path = require('path');

// What the deployed template must say about logging.
//
// Asserted on the template TEXT, not on a parse: nothing in this repo parses CloudFormation, and its
// short tags (!Sub, !Ref) are not plain YAML. So these pin strings and cannot see structure - a
// LogConfiguration attached to the wrong resource would still satisfy them. cfn-lint in CI is what
// checks the shape.
//
// The invariant worth pinning is the pair: the driver writes to the group NAMED in its options, and
// only the group DECLARED as a resource carries retention. If the two names ever drift apart, the
// driver silently creates its own group with no expiry - which is exactly the estate-wide problem
// linn/linn-api-development#641 spent a week removing, and the reason this ticket exists.
//
// PRECONDITION: none. Reads a file in the repo.
describe('populator logging template', function () {
    var template;

    before(function () {
        template = fs.readFileSync(
            path.join(__dirname, '..', 'aws', 'deviceMeasurementsPopulatorCloudFormation.yaml'),
            'utf8'
        );
    });

    it('sends container output to CloudWatch', function () {
        expect(template).to.match(/LogDriver:\s*awslogs/);
    });

    it('writes to the group it declares, so the driver never creates an unexpiring one itself', function () {
        var driverGroup = /awslogs-group:\s*(.+)/.exec(template);
        var declaredGroup = /LogGroupName:\s*(.+)/.exec(template);
        expect(driverGroup, 'no awslogs-group option').to.not.equal(null);
        expect(declaredGroup, 'no LogGroupName declared').to.not.equal(null);
        expect(driverGroup[1].trim()).to.equal(declaredGroup[1].trim());
    });

    it('expires the group, because a group without retention is kept forever', function () {
        expect(template).to.match(/RetentionInDays:\s*30/);
    });

    it('creates the group before the service can start writing to it', function () {
        expect(template).to.match(/DependsOn:\s*serviceLogGroup/);
    });
});
