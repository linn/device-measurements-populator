"use strict";
var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);

var proxyquire = require('proxyquire');

describe('Unpublishing Service', function () {
    var sut,
        addDeviceCallbackArgs,
        removeDeviceCallbackArgs,
        addProductDescriptorCallbackArgs,
        removeProductDescriptorCallbackArgs,
        cloudDeviceManagerStub,
        cloudProductDescriptorManagerStub,
        saveDeviceCallbackArgs,
        loadDeviceCallbackArgs,
        deviceRepositoryStub;
    beforeEach(function () {
        addDeviceCallbackArgs = [];
        removeDeviceCallbackArgs = [];
        addProductDescriptorCallbackArgs = [];
        removeProductDescriptorCallbackArgs = [];

        cloudDeviceManagerStub = {
            add: sinon.spy(function addStub(productDescriptorId, serialNumber, updateCloudDeviceResource, callback) { callback.apply(null, addDeviceCallbackArgs); }),
            remove: sinon.spy(function removeStub(productDescriptorId, serialNumber, callback) { callback.apply(null, removeDeviceCallbackArgs); })
        };

        cloudProductDescriptorManagerStub = {
            add: sinon.spy(function addStub(productDescriptorId, callback) { callback.apply(null, addProductDescriptorCallbackArgs); }),
            remove: sinon.spy(function removeStub(productDescriptorId, callback) { callback.apply(null, removeProductDescriptorCallbackArgs); })
        };

        loadDeviceCallbackArgs = [];
        saveDeviceCallbackArgs = [];

        deviceRepositoryStub = {
            filterByProductDescriptorId: sinon.spy(function loadCloudProductDescriptorByIdFromStub(productDescriptorId, callback) { callback.apply(null, loadDeviceCallbackArgs); }),
            findBy: sinon.spy(function loadCloudDeviceFromStub(productDescriptorId, serialNumber, callback) { callback.apply(null, loadDeviceCallbackArgs); }),
            addOrReplace: sinon.spy(function saveCloudDeviceToStub(cloudDevice, callback) { callback.apply(null, saveDeviceCallbackArgs); }),
            removeBy: sinon.spy(function deleteCloudDeviceFromStub(productDescriptorId, serialNumber, callback) { callback.apply(); })
        };

        // proxyquire replaces mockery, whose only published versions all carry a critical
        // prototype-pollution advisory with no fix. noCallThru keeps the previous behaviour -
        // the stub stands in wholly rather than falling through to the real module - and
        // '@global' keeps the other half of it: mockery substituted a module everywhere in the
        // require graph, where proxyquire alone only substitutes the direct require. These
        // subjects reach their repositories transitively, so without it the real module loads.
        proxyquire.noCallThru();

        sut = proxyquire('../unpublishService', {
            './cloudDeviceManager': Object.assign(cloudDeviceManagerStub, { '@global': true }),
            './cloudProductDescriptorManager': Object.assign(cloudProductDescriptorManagerStub, { '@global': true }),
            './repositories/cloudDeviceRepository': Object.assign(deviceRepositoryStub, { '@global': true })
        });
    });
    describe('When deleting a product descriptor', function () {
        var result, productDescriptorId;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            sut.unpublish(productDescriptorId, function (err, data) {
                result = data;
                done();
            });
        });
        it('should call product descriptor manager remove', function () {
            expect(cloudProductDescriptorManagerStub.remove).to.have.been.calledWith(productDescriptorId);
        });
        it('should result in true', function () {
            expect(result).to.be.true;
        });
    });
    describe('When deleting a product descriptor which has existing devices', function () {
        var result, productDescriptorId, deviceSerialNumber;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            deviceSerialNumber = '12345';

            loadDeviceCallbackArgs[1] = [require('./data/existingCloudDeviceResource.json')];

            sut.unpublish(productDescriptorId, function (err, data) {
                result = data;
                done();
            });
        });
        it('should call device manager remove', function () {
            expect(cloudDeviceManagerStub.remove).to.have.been.calledWith(productDescriptorId, deviceSerialNumber);
        });
        it('should call product descriptor manager remove', function () {
            expect(cloudProductDescriptorManagerStub.remove).to.have.been.calledWith(productDescriptorId);
        });
        it('should result in true', function () {
            expect(result).to.be.true;
        });
    });
});