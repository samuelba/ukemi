import { relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { authorLabel, type FileBlame } from '../../shared/fileHistory'
import { relativeTime } from '../../shared/format'
import type { Handler } from '../app/commands/context'
import { loadBlame } from '../app/fileHistory'
import type { RepoRegistry } from '../app/registry'
import { blameLabel } from '../repo/fileHistoryItems'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage, type Logger } from '../util/logger'
import { modelForFile } from './conflictLens'
import { readConfig } from './config'

const SETTING = 'inlineBlame'
const CURSOR_DELAY_MS = 150
const CACHE_LIMIT = 20
// Far past any line's end, so the text lands after the code.
const LINE_END = 1_000_000

interface Target {
  model: RepoModel
  path: string
  // The working copy's commit. jj gives it a new id whenever a snapshot changes its files.
  commitId: string
}

// Who last changed the line under the cursor, after the line's end, as GitLens and the git
// extension show it. Only for saved files, since unsaved lines have no change yet.
export class InlineBlame implements vscode.Disposable {
  private readonly type = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 0 0 3em',
      fontStyle: 'italic',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  })
  private readonly cache = new Map<string, Promise<FileBlame | null>>()
  private readonly disposables: vscode.Disposable[]
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0

  constructor(
    private readonly registry: RepoRegistry,
    private readonly logger: Logger,
  ) {
    const schedule = () => this.schedule()
    this.disposables = [
      this.type,
      vscode.window.onDidChangeTextEditorSelection(schedule),
      vscode.window.onDidChangeActiveTextEditor(schedule),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          schedule()
        }
      }),
      registry.onDidChangeModel(schedule),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`ukemi.${SETTING}`)) {
          schedule()
        }
      }),
    ]
  }

  commands(): Record<string, Handler> {
    return {
      'ukemi.toggleInlineBlame': async () => {
        const config = vscode.workspace.getConfiguration('ukemi')
        await config.update(SETTING, !isEnabled(), vscode.ConfigurationTarget.Global)
      },
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.disposables.forEach((item) => item.dispose())
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.update()
    }, CURSOR_DELAY_MS)
  }

  private async update(): Promise<void> {
    const generation = ++this.generation
    const editor = vscode.window.activeTextEditor
    const others = vscode.window.visibleTextEditors.filter((visible) => visible !== editor)
    others.forEach((visible) => visible.setDecorations(this.type, []))
    if (!editor) {
      return
    }
    const target = isEnabled() && !editor.document.isDirty ? this.target(editor.document) : null
    const blame = target ? await this.blame(target) : null
    if (generation !== this.generation) {
      return
    }
    // A blame of other text, as after a save the refresh has not seen yet, would name wrong lines.
    if (!blame || blame.text !== editor.document.getText()) {
      editor.setDecorations(this.type, [])
      return
    }
    const line = editor.selection.active.line
    const run = blame.runs.find((r) => r.start <= line + 1 && line + 1 < r.start + r.count)
    const change = run ? blame.changes[run.commitId] : undefined
    if (!change) {
      editor.setDecorations(this.type, [])
      return
    }
    const hover = new vscode.MarkdownString()
    hover.appendMarkdown(`**${authorLabel(change)}** · ${change.time}\n\n`)
    hover.appendText(change.summary || '(no description)')
    hover.appendMarkdown(`\n\nChange \`${change.changeId}\`  \nCommit \`${change.commitId}\``)
    editor.setDecorations(this.type, [
      {
        range: new vscode.Range(line, LINE_END, line, LINE_END),
        hoverMessage: hover,
        renderOptions: {
          after: { contentText: blameLabel(change, relativeTime(change.time, Date.now())) },
        },
      },
    ])
  }

  private target(document: vscode.TextDocument): Target | null {
    if (document.uri.scheme !== 'file') {
      return null
    }
    const model = modelForFile(this.registry, document.uri.fsPath)
    const workingCopy = model?.graph?.commits.find((commit) => commit.isWorkingCopy)
    if (!model || !workingCopy) {
      return null
    }
    const path = relative(model.root, document.uri.fsPath).split(sep).join('/')
    return { model, path, commitId: workingCopy.commitId }
  }

  private blame(target: Target): Promise<FileBlame | null> {
    const key = `${target.model.root}\n${target.path}\n${target.commitId}`
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }
    const loading = loadBlame(
      target.model,
      target.path,
      target.commitId,
      readConfig(target.model.root).changeIdLength,
    ).catch((error: unknown) => {
      // Untracked and ignored files have no history. That is not worth more than a log line.
      this.logger.info(`blame of ${target.path} failed: ${errorMessage(error)}`)
      return null
    })
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      }
    }
    this.cache.set(key, loading)
    return loading
  }
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('ukemi').get<boolean>(SETTING, true)
}
