// @faker-js/faker is ESM-only from v10 on. See ./nodeRequire.js for why this
// shim exists; wired up in jest.config.js under moduleNameMapper.
module.exports = require('./nodeRequire')('@faker-js/faker');
