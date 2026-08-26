// A require that loads ESM-only packages, for jest to lean on.
//
// Several dependencies (@faker-js/faker, uuid) now ship ESM only. Node loads
// them from our CommonJS build through require(esm) -- that is what the
// >=20.19 engine floor buys us -- but jest's module registry predates that and
// parses those bundles as CommonJS, where `import`/`export` is a syntax error.
//
// process.getBuiltinModule reaches the genuine `node:module`, rather than the
// registry-aware one jest hands back from require('module'): that one applies
// moduleNameMapper, so a shim asking for its own package name would resolve
// back to itself and get a half-built module. The real createRequire loads the
// real package, so the suites exercise it instead of a mock.
module.exports = process.getBuiltinModule('module').createRequire(__filename);
