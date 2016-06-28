"use strict";
var mockery = require('mockery');

var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);

describe('Cloud Product Descriptor Manager', function () {
    var sut, loadProductDescriptorCallbackArgs, saveProductDescriptorCallbackArgs, productDescriptorRepositoryStub, cloudFileDataRepositoryStub, saveFileCallbackArgs, loadFileCallbackArgs;
    beforeEach(function () {
        loadProductDescriptorCallbackArgs = [];
        saveProductDescriptorCallbackArgs = [];

        productDescriptorRepositoryStub = {
            findBy: sinon.spy(function loadCloudProductDescriptorByIdFromStub(productDescriptorId, callback) { callback.apply(null, loadProductDescriptorCallbackArgs); }),
            filterBy: sinon.spy(function loadCloudProductDescriptorFromStub(vendor, productType, callback) { callback.apply(null, loadProductDescriptorCallbackArgs); }),
            addOrReplace: sinon.spy(function saveCloudProductDescriptorToStub(cloudProductDescriptor, callback) { callback.apply(null, saveProductDescriptorCallbackArgs); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); })
        };

        saveFileCallbackArgs = [];
        loadFileCallbackArgs = [];

        cloudFileDataRepositoryStub = {
            generateUri: sinon.spy(),
            add: sinon.spy(function saveFileToStub(filename, data, callback) { callback.apply(null, saveFileCallbackArgs); }),
            addOrReplace: sinon.spy(function saveFileByIdToStub(id, filename, data, callback) { callback.apply(null, saveFileCallbackArgs); }),
            findBy: sinon.spy(function loadFileFromStub(id, callback) { callback.apply(null, loadFileCallbackArgs); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); })
        };

        mockery.enable({ useCleanCache: true });
        mockery.registerMock('./repositories/cloudProductDescriptorRepository', productDescriptorRepositoryStub);
        mockery.registerMock('./repositories/fileDataRepository', cloudFileDataRepositoryStub);
        mockery.warnOnUnregistered(false);

        sut = require('../cloudProductDescriptorManager');
    });
    afterEach(function () {
        mockery.deregisterAll();
        mockery.disable();
    });
    describe('When adding with malformed product descriptor', function () {
        var productDescriptorId, data, resultError, result;
        beforeEach(function (done) {
            productDescriptorId = 'e8082b8c-f1ee-4a61-8ad7-0e55779ee6be';
            data = require('./data/updateMalformedCloudProductDescriptorResource.json');

            sut.add(productDescriptorId, data, function (err, data) {
                resultError = err;
                result = data;
                done();
            });
        });
        it(' Should invoke callback with error', function () {
            expect(resultError).to.exist;
            expect(result).to.be.undefined;
        });
    });
    describe('When adding', function () {
        var productDescriptorId, data, expectedData, result;
        beforeEach(function (done) {
            productDescriptorId = 'e8082b8c-f1ee-4a61-8ad7-0e55779ee6be';
            data = require('./data/updateCloudProductDescriptorResource.json');
            expectedData = require('./data/cloudProductDescriptorResource.json');

            saveFileCallbackArgs[1] = {key: '5b61b280-bb73-11e4-ba72-9dec41bc3eb3', href:"http://linn.cloud.filedata.debug.s3.amazonaws.com/5b61b280-bb73-11e4-ba72-9dec41bc3eb3"};
            loadFileCallbackArgs[0] = {code : "NoSuchKey"};

            sut.add(productDescriptorId, data, function (err, data) {
                result = data;
                done();
            });
        });
        it(' Should add file to S3', function () {
            expect(cloudFileDataRepositoryStub.addOrReplace).to.have.been.calledWith("1c6528c8-819f-4d28-9cea-768b62e7bcdf", "1336161_UpperBass.tdms", new Buffer(data.components[0].measurements.impedance.file.files[0].data));
        });
        it(' Should not add without id', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
        });
        it(' Should store result in DynamoDb', function () {
            expect(productDescriptorRepositoryStub.addOrReplace).to.have.been.calledWith(result);
        });
        it(' Should invoke callback with correct json', function () {
            expect(result).to.be.eql(expectedData);
        });
    });
    describe('When replacing existing product descriptor', function () {
        var productDescriptorId, data, existingData, oldImpedanceFileId, expectedData, result;
        beforeEach(function (done) {
            oldImpedanceFileId = '5b61b280-bb73-11e4-ba72-9dec41bc3eb4';
            productDescriptorId = 'e8082b8c-f1ee-4a61-8ad7-0e55779ee6be';
            existingData = require('./data/existingCloudProductDescriptorResource.json');
            data = require('./data/updateCloudProductDescriptorResource.json');
            expectedData = require('./data/cloudProductDescriptorResource.json');

            saveFileCallbackArgs[1] = {key: '5b61b280-bb73-11e4-ba72-9dec41bc3eb3', href:"http://linn.cloud.filedata.debug.s3.amazonaws.com/5b61b280-bb73-11e4-ba72-9dec41bc3eb3"};
            loadFileCallbackArgs[0] = {code : "NoSuchKey"};
            loadProductDescriptorCallbackArgs[1] = existingData;

            sut.add(productDescriptorId, data, function (err, data) {
                result = data;
                done();
            });
        });
        it(' Should not delete s3 data', function () {
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
        it(' Should add file to S3', function () {
            expect(cloudFileDataRepositoryStub.addOrReplace).to.have.been.calledWith("1c6528c8-819f-4d28-9cea-768b62e7bcdf", "1336161_UpperBass.tdms", new Buffer(data.components[0].measurements.impedance.file.files[0].data));
        });
        it(' Should not add without id', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
        });
        it(' Should store result in DynamoDb', function () {
            expect(productDescriptorRepositoryStub.addOrReplace).to.have.been.calledWith(result);
        });
        it(' Should invoke callback with correct json', function () {
            expect(result).to.be.eql(expectedData);
        });
    });
    describe('When removing existing product descriptor', function () {
        var productDescriptorId, oldImpedanceFileId;
        beforeEach(function (done) {
            oldImpedanceFileId = '5b61b280-bb73-11e4-ba72-9dec41bc3eb4';
            productDescriptorId = 'e8082b8c-f1ee-4a61-8ad7-0e55779ee6be';

            loadProductDescriptorCallbackArgs[1] = require('./data/existingCloudProductDescriptorResource.json');

            sut.remove(productDescriptorId, done);
        });
        it(' Should delete the existing product descriptor', function () {
            expect(productDescriptorRepositoryStub.removeBy).to.have.been.calledWith(productDescriptorId);
        });
        it(' Should not add anything S3', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.addOrReplace).not.to.have.been.called;
        });
        it(' Should not store anything in DynamoDb', function () {
            expect(productDescriptorRepositoryStub.addOrReplace).not.to.have.been.called;
        });
    });
});