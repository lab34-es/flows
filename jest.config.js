/**
 * Jest configuration.
 *
 * Coverage gate: CI fails the build (and therefore the PR) when any metric
 * drops below its threshold, so coverage cannot silently erode.
 *
 * `collectCoverageFrom` deliberately covers all of src rather than only the
 * files a test happens to import. Without it, a module with no tests at all
 * simply would not appear in the report and the percentage would flatter
 * itself -- which is exactly how this repo used to report 73% while real
 * coverage was 49%.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',

  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },

  // An application imports the package that runs it. At run time that is
  // resolved by helpers/appLoader, which patches Node's resolver -- machinery
  // jest's own resolver does not go through, so the same alias is declared
  // here. Tests therefore exercise src, not a possibly stale dist.
  moduleNameMapper: {
    '^@lab34/flows$': '<rootDir>/src/index.ts',
    '^lab34-flows$': '<rootDir>/src/index.ts',

    // ESM-only packages jest cannot parse; the shims pull them in through
    // Node's own resolver. See tests/shims/nodeRequire.js.
    '^@faker-js/faker$': '<rootDir>/tests/shims/faker.js',
    '^uuid$': '<rootDir>/tests/shims/uuid.js'
  },

  testMatch: ['<rootDir>/tests/**/*.test.ts'],

  // Claude Code keeps scratch worktrees under .claude/worktrees; without this
  // jest discovers their suites too and runs everything several times over.
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.claude/'],

  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],

  // The console spies in tests/jest.setup.ts are re-installed per test, so the
  // previous one has to be restored or they would nest run after run.
  restoreMocks: true,

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    // Templates copied into the user's context directory and executed there;
    // never imported by the package itself.
    '!src/defaults/**'
  ],

  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'cobertura'],
  coverageDirectory: 'coverage',

  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80
    }
  }
};
