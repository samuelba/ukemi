import { runTests } from '@vscode/test-electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as esbuild from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const suite = join(root, 'out', 'e2e', 'suite.js')

await esbuild.build({
  entryPoints: [join(root, 'test/e2e/suite.ts')],
  outfile: suite,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  logLevel: 'warning',
})

const scratch = mkdtempSync(join(tmpdir(), 'ukemi-e2e-'))
const repo = join(scratch, 'repo')
const jjConfig = join(scratch, 'jjconfig.toml')
writeFileSync(jjConfig, '[user]\nname = "Ukemi E2E"\nemail = "e2e@ukemi.dev"\n')
const env = { ...process.env, JJ_CONFIG: jjConfig }
execFileSync('jj', ['git', 'init', repo], { env, stdio: 'ignore' })
writeFileSync(join(repo, 'base.txt'), 'base\n')
execFileSync('jj', ['describe', '-m', 'base'], { cwd: repo, env, stdio: 'ignore' })
execFileSync('jj', ['new'], { cwd: repo, env, stdio: 'ignore' })

const installed = '/usr/share/code/code'
try {
  await runTests({
    vscodeExecutablePath:
      process.env.VSCODE_PATH ?? (existsSync(installed) ? installed : undefined),
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    extensionTestsEnv: { JJ_CONFIG: jjConfig },
    launchArgs: [
      repo,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--user-data-dir',
      join(scratch, 'user'),
    ],
  })
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
