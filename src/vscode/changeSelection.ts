import * as vscode from 'vscode'
import type { SelectedChange } from '../repo/selection'

type Listener = () => void

function same(left: SelectedChange | null, right: SelectedChange | null): boolean {
  return (
    left?.repoId === right?.repoId &&
    left?.commitId === right?.commitId &&
    left?.changeId === right?.changeId
  )
}

export class ChangeSelection implements vscode.Disposable {
  private selected: SelectedChange | null = null
  private followsWorkingCopy = true
  private pinned: SelectedChange | null = null
  private readonly listeners = new Set<Listener>()

  constructor() {
    void vscode.commands.executeCommand('setContext', 'ukemi.evolution.following', true)
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  select(change: SelectedChange): void {
    if (same(this.selected, change)) {
      return
    }
    this.selected = change
    if (this.followsWorkingCopy) {
      this.emit()
    }
  }

  toggleFollow(shown: SelectedChange | null): void {
    if (this.followsWorkingCopy) {
      this.pinned = shown
      this.followsWorkingCopy = false
    } else {
      this.pinned = null
      this.followsWorkingCopy = true
    }
    void vscode.commands.executeCommand(
      'setContext',
      'ukemi.evolution.following',
      this.followsWorkingCopy,
    )
    this.emit()
  }

  shown(repoId: string): SelectedChange | null {
    const choice = this.followsWorkingCopy ? this.selected : this.pinned
    return choice?.repoId === repoId ? choice : null
  }

  dispose(): void {
    this.listeners.clear()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
