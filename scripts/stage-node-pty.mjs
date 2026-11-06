// Gets node-pty's native files ready to run and to package.
//
// Linux: node-pty ships prebuilt binaries for macOS and Windows only, and compiles one into
// build/Release at install time. The app packages only prebuilds/<platform>-<arch>, so the
// compiled binary is staged there, where node-pty also looks.
//
// macOS: node-pty starts every shell through prebuilds/darwin-<arch>/spawn-helper. The npm
// package ships it without the execute bit, so the terminal fails with "posix_spawnp failed".
// electron-builder keeps the file mode, so setting it here also fixes the packaged app.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'node_modules', 'node-pty')
const prebuilds = join(root, 'prebuilds')

function stageLinux() {
  const target = join(prebuilds, `${process.platform}-${process.arch}`)
  const compiled = join(root, 'build', 'Release', 'pty.node')
  if (!existsSync(compiled)) {
    process.stderr.write('node-pty is not compiled. Run: npm rebuild node-pty\n')
    process.exit(1)
  }
  // A binary compiled elsewhere, say in a Fedora toolbox that shares the home folder, can need a
  // newer glibc. node-pty would only report its last lookup, so check it loads here first.
  try {
    createRequire(import.meta.url)(compiled)
  } catch (error) {
    process.stderr.write(
      `node-pty does not load on this machine: ${error.message}\n` +
        `Rebuild it here: rm -rf ${target} ${join(root, 'build')} && npm rebuild node-pty\n`,
    )
    process.exit(1)
  }
  mkdirSync(target, { recursive: true })
  copyFileSync(compiled, join(target, 'pty.node'))
  process.stdout.write(`staged node-pty for ${process.platform}-${process.arch}\n`)
}

// Every darwin architecture, since one Mac packages both dmgs.
function makeSpawnHelpersExecutable() {
  const helpers = readdirSync(prebuilds)
    .filter((dir) => dir.startsWith('darwin-'))
    .map((dir) => join(prebuilds, dir, 'spawn-helper'))
    .filter((helper) => existsSync(helper))
  if (helpers.length === 0) {
    process.stderr.write(`node-pty has no spawn-helper in ${prebuilds}\n`)
    process.exit(1)
  }
  for (const helper of helpers) {
    chmodSync(helper, 0o755)
  }
}

if (process.platform === 'linux') {
  stageLinux()
}
// On every system: Linux or Windows can package the macOS app too.
makeSpawnHelpersExecutable()
