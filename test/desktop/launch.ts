import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const root = resolve(__dirname, '../..')
const JJ_ENV = {
  JJ_USER: 'Ukemi Test',
  JJ_EMAIL: 'test@example.com',
  JJ_CONFIG: '/dev/null',
}

function jj(cwd: string, ...args: string[]): string {
  return execFileSync('jj', ['--color=never', ...args], {
    cwd,
    env: { ...process.env, ...JJ_ENV },
    encoding: 'utf8',
  })
}

// A repository with two described changes, a bookmark and edits in the working copy.
export function fixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ukemi-desktop-repo-'))
  jj(repo, 'git', 'init')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'cart.js'), 'let total = 0\nexport { total }\n')
  jj(repo, 'describe', '-m', 'feat: add the cart total')
  jj(repo, 'new', '-m', 'docs: explain the setup')
  writeFileSync(join(repo, 'README.md'), '# Demo\n')
  jj(repo, 'bookmark', 'create', 'docs-setup', '-r', '@')
  jj(repo, 'new')
  writeFileSync(join(repo, 'src', 'cart.js'), 'let sum = 0\nexport { sum }\n')
  return repo
}

// A straight history of `length` commits on `main`, plus `side`, a newer commit that branches off
// the tenth one. Git writes it in one go, which is much faster than a jj command per commit.
export function longRepo(length: number): string {
  const repo = mkdtempSync(join(tmpdir(), 'ukemi-desktop-long-'))
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo])
  const start = 1_700_000_000
  const commit = (branch: string, mark: number, time: number, message: string, from?: number) =>
    [
      `commit refs/heads/${branch}`,
      `mark :${mark}`,
      `committer Ukemi Test <test@example.com> ${time} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ...(from === undefined ? [] : [`from :${from}`]),
      '',
    ].join('\n')
  const stream = [
    ...Array.from({ length }, (_, i) => commit('main', i + 1, start + i * 60, `main ${i + 1}`)),
    commit('side', length + 1, start + length * 60, 'side', 10),
  ].join('')
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: stream })
  jj(repo, 'git', 'init', '--colocate')
  return repo
}

// base → `mine` and `theirs` edit one line, merged into a conflicted `merge`, with an empty `@` above.
export function conflictRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ukemi-desktop-conflict-'))
  jj(repo, 'git', 'init')
  writeFileSync(join(repo, 'f.txt'), 'a\nb\nc\n')
  jj(repo, 'commit', '-m', 'base')
  const base = jj(repo, 'log', '-r', '@-', '--no-graph', '-T', 'change_id').trim()
  jj(repo, 'new', base, '-m', 'mine')
  writeFileSync(join(repo, 'f.txt'), 'a\nMINE\nc\n')
  jj(repo, 'new', base, '-m', 'theirs')
  writeFileSync(join(repo, 'f.txt'), 'a\nTHEIRS\nc\n')
  jj(repo, 'new', 'description(exact:"mine\n")', '@', '-m', 'merge')
  jj(repo, 'new', '-m', 'wc')
  writeFileSync(join(repo, 'notes.txt'), 'one\n')
  return repo
}

// The descriptions of the conflicted changes, newest first.
export function conflictedChanges(repo: string): string[] {
  const out = jj(
    repo,
    'log',
    '-r',
    'conflicts()',
    '--no-graph',
    '-T',
    'description.first_line() ++ "\\n"',
  )
  return out.split('\n').filter(Boolean)
}

export function logOf(repo: string): string {
  return jj(
    repo,
    'log',
    '--no-graph',
    '-T',
    'change_id.short() ++ " " ++ description.first_line() ++ "\\n"',
  )
}

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
}

// Starts the app on repositories, already trusted, with its own user data and settings.
// `userData` reuses the data of an earlier run, as a second start of the app.
export async function launch(
  repo: string | string[],
  settings: Record<string, unknown> = {},
  userData = mkdtempSync(join(tmpdir(), 'ukemi-desktop-data-')),
): Promise<Launched> {
  const repos = Array.isArray(repo) ? repo : [repo]
  const statePath = join(userData, 'state.json')
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as object) : {}
  const trusted = [...((state as { trustedFolders?: string[] }).trustedFolders ?? []), ...repos]
  writeFileSync(statePath, JSON.stringify({ ...state, trustedFolders: trusted }))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') {
      env[key] = value
    }
  }
  const app = await electron.launch({
    args: [join(root, 'dist/desktop/main.js'), ...repos],
    cwd: root,
    env: { ...env, ...JJ_ENV, UKEMI_USER_DATA: userData },
    // Playwright would force the light scheme. The app's own theme setting decides instead.
    colorScheme: null,
  })
  const page = await app.firstWindow()
  // The graph, or the start page of a window without repositories.
  await page.waitForSelector(repos.length > 0 ? '.commit' : '.commit, .empty', { timeout: 30_000 })
  return { app, page, userData }
}
