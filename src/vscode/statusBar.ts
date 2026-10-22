import * as vscode from 'vscode'
import type { RepoRegistry } from './registry'

export class RepoStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('ukemi.repo', vscode.StatusBarAlignment.Left, 50)
  private readonly subscription: vscode.Disposable

  constructor(private readonly registry: RepoRegistry) {
    this.item.name = 'Ukemi Repository'
    this.item.command = 'ukemi.selectRepository'
    this.subscription = registry.onDidChange(() => this.update())
    this.update()
  }

  private update(): void {
    const repos = this.registry.summaries()
    const active = repos.find((r) => r.id === this.registry.activeRepoId)
    if (!active) {
      this.item.hide()
      return
    }
    const workingCopy = this.registry.activeModel?.graph?.commits.find((c) => c.isWorkingCopy)
    const change = workingCopy ? ` @ ${workingCopy.changeId.slice(0, 4)}` : ''
    this.item.text = `$(repo) ${active.label}${change}`
    this.item.tooltip = repos.length > 1 ? `${active.id}\nClick to switch repository` : active.id
    this.item.show()
  }

  dispose(): void {
    this.subscription.dispose()
    this.item.dispose()
  }
}
