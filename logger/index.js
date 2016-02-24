"use strict";
let winston = require('winston');

let logger = new winston.Logger({
    transports: [
        new winston.transports.Console({
            timestamp: function() {
                return new Date().toISOString();
            },
            level: 'debug',
            handleExceptions: false,
            json: false,
            colorize: false
        })
    ]
});

let stream = {
    write: function(message, encoding) {
        logger.info(message);
    }
};

module.exports = {
    stream: stream,
    info: logger.info,
    debug: logger.debug,
    warn: logger.warn,
    error: logger.error
};