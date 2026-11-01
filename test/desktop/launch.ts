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
