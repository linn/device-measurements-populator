"use strict";
var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var proxyquire = require('proxyquire');

// This spec is self-sufficient: 12factor-config reads these at require time and exits if one is
// missing. They used to arrive as a side effect of whichever spec file mocha loaded first, so the
// file passed in a full run and failed on its own.
Object.assign(process.env, {
    REQUEST_LOGGER_FORMAT: ':method :url',
    AWS_REGION: 'eu-west-1',
    PORT: '0',
    DEVICES_TABLE_NAME: 'devices',
    PRODUCT_DESCRIPTORS_TABLE_NAME: 'descriptors',
    PRODUCT_DESCRIPTORS_TABLE_INDEX: 'descriptors-index',
    EXPIRE_S3_OBJECTS_TABLE_NAME: 'expiries',
    DEVICE_FILE_DATA_BUCKET: 'file-data',
    NODE_ENV: 'test'
});
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);

function generateResponseStub(done) {
    return {
        json: sinon.spy(),
        status: function(statusCode) {
            this.statusCode = statusCode;
            done();
        },
        send: sinon.spy(),
        sendStatus: function(statusCode) {
            this.statusCode = statusCode;
            done();
        },
        set: sinon.spy()
    };
}

function generateRequestStub(acceptHeader, parameters, body) {
    return {
        accepts: function () {
            return this.headers.accept;
        },
        headers: {
            accept: acceptHeader
        },
        params: parameters,
        body: body
    };
}

