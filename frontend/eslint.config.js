import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // react-hooks 7 moved the flat configs under .flat; the top-level ones
      // are still the legacy eslintrc shape and ESLint 10 rejects them.
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'off', // TypeScript already resolves identifiers
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // The migration from JSX left explicit `any` where props were never
      // typed; see the note about noImplicitAny in tsconfig.app.json.
      '@typescript-eslint/no-explicit-any': 'off',

      // New in eslint-plugin-react-hooks 7, which folded in the React Compiler
      // rules. They flag long-standing patterns (21 effects that call setState
      // to reset local state when a prop changes) rather than defects, and
      // clearing them means restructuring component state -- not something to
      // fold into the TypeScript migration. Left off deliberately so the rest
      // of the ruleset can gate today.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // shadcn-style ui components, context providers and the workspace layer
    // intentionally export helpers (variants, hooks) next to their components
    files: ['src/components/ui/**/*.tsx', 'src/context/**/*.tsx', 'src/workspace/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
