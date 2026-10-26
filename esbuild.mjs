import * as esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')
const isProduction = process.argv.includes('--production')

const common = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  logLevel: 'info',
}

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['src/split/splitTool.ts'],
    outfile: 'dist/splitTool.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
  },
  {
    ...common,
    entryPoints: ['src/askpass/askpassMain.ts'],
    outfile: 'dist/askpass.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
  },
  {
    ...common,
    entryPoints: {
      graph: 'webview/src/graph/main.tsx',
      split: 'webview/src/split/main.tsx',
      cleanup: 'webview/src/cleanup/main.tsx',
    },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    loader: { '.ttf': 'file' },
    define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
  },
]

if (isWatch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)))
  await Promise.all(contexts.map((c) => c.watch()))
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)))
}
