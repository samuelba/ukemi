import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { DesktopHostMessage, DesktopRendererMessage } from '../../../shared/desktopProtocol'
import type { RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'
import { useHostListener } from '../shared/hooks'

const TAB_MIME = 'application/x-ukemi-repo-tab'
// A blur this soon after the editor opened comes from the closing context menu, not the user.
const SETTLE_MS = 300

type Side = 'before' | 'after'

function send(message: DesktopRendererMessage | { type: 'selectRepo'; repoId: string }): void {
  postMessage(message)
}

function run(command: string, repoId: string): void {
  send({ type: 'desktop.run', command, arg: { repoId } })
}

// The name of a tab, edited in place. Enter or leaving the field saves, Escape cancels.
function NameEditor({ repo, onDone }: { repo: RepoSummary; onDone: () => void }) {
  const isDone = useRef(false)
  const openedAt = useRef(Date.now())
  const finish = (name: string | null) => {
    if (isDone.current) {
      return
    }
    isDone.current = true
    const trimmed = name?.trim() ?? null
    if (trimmed !== null && trimmed !== repo.label) {
      // The folder name itself is no custom name.
      send({
        type: 'desktop.renameTab',
        repoId: repo.id,
        name: trimmed === repo.folderLabel ? '' : trimmed,
      })
    }
    onDone()
  }
  return (
    <input
      className="repo-tab-input"
      aria-label={`Name of ${repo.label}. Leave it empty for the folder name.`}
      defaultValue={repo.label}
      placeholder={repo.folderLabel}
      size={Math.max(6, repo.label.length)}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          finish(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          finish(null)
        }
      }}
      onBlur={(e) => {
        if (Date.now() - openedAt.current < SETTLE_MS) {
          const input = e.currentTarget
          requestAnimationFrame(() => input.focus())
          return
        }
        finish(e.currentTarget.value)
      }}
    />
  )
}

// The open repositories of the window, one tab each. Pinned tabs come first. Tabs can be
// dragged into another order, renamed in place and pinned from their context menu.
export function RepoTabs({
  repos,
  activeRepoId,
}: {
  repos: readonly RepoSummary[]
  activeRepoId: string | null
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; side: Side } | null>(null)
  // The tab the keyboard moved. It gets the focus back once the new order arrives.
  const moved = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editing && !repos.some((repo) => repo.id === editing)) {
      setEditing(null)
    }
    const id = moved.current
    if (id) {
      moved.current = null
      list.current?.querySelector<HTMLElement>(`[data-repo-id="${CSS.escape(id)}"]`)?.focus()
    }
  }, [repos, editing])
  useHostListener<DesktopHostMessage>((message) => {
    if (message.type === 'desktop.startRename') {
      setEditing(message.repoId)
    }
  })

  const moveTo = (repoId: string, toIndex: number) =>
    send({ type: 'desktop.moveTab', repoId, toIndex })

  const sideOf = (event: DragEvent<HTMLDivElement>): Side => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX < box.left + box.width / 2 ? 'before' : 'after'
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>, id: string) => {
    if (!event.dataTransfer.types.includes(TAB_MIME)) {
      return
    }
    event.preventDefault()
    const side = sideOf(event)
    setDrop((current) => (current?.id === id && current.side === side ? current : { id, side }))
  }

  const onDrop = (event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    const dragged = event.dataTransfer.getData(TAB_MIME)
    // From the pointer, as the marker may be gone after a dragleave over a child element.
    const side = sideOf(event)
    setDrop(null)
    const from = repos.findIndex((repo) => repo.id === dragged)
    if (from < 0) {
      return
    }
    event.preventDefault()
    // The gap the tab was dropped into, then its index once it left its old place.
    const gap = targetIndex + (side === 'after' ? 1 : 0)
    moveTo(dragged, from < gap ? gap - 1 : gap)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, repo: RepoSummary) => {
    if (event.key === 'F2') {
      setEditing(repo.id)
    } else if (event.ctrlKey && event.shiftKey && event.key === 'PageUp') {
      moved.current = repo.id
      send({ type: 'desktop.moveTab', repoId: repo.id, offset: -1 })
    } else if (event.ctrlKey && event.shiftKey && event.key === 'PageDown') {
      moved.current = repo.id
      send({ type: 'desktop.moveTab', repoId: repo.id, offset: 1 })
    } else {
      return
    }
    event.preventDefault()
  }

  // Pinned tabs come first, so the last of them sits right before the others.
  const lastPinned = repos.filter((repo) => repo.isPinned).length - 1
  return (
    <nav className="repo-tabs" aria-label="Open repositories">
      <div className="repo-tabs-list" role="tablist" ref={list} onDragLeave={() => setDrop(null)}>
        {repos.map((repo, index) => {
          const isActive = repo.id === activeRepoId
          const isEditing = editing === repo.id
          const marker = drop?.id === repo.id ? ` drop-${drop.side}` : ''
          return (
            <div
              key={repo.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              // The path also tells which folder a renamed tab shows.
              title={isEditing ? undefined : repo.id}
              data-repo-id={repo.id}
              className={`repo-tab${isActive ? ' is-active' : ''}${repo.isPinned ? ' is-pinned' : ''}${index === lastPinned ? ' is-last-pinned' : ''}${marker}`}
              draggable={!isEditing}
              data-vscode-context={JSON.stringify({
                webviewSection: 'ukemi.repoTab',
                repoId: repo.id,
                isPinned: repo.isPinned === true,
              })}
              onClick={() => !isActive && send({ type: 'selectRepo', repoId: repo.id })}
              onAuxClick={(e) =>
                e.button === 1 &&
                !repo.isPinned &&
                send({ type: 'desktop.closeRepo', repoId: repo.id })
              }
              onKeyDown={(e) => onKeyDown(e, repo)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, repo.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDrop(null)}
              onDragOver={(e) => onDragOver(e, repo.id)}
              onDrop={(e) => onDrop(e, index)}
            >
              <span
                className={`codicon codicon-${repo.kind === 'git' ? 'git-branch' : 'repo'}`}
                aria-hidden
              />
              {isEditing ? (
                <NameEditor repo={repo} onDone={() => setEditing(null)} />
              ) : (
                <span className="repo-tab-label" onDoubleClick={() => setEditing(repo.id)}>
                  {repo.label}
                </span>
              )}
              {repo.changedFiles > 0 && (
                <span className="repo-tab-count" title={`${repo.changedFiles} changed files in @`}>
                  {repo.changedFiles}
                </span>
              )}
              {repo.isPinned ? (
                <button
                  className="repo-tab-close repo-tab-pin"
                  aria-label={`Unpin ${repo.label}`}
                  title="Unpin"
                  onClick={(e) => {
                    e.stopPropagation()
                    run('ukemi.repoTab.unpin', repo.id)
                  }}
                >
                  <span className="codicon codicon-pinned" aria-hidden />
                </button>
              ) : (
                <button
                  className="repo-tab-close"
                  aria-label={`Close ${repo.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    send({ type: 'desktop.closeRepo', repoId: repo.id })
                  }}
                >
                  <span className="codicon codicon-close" aria-hidden />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        className="icon-button"
        title="Open repository (Ctrl+O)"
        aria-label="Open repository"
        onClick={() => send({ type: 'desktop.openRepo' })}
      >
        <span className="codicon codicon-add" aria-hidden />
      </button>
    </nav>
  )
}
