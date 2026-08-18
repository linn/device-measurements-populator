"use strict";
let winston = require('winston');

let logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(function (info) {
            return info.timestamp + ' ' + info.level + ': ' + (info.stack || info.message);
        })
    ),
    transports: [
        new winston.transports.Console({ handleExceptions: false })
    ]
});

let stream = {
    write: function(message) {
        logger.info(message);
    }
};

// Bound rather than passed by reference: winston 3's level methods read `this`, so exporting them
// bare gives every caller an undefined logger.
module.exports = {
    stream: stream,
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
};
