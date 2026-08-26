// uuid is ESM-only from v12 on. See ./nodeRequire.js for why this shim exists;
// wired up in jest.config.js under moduleNameMapper.
module.exports = require('./nodeRequire')('uuid');
