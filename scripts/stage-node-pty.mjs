// node-pty ships prebuilt binaries for macOS and Windows only. On Linux it compiles one into
// build/Release at install time. The app packages only prebuilds/<platform>-<arch>, so the
// compiled binary is staged there, where node-pty also looks.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'node_modules', 'node-pty')
const target = join(root, 'prebuilds', `${process.platform}-${process.arch}`)

if (process.platform === 'linux') {
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
