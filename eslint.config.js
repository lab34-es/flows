const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'frontend/**',
      'website/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.claude/**',
      '*.min.js',
      // Templates copied into the user's context directory: they import
      // 'lab34-flows', which only resolves once they have been seeded.
      'src/defaults/**'
    ]
  },

  // Base configuration for the TypeScript sources and tests
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      // Error prevention
      'no-console': 'off', // Allow console.log in Node.js
      'no-undef': 'off',   // TypeScript already resolves identifiers
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        // `const { secret, ...rest } = obj` is how several helpers strip a
        // field; the omitted binding is the point, not an oversight.
        ignoreRestSiblings: true
      }],
      'no-unreachable': 'error',

      // The migration from JavaScript left explicit `any` in the genuinely
      // dynamic corners (user YAML, provider configs). Flagging every one of
      // them would be noise until noImplicitAny is switched on.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // New in ESLint 10 and both flag long-standing patterns rather than
      // defects. Rewriting them means changing runtime control flow, which
      // does not belong in the TypeScript migration -- left off deliberately
      // so the rest of the ruleset can gate CI today.
      //
      // no-useless-assignment: 8 sites initialise a `let` defensively before
      // every branch reassigns it.
      // no-async-promise-executor: one async executor in the playwright
      // browser launch path.
      'no-useless-assignment': 'off',
      'no-async-promise-executor': 'off',

      // Best practices
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],

      // Code style
      'indent': ['error', 2, { SwitchCase: 1 }],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }],
      'max-len': ['error', {
        code: 120,
        ignoreComments: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true
      }],

      // Node.js specific
      'no-process-exit': 'off',
      'handle-callback-err': 'error'
    }
  },

  // Test files
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-unused-expressions': 'off' // Often used in test assertions
    }
  },

  // Plain CommonJS tooling scripts
  {
    files: ['scripts/**/*.js', 'tests/shims/**/*.js', 'eslint.config.js', 'jest.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  }
);
