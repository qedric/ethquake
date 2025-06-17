import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  {
    ignores: ['dist/**/*']
  },
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        // Add Node.js globals
        global: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        // Add browser globals if you're using them
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly'
      }
    },
    rules: {
      'semi': ['error', 'never'],
      '@typescript-eslint/semi': ['error', 'never'],
      'quotes': ['warn', 'single'],
      'no-unused-vars': 'warn',
      'import/no-duplicates': 'error',
      'import/export': 'error'
    }
  },
  js.configs.recommended
] 