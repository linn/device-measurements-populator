var pingResource = require('../ping.json');

module.exports.ping = function ping(_req, res, _next) {
    res.json(pingResource);
};
