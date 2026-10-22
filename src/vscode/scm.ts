import { join, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import type { ChangedFile } from '../../shared/model'
import type { RepoModel } from '../repo/repoModel'
import { readConfig } from './config'
import { revisionUri } from './diff'
import type { RepoRegistry } from './registry'

const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
}

const STATUS_COLOR: Record<ChangedFile['status'], string> = {
  added: 'gitDecoration.addedResourceForeground',
  modified: 'gitDecoration.modifiedResourceForeground',
  removed: 'gitDecoration.deletedResourceForeground',
  renamed: 'gitDecoration.renamedResourceForeground',
  copied: 'gitDecoration.addedResourceForeground',
}

export interface ScmResource extends vscode.SourceControlResourceState {
  root: string
  path: string
}

function isGitExtensionActive(): boolean {
  const git = vscode.extensions.getExtension('vscode.git')
  return git !== undefined && vscode.workspace.getConfiguration('git').get<boolean>('enabled', true)
}

export function shouldShowScm(model: RepoModel): boolean {
  const mode = readConfig().showSourceControl
  if (mode !== 'auto') {
    return mode === 'always'
  }
  return !model.repo.isColocated || !isGitExtensionActive()
}

class RepoSourceControl implements vscode.Disposable {
  private readonly sourceControl: vscode.SourceControl
  private readonly group: vscode.SourceControlResourceGroup
  private readonly unsubscribe: () => void

  constructor(
    private readonly model: RepoModel,
    label: string,
  ) {
    this.sourceControl = vscode.scm.createSourceControl(
      'ukemi',
      `Ukemi: ${label}`,
      vscode.Uri.file(model.root),
    )
    this.sourceControl.inputBox.visible = false
    this.sourceControl.quickDiffProvider = {
      provideOriginalResource: (uri) => this.originalResource(uri),
    }
    this.group = this.sourceControl.createResourceGroup('changes', 'Working Copy (@)')
    this.unsubscribe = model.onDidChange(() => this.update())
    this.update()
  }

  private originalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== 'file' || !uri.fsPath.startsWith(this.model.root + sep)) {
      return undefined
    }
    const workingCopy = this.model.graph?.commits.find((c) => c.isWorkingCopy)
    const parent = workingCopy?.parents[0]
    if (!parent) {
      return undefined
    }
    const path = relative(this.model.root, uri.fsPath).split(sep).join('/')
    return revisionUri(this.model.root, parent, path)
  }

  private update(): void {
    const files = this.model.graph?.workingCopyFiles ?? []
    this.group.resourceStates = files.map((file): ScmResource => {
      const uri = vscode.Uri.file(join(this.model.root, file.path))
      return {
        root: this.model.root,
        path: file.path,
        resourceUri: uri,
        contextValue: file.status,
        decorations: {
          strikeThrough: file.status === 'removed',
          tooltip: STATUS_LETTER[file.status],
          color: new vscode.ThemeColor(STATUS_COLOR[file.status]),
        } as vscode.SourceControlResourceDecorations,
        command: {
          command: 'ukemi.scm.openDiff',
          title: 'Open Diff',
          arguments: [{ root: this.model.root, path: file.path }],
        },
      }
    })
    this.sourceControl.count = files.length
  }

  dispose(): void {
    this.unsubscribe()
    this.sourceControl.dispose()
  }
}

export class ScmController implements vscode.Disposable {
  private readonly controls = new Map<string, RepoSourceControl>()
  private readonly subscription: vscode.Disposable
  private readonly configSubscription: vscode.Disposable

  constructor(private readonly registry: RepoRegistry) {
    this.subscription = registry.onDidChange(() => this.sync())
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ukemi.showSourceControl')) {
        this.sync()
      }
    })
    this.sync()
  }

  private sync(): void {
    const labels = new Map(this.registry.summaries().map((s) => [s.id, s.label]))
    const wanted = new Map(
      this.registry.models.filter(shouldShowScm).map((m) => [m.root, m] as const),
    )
    for (const [root, control] of this.controls) {
      if (!wanted.has(root)) {
        control.dispose()
        this.controls.delete(root)
      }
    }
    for (const [root, model] of wanted) {
      if (!this.controls.has(root)) {
        this.controls.set(root, new RepoSourceControl(model, labels.get(root) ?? root))
      }
    }
  }

  dispose(): void {
    this.subscription.dispose()
    this.configSubscription.dispose()
    this.controls.forEach((c) => c.dispose())
    this.controls.clear()
  }
}
