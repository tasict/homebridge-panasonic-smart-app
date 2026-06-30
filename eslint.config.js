const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'module',
    },
    rules: {
      'quotes': ['warn', 'single'],
      'indent': ['warn', 2, { SwitchCase: 1 }],
      'semi': ['error', 'always'],
      'comma-dangle': ['warn', 'always-multiline'],
      'dot-notation': 'off',
      'eqeqeq': 'warn',
      'eol-last': ['warn', 'always'],
      'curly': ['warn', 'all'],
      'brace-style': ['warn'],
      'prefer-arrow-callback': ['warn'],
      'max-len': ['warn', 100],
      'no-console': ['warn'],
      'comma-spacing': ['error'],
      'no-multi-spaces': ['warn', { ignoreEOLComments: false }],
      'no-trailing-spaces': ['warn'],
      'lines-between-class-members': ['warn', 'always', { exceptAfterSingleLine: true }],
      'operator-linebreak': ['warn', 'before', { overrides: { '?': 'before', ':': 'before' } }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
);
