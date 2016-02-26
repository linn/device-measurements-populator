"use strict";

var express = require('express');
var path = require('path');
var requestLogger = require('morgan');
var bodyParser = require('body-parser');

var log = require('./logger');
var config = require('./config');
var exaktPopulatorApi = require('./routes/exaktPopulatorApi');
var pingApi = require('./routes/pingApi');
var removeExpiredProcessor = require('./removeExpiredObjectsProcessor');
var app = express();

var removeExpiredInterval = setInterval(removeExpiredProcessor.removeExpiredObjects, 86400000);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.static(path.join(__dirname, 'public')));

app.use(requestLogger(config.requestLoggerFormat, { stream: log.stream }));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: false }));

app.put('/cloud-devices/:productDescriptorId/:serialNumber', exaktPopulatorApi.addDevice);
app.delete('/cloud-devices/:productDescriptorId/:serialNumber', exaktPopulatorApi.removeDevice);

app.put('/cloud-product-descriptors/:productDescriptorId', exaktPopulatorApi.addProductDescriptor);
app.delete('/cloud-product-descriptors/:productDescriptorId', exaktPopulatorApi.removeProductDescriptor);

app.get('/ping', pingApi.ping);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handler
app.use(function(err, req, res, next) {
    if (!err.status || err.status >= 500) {
        log.error(err);
    }
    res.status(err.status || 500);
    if (!req.accepts('html')) {
        res.json({
            message: err.message,
            error: config.showStackTraceOnError ? err : {}
        });
    } else {
        res.render('error', {
            message: err.message,
            error: config.showStackTraceOnError ? err : {}
        });
    }
});

module.exports = app;