describe('Exakt Populator Api', function () {
    var sut, expireS3ObjectsRepositoryStub, loadProductDescriptorCallbackArgs, saveProductDescriptorCallbackArgs, productDescriptorRepositoryStub, loadDeviceCallbackArgs, saveDeviceCallbackArgs, deviceRepositoryStub, cloudFileDataRepositoryStub, saveFileCallbackArgs, loadFileCallbackArgs;
    beforeEach(function () {

        loadProductDescriptorCallbackArgs = [];
        saveProductDescriptorCallbackArgs = [];

        productDescriptorRepositoryStub = {
            findById: sinon.spy(function loadCloudProductDescriptorByIdFromStub(productDescriptorId, callback) { callback.apply(null, loadProductDescriptorCallbackArgs); }),
            filterBy: sinon.spy(function loadCloudProductDescriptorFromStub(vendor, productType, callback) { callback.apply(null, loadProductDescriptorCallbackArgs); }),
            addOrReplace: sinon.spy(function saveCloudProductDescriptorToStub(cloudProductDescriptor, callback) { callback.apply(null, saveProductDescriptorCallbackArgs); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); })
        };

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
            addById: sinon.spy(function saveFileByIdToStub(id, filename, data, callback) { callback.apply(null, saveFileCallbackArgs); }),
            findById: sinon.spy(function loadFileFromStub(id, callback) { callback.apply(null, loadFileCallbackArgs); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); })
        };

        expireS3ObjectsRepositoryStub = {
            removeBy: sinon.spy(function removeExpirationByIdStub(id, callback) { callback.apply(); }),
            scheduleForExpirationById: sinon.spy(function scheduleForExpirationByIdStub(id, callback) { callback.apply(); })
        };

        // proxyquire replaces mockery, whose only published versions all carry a critical
        // prototype-pollution advisory with no fix. noCallThru keeps one half of the old behaviour
        // - the stub stands in wholly rather than falling through to the real module - and
        // '@global' keeps the other: mockery substituted a module everywhere in the require graph,
        // where proxyquire alone substitutes only the direct require, and these subjects reach
        // their repositories transitively.
        //
        // The keys are relative to THE MODULE BEING PROXYQUIRED, not to the module that requires
        // the dependency. This subject lives in routes/, so './repositories/x' would resolve to
        // routes/repositories/x - a path nothing requires - and the real repository would load
        // instead, silently, with noCallThru hiding the bad resolve. Verified by driving the route:
        // with './' the stub is never called and execution reaches a live DynamoDB client.
        proxyquire.noCallThru();

        sut = proxyquire('../../routes/exaktPopulatorApi', {
            '../repositories/cloudDeviceRepository': Object.assign(deviceRepositoryStub, { '@global': true }),
            '../repositories/cloudProductDescriptorRepository': Object.assign(productDescriptorRepositoryStub, { '@global': true }),
            '../repositories/fileDataRepository': Object.assign(cloudFileDataRepositoryStub, { '@global': true }),
            '../repositories/expireS3ObjectsRepository': Object.assign(expireS3ObjectsRepositoryStub, { '@global': true })
        });
    });
    describe('When adding a cloud device and serial number does not match URI', function () {
        var next, res, req;
        beforeEach(function (done) {
            req = generateRequestStub(
                'application/json',
                {
                    productDescriptorId: '25c1cf3c-7e53-490c-9020-62f580613ece',
                    serialNumber: 'X2345'
                },
                {
                    serialNumber: "12345",
                    links: [
                        { rel: 'product-descriptor', href: '/product-descriptors/25c1cf3c-7e53-490c-9020-62f580613ece' }
                    ]
                },
                {}
            );
            res = generateResponseStub(done);
            next = function(error) {
                res.statusCode = error.status;
                done();
            };

            sut.addDevice(req, res, next);
        });
        it('Should return bad request', function () {
            expect(res.statusCode).to.eql(400);
        });
        it('Should never do anything with devicerepository', function () {
            expect(deviceRepositoryStub.filterByProductDescriptorId).not.to.have.been.called;
            expect(deviceRepositoryStub.findBy).not.to.have.been.called;
            expect(deviceRepositoryStub.addOrReplace).not.to.have.been.called;
            expect(deviceRepositoryStub.removeBy).not.to.have.been.called;
        });
        it('Should never change anything in S3', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.addById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.findById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
    });
    describe('When adding a cloud device and guid does not match URI', function () {
        var next, res, req;
        beforeEach(function (done) {
            req = generateRequestStub(
                'application/json',
                {
                    productDescriptorId: 'X5c1cf3c-7e53-490c-9020-62f580613ece',
                    serialNumber: '12345'
                },
                {
                    serialNumber: "12345",
                    links: [
                        { rel: 'product-descriptor', href: '/product-descriptors/25c1cf3c-7e53-490c-9020-62f580613ece' }
                    ]
                }
            );
            res = generateResponseStub(done);
            next = function(error) {
                res.statusCode = error.status;
                done();
            };

            sut.addDevice(req, res, next);
        });
        it('Should return bad request', function () {
            expect(res.statusCode).to.eql(400);
        });
        it('Should never do anything with devicerepository', function () {
            expect(deviceRepositoryStub.filterByProductDescriptorId).not.to.have.been.called;
            expect(deviceRepositoryStub.findBy).not.to.have.been.called;
            expect(deviceRepositoryStub.addOrReplace).not.to.have.been.called;
            expect(deviceRepositoryStub.removeBy).not.to.have.been.called;
        });
        it('Should never change anything in S3', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.addById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.findById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
    });
    describe('When adding a cloud product descriptor and guid does not match URI', function () {
        var next, res, req;
        beforeEach(function (done) {
            req = generateRequestStub(
                'application/json',
                {
                    productDescriptorId: 'sdfsdf'
                },
                {}
            );
            res = generateResponseStub(done);
            next = function(error) {
                res.statusCode = error.status;
                done();
            };

            sut.addProductDescriptor(req, res, next);
        });
        it('Should return bad request', function () {
            expect(res.statusCode).to.eql(400);
        });
        it('Should never do anything with devicerepository', function () {
            expect(productDescriptorRepositoryStub.findById).not.to.have.been.called;
            expect(productDescriptorRepositoryStub.filterBy).not.to.have.been.called;
            expect(productDescriptorRepositoryStub.addOrReplace).not.to.have.been.called;
            expect(productDescriptorRepositoryStub.removeBy).not.to.have.been.called;
        });
        it('Should never change anything in S3', function () {
            expect(cloudFileDataRepositoryStub.add).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.addById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.findById).not.to.have.been.called;
            expect(cloudFileDataRepositoryStub.removeBy).not.to.have.been.called;
        });
    });
});