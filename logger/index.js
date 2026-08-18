"use strict";
let winston = require('winston');

let logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(function (info) {
            return info.timestamp + ' ' + info.level + ': ' + info.message;
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

// winston 3 writes `level` and `timestamp` ONTO an object it is handed, so logging an Error mutates
// the caller's Error - and the express handler serialises that same object into the response body,
// which is how winston internals reached a client. Reducing an Error to its text here keeps the
// stack (winston puts it in `message` anyway) and leaves the caller's object untouched.
function loggable(value) {
    return value instanceof Error ? (value.stack || value.message) : value;
}

module.exports = {
    stream: stream,
    info: function (value) { return logger.info(loggable(value)); },
    debug: function (value) { return logger.debug(loggable(value)); },
    warn: function (value) { return logger.warn(loggable(value)); },
    error: function (value) { return logger.error(loggable(value)); }
};
