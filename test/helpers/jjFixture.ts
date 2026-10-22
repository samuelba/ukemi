import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { JjRunner } from '../../src/jj/runner'
import { JjRepo } from '../../src/jj/repo'
import { NULL_LOGGER } from '../../src/util/logger'

export const JJ_BINARY = process.env.UKEMI_TEST_JJ ?? 'jj'

export interface Fixture {
  dir: string
  cleanup: () => void
}

export function makeTempDir(prefix = 'ukemi-test-'): Fixture {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const configPath = join(dir, '.jjconfig.toml')
  writeFileSync(
    configPath,
    '[user]\nname = "Ukemi Test"\nemail = "test@ukemi.dev"\n[ui]\nconflict-marker-style = "git"\n',
  )
  process.env.JJ_CONFIG = configPath
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function jj(cwd: string, ...args: string[]): string {
  return execFileSync(JJ_BINARY, ['--color=never', ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  jj(dir, 'git', 'init', '--colocate')
}

export function writeFile(root: string, path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function makeRunner(): JjRunner {
  return new JjRunner(JJ_BINARY, NULL_LOGGER)
}

export function makeRepo(root: string): JjRepo {
  return new JjRepo(root, makeRunner())
}
