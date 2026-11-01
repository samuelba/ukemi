import * as esbuild from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

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

// The standalone app. Its pages load from the ukemi:// scheme, which serves dist/.
const desktopBuilds = [
  {
    ...common,
    entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'],
    outdir: 'dist/desktop',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // node-pty is native. It ships next to the bundle, unpacked from the app archive.
    external: ['electron', 'node-pty'],
  },
  {
    ...common,
    entryPoints: { desktop: 'webview/src/desktop/main.tsx' },
    outdir: 'dist/desktop',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    loader: { '.ttf': 'file' },
    define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
  },
]

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
].join('; ')

function page(title, styles, scripts) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
${styles.map((href) => `  <link rel="stylesheet" href="${href}">`).join('\n')}
</head>
<body>
  <div id="root"></div>
${scripts.map((src) => `  <script src="${src}"></script>`).join('\n')}
</body>
</html>
`
}

function writePages() {
  mkdirSync('dist/desktop', { recursive: true })
  writeFileSync('dist/desktop/desktop.html', page('Ukemi', ['desktop.css'], ['desktop.js']))
}

const withDesktop = !process.argv.includes('--extension-only')
const allBuilds = withDesktop ? [...builds, ...desktopBuilds] : builds
if (withDesktop) {
  writePages()
}

if (isWatch) {
  const contexts = await Promise.all(allBuilds.map((b) => esbuild.context(b)))
  await Promise.all(contexts.map((c) => c.watch()))
} else {
  await Promise.all(allBuilds.map((b) => esbuild.build(b)))
}
