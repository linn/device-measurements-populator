var pingResource = require('../ping.json');

module.exports.ping = function ping(req, res, next){
    res.json(pingResource);
};
