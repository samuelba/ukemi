import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'shared/**/*.ts', 'webview/src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/**/vscode*.ts'],
    },
  },
  resolve: {
    alias: { vscode: new URL('./test/mocks/vscode.ts', import.meta.url).pathname },
  },
})
