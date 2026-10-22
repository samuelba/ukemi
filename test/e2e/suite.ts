import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { UkemiApi } from '../../src/extension'

const TIMEOUT_MS = 15_000

function jj(cwd: string, ...args: string[]): string {
  return execFileSync('jj', ['--color=never', ...args], { cwd, encoding: 'utf8' }).trim()
}

async function waitFor<T>(what: string, probe: () => T | undefined | null | false): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const value = probe()
    if (value) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function step(name: string, body: () => Promise<void>): Promise<void> {
  const started = Date.now()
  await body()
  process.stdout.write(`  ✓ ${name} (${Date.now() - started} ms)\n`)
}

export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert.ok(root, 'the test workspace has a folder')
  const extension = vscode.extensions.getExtension<UkemiApi>('ukemi.ukemi')
  assert.ok(extension, 'the extension is installed')
  const api = await extension.activate()
  const model = await waitFor(
    'the repository model',
    () => api.registry.activeModel?.graph && api.registry.activeModel,
  )
  const commitOf = (revision: string) =>
    jj(root, 'log', '--no-graph', '-r', revision, '-T', 'commit_id')

  await step('registers every contributed command', async () => {
    const pkg = JSON.parse(readFileSync(join(extension.extensionPath, 'package.json'), 'utf8')) as {
      contributes: { commands: Array<{ command: string }> }
    }
    const available = new Set(await vscode.commands.getCommands(true))
    const missing = pkg.contributes.commands.map((c) => c.command).filter((c) => !available.has(c))
    assert.deepEqual(missing, [])
  })

  await step('opens the change graph view', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.ukemi')
  })

  await step('creates a new change and undoes it', async () => {
    const before = commitOf('@')
    await vscode.commands.executeCommand('ukemi.commit.new', { repoId: root, commitId: before })
    assert.equal(commitOf('@-'), before)
    await vscode.commands.executeCommand('ukemi.undo', { repoId: root })
    assert.equal(commitOf('@'), before)
  })

  await step('sees new files through the file watcher', async () => {
    writeFileSync(join(root, 'one.txt'), 'one\n')
    writeFileSync(join(root, 'two.txt'), 'two\n')
    await waitFor('the working copy files', () => (model.graph?.workingCopyFiles.length ?? 0) >= 2)
  })

  await step('moves a file into a new change before the working copy', async () => {
    const workingCopy = await waitFor('the working copy commit', () =>
      model.graph?.commits.find((c) => c.isWorkingCopy),
    )
    await vscode.commands.executeCommand('ukemi.file.splitBelow', {
      repoId: root,
      commitId: workingCopy.commitId,
      path: 'two.txt',
    })
    assert.equal(jj(root, 'diff', '-r', '@-', '--name-only'), 'two.txt')
    assert.equal(jj(root, 'diff', '-r', '@', '--name-only'), 'one.txt')
  })

  await step('duplicates a change', async () => {
    const parent = commitOf('@-')
    await vscode.commands.executeCommand('ukemi.commit.duplicate', {
      repoId: root,
      commitId: parent,
    })
    const copies = jj(
      root,
      'log',
      '--no-graph',
      '-r',
      `children(${commitOf('@--')})`,
      '-T',
      'commit_id ++ "\\n"',
    )
    assert.equal(copies.split('\n').length, 2)
  })
}
