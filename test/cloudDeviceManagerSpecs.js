"use strict";
var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);
var proxyquire = require('proxyquire');

describe('Cloud Device Manager', function () {
    var sut, loadDeviceCallbackArgs, saveDeviceCallbackArgs, deviceRepositoryStub, cloudFileDataRepositoryStub, saveFileCallbackArgs, loadFileCallbackArgs;
    beforeEach(function () {
        loadDeviceCallbackArgs = [];
        saveDeviceCallbackArgs = [];

        deviceRepositoryStub = {
            filterByProductDescriptorId: sinon.spy(function loadCloudProductDescriptorByIdFromStub(productDescriptorId, callback) { callback.apply(null, loadDeviceCallbackArgs); }),
            findBy: sinon.spy(function loadCloudDeviceFromStub(productDescriptorId, serialNumber, callback) { callback.apply(null, loadDeviceCallbackArgs); }),
            addOrReplace: sinon.spy(function saveCloudDeviceToStub(cloudDevice, callback) { callback.apply(null, saveDeviceCallbackArgs); }),
            removeBy: sinon.spy(function deleteCloudDeviceFromStub(productDescriptorId, serialNumber, callback) { callback.apply(); })
        };

        saveFileCallbackArgs = [];
        loadFileCallbackArgs = [];

        cloudFileDataRepositoryStub = {
            add: sinon.spy(function saveFileToStub(filename, data, callback) { callback.apply(null, saveFileCallbackArgs); }),
            addOrReplace: sinon.spy(function saveFileByIdToStub(id, filename, data, callback) { callback.apply(null, saveFileCallbackArgs); }),
            findBy: sinon.spy(function loadFileFromStub(id, callback) { callback.apply(null, loadFileCallbackArgs); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); }),
            generateUri: sinon.spy(function generateUriStub(key) { return "http://linn.cloud.filedata.debug.s3.amazonaws.com/" + key; })
        };

        // proxyquire replaces mockery, whose only published versions all carry a critical
        // prototype-pollution advisory with no fix. noCallThru keeps the previous behaviour -
        // the stub stands in wholly rather than falling through to the real module - and
        // '@global' keeps the other half of it: mockery substituted a module everywhere in the
        // require graph, where proxyquire alone only substitutes the direct require. These
        // subjects reach their repositories transitively, so without it the real module loads.
        proxyquire.noCallThru();

        sut = proxyquire('../cloudDeviceManager', {
            './repositories/cloudDeviceRepository': Object.assign(deviceRepositoryStub, { '@global': true }),
            './repositories/fileDataRepository': Object.assign(cloudFileDataRepositoryStub, { '@global': true })
        });
    });
    describe('When adding malformed device', function () {
        var productDescriptorId, serialNumber, data, result, resultError;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';
            data = require('./data/updateMalformedCloudDeviceResource.json');

            sut.add(productDescriptorId, serialNumber, data, function (err, data) {
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
        var productDescriptorId, serialNumber, data, expectedData, result;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';
            data = require('./data/updateCloudDeviceResource.json');
            expectedData = require('./data/cloudDeviceResource.json');

            saveFileCallbackArgs[1] = {key: 'cd2b7e35-b5c2-4d23-b362-6a6f6cebc618', href:"http://linn.cloud.filedata.debug.s3.amazonaws.com/cd2b7e35-b5c2-4d23-b362-6a6f6cebc618"};
            loadFileCallbackArgs[0] = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
            sut.add(productDescriptorId, serialNumber, data, function (err, data) {
                result = data;
                done();
            });
        });
        it(' Should add file to S3', function () {
            expect(cloudFileDataRepositoryStub.addOrReplace).to.have.been.calledWith("cd2b7e35-b5c2-4d23-b362-6a6f6cebc618", "1336161_UpperBass.tdms", new Buffer(data.components[0].measurements.impedance.file.files[0].data));
        });
        it(' Should not add without id', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
        });
        it(' Should store result in DynamoDb', function () {
            expect(deviceRepositoryStub.addOrReplace).to.have.been.calledWith(result);
        });
        it(' Should invoke callback with correct json', function () {
            expect(result).to.be.eql(expectedData);
        });
    });
    describe('When adding file that is already there', function () {
        var productDescriptorId, serialNumber, data, expectedData, result;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';
            data = require('./data/updateCloudDeviceResource.json');
            expectedData = require('./data/cloudDeviceResource.json');

            saveFileCallbackArgs[1] = {key: '5b61b280-bb73-11e4-ba72-9dec41bc3eb3', href:"http://linn.cloud.filedata.debug.s3.amazonaws.com/5b61b280-bb73-11e4-ba72-9dec41bc3eb3"};
            loadFileCallbackArgs[1] = {filename : "1336161_UpperBass.tdms"};
            sut.add(productDescriptorId, serialNumber, data, function (err, data) {
                result = data;
                done();
            });
        });
        it(' Should not add file to S3', function () {
            expect(cloudFileDataRepositoryStub.addOrReplace).not.to.have.been.called;
        });
        it(' Should not add without id', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
        });
        it(' Should store result in DynamoDb', function () {
            expect(deviceRepositoryStub.addOrReplace).to.have.been.calledWith(result);
        });
        it(' Should invoke callback with correct json', function () {
            expect(result).to.be.eql(expectedData);
        });
    });
    describe('When replacing existing cloud device', function () {
        var productDescriptorId, serialNumber, data, expectedData, existingData, result;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';
            data = require('./data/updateCloudDeviceResource.json');
            existingData = require('./data/existingCloudDeviceResource.json');
            expectedData = require('./data/cloudDeviceResource.json');

            loadDeviceCallbackArgs[1] = existingData;
            loadFileCallbackArgs[0] = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
            saveFileCallbackArgs[1] = {key: 'cd2b7e35-b5c2-4d23-b362-6a6f6cebc618', href:"http://linn.cloud.filedata.debug.s3.amazonaws.com/cd2b7e35-b5c2-4d23-b362-6a6f6cebc618"};

            sut.add(productDescriptorId, serialNumber, data, function (err, data) {
                result = data;
                done();
            });
        });
        it(' Should not delete s3 data', function () {
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
        it(' Should remove device from repository', function () {
            expect(deviceRepositoryStub.removeBy).to.have.been.calledWith(productDescriptorId, serialNumber);
        });
        it(' Should add file to S3', function () {
            expect(cloudFileDataRepositoryStub.addOrReplace).to.have.been.calledWith("cd2b7e35-b5c2-4d23-b362-6a6f6cebc618", "1336161_UpperBass.tdms", new Buffer(data.components[0].measurements.impedance.file.files[0].data));
        });
        it(' Should not add without id', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
        });
        it(' Should store result in DynamoDb', function () {
            expect(deviceRepositoryStub.addOrReplace).to.have.been.calledWith(result);
        });
        it(' Should invoke callback with correct json', function () {
            expect(result).to.be.eql(expectedData);
        });
    });
    describe('When removing', function () {
        var productDescriptorId, serialNumber, data;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';
            data = require('./data/cloudDeviceResource.json');

            loadDeviceCallbackArgs[1] = data;

            sut.remove(productDescriptorId, serialNumber, done);
        });
        it(' Should retrieve device from repository', function () {
            expect(deviceRepositoryStub.findBy).to.have.been.calledWith(productDescriptorId, serialNumber);
        });
        it(' Should not delete s3 data', function () {
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
        it(' Should remove device from repository', function () {
            expect(deviceRepositoryStub.removeBy).to.have.been.calledWith(productDescriptorId, serialNumber);
        });
    });
    describe('When removing device that does not exist', function () {
        var productDescriptorId, serialNumber;
        beforeEach(function (done) {
            productDescriptorId = '25c1cf3c-7e53-490c-9020-62f580613ece';
            serialNumber = '12345';

            sut.remove(productDescriptorId, serialNumber, done);
        });
        it(' Should retrieve device from repository', function () {
            expect(deviceRepositoryStub.findBy).to.have.been.calledWith(productDescriptorId, serialNumber);
        });
        it(' Should not remove device from repository', function () {
            expect(deviceRepositoryStub.removeBy).not.to.have.been.called;
        });
    });
});