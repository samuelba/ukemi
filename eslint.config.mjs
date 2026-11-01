import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
      '.vscode-test/**',
      'scripts/preview/state.generated.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The shared core and app layer run in both hosts, so neither may reach for a host API.
    files: ['shared/**', 'src/**'],
    ignores: ['src/extension.ts', 'src/vscode/**', 'src/desktop/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['vscode', 'electron'], patterns: ['**/vscode/**', '**/desktop/**'] },
      ],
    },
  },
  {
    files: ['src/vscode/**', 'src/extension.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['electron'], patterns: ['**/desktop/**'] }],
    },
  },
  {
    files: ['src/desktop/**', 'webview/src/desktop/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['vscode'], patterns: ['**/vscode/**'] }],
    },
  },
)
