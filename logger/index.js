'use strict';
const winston = require('winston');

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [new winston.transports.Console({ handleExceptions: false })],
});

const stream = {
    write: (message) => {
        logger.info(message);
    },
};

// winston 3 writes `level` and `timestamp` ONTO an object it is handed, so logging an Error mutates
// the caller's Error - and the express handler serialises that same object into the response body,
// which is how winston internals reached a client. Reducing an Error to its text here keeps the
// stack (winston puts it in `message` anyway) and leaves the caller's object untouched.
function loggable(value) {
    return value instanceof Error ? value.stack || value.message : value;
}

module.exports = {
    stream: stream,
    info: (value) => logger.info(loggable(value)),
    debug: (value) => logger.debug(loggable(value)),
    warn: (value) => logger.warn(loggable(value)),
    error: (value) => logger.error(loggable(value)),
};
