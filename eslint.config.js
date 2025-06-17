import js from '@eslint/js'
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
      globals: {
        // Node.js globals
        process: true,
        console: true,
        Buffer: true,
        setTimeout: true,
        clearTimeout: true,
        setInterval: true,
        clearInterval: true,
        __dirname: true,
        __filename: true,
        // Web globals
        fetch: true
      }
    },
    rules: {
      'semi': ['error', 'never'],
      '@typescript-eslint/semi': ['error', 'never'],
      'quotes': ['warn', 'single'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  },
  js.configs.recommended
] 