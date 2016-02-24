"use strict";
var chai = require("chai");
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
/*jshint -W079 */
var expect = chai.expect;
chai.use(sinonChai);

var mockery = require('mockery');

describe('Remove expired objects processor', function () {
    var sut, expireS3ObjectsRepositoryStub, fileDataRepositoryStub, listObjectsForRemovalCallbackArgs, loggerStub;
    beforeEach(function () {
        listObjectsForRemovalCallbackArgs = [];
        loggerStub = {
            info: sinon.spy(),
            error: sinon.spy()
        };

        fileDataRepositoryStub = {
            add: sinon.spy(function saveFileToStub(filename, data, callback) { callback.apply(null, null); }),
            findBy: sinon.spy(function loadFileFromStub(id, callback) { callback.apply(null, null); }),
            removeBy: sinon.spy(function deleteFileFromStub(id, callback) { callback.apply(); })
        };

        expireS3ObjectsRepositoryStub = {
            removeBy: sinon.spy(function removeExpirationByIdStub(id, callback) { callback.apply(); }),
            scheduleForExpirationById: sinon.spy(function scheduleForExpirationByIdStub(id, callback) { callback.apply(); }),
            listObjectsDueForRemoval: sinon.spy(function listObjectsDueForRemovalStub(callback) {callback.apply(null, listObjectsForRemovalCallbackArgs); })
        };

        mockery.enable({ useCleanCache: true });
        mockery.registerMock('./repositories/fileDataRepository', fileDataRepositoryStub);
        mockery.registerMock('./repositories/expireS3ObjectsRepository', expireS3ObjectsRepositoryStub);
        mockery.registerMock('./logger', loggerStub);
        mockery.warnOnUnregistered(false);

        sut = require('../removeExpiredObjectsProcessor');
    });
    afterEach(function () {
        mockery.deregisterAll();
        mockery.disable();
    });
    describe('When removing expired objects', function () {
        beforeEach(function () {
            listObjectsForRemovalCallbackArgs.push(null, require('./data/expiredObjectsToBeRemoved.json'));
            sut.removeExpiredObjects();
        });
        it(' Should list objects to be removed', function () {
            expect(expireS3ObjectsRepositoryStub.listObjectsDueForRemoval).to.have.been.called;
        });
        it(' Should remove the objects', function(){
            expect(fileDataRepositoryStub.removeBy).to.have.been.calledWith("551d348721fbe41de89b2024");
            expect(fileDataRepositoryStub.removeBy).to.have.been.calledWith("551d348721fbe41de89b2025");
        });
        it(' Should remove the records from the dynamoDb table', function(){
            expect(expireS3ObjectsRepositoryStub.removeBy).to.have.been.calledWith("551d348721fbe41de89b2024");
            expect(expireS3ObjectsRepositoryStub.removeBy).to.have.been.calledWith("551d348721fbe41de89b2025");
        });
    });
});