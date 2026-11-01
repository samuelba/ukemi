import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'shared/**/*.ts', 'webview/src/**/*.ts'],
      // Entry points that need a running editor or Electron. The e2e suites cover them.
      exclude: [
        'src/extension.ts',
        'src/**/vscode*.ts',
        'src/desktop/main.ts',
        'src/desktop/session.ts',
        'src/desktop/preload.ts',
      ],
    },
  },
  resolve: {
    alias: { vscode: new URL('./test/mocks/vscode.ts', import.meta.url).pathname },
  },
})
