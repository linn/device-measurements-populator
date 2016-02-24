"use strict";
var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);

var mockery = require('mockery');

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

        mockery.enable({ useCleanCache: true });
        mockery.registerMock('./cloudDeviceManager', cloudDeviceManagerStub);
        mockery.registerMock('./cloudProductDescriptorManager', cloudProductDescriptorManagerStub);
        mockery.registerMock('./repositories/cloudDeviceRepository', deviceRepositoryStub);
        mockery.warnOnUnregistered(false);

        sut = require('../unpublishService');
    });
    afterEach(function () {
        mockery.deregisterAll();
        mockery.disable();
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