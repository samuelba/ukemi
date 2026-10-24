import type { KeyboardEvent, MouseEvent } from 'react'
import { canRestoreVersion, operationLabel } from '../../../shared/evolution'
import type { EvolutionEntry } from '../../../shared/model'
import type { CommitView, ViewSettings } from '../../../shared/protocol'
import { relativeTime, splitId, title } from '../shared/format'
import { postMessage } from '../shared/vscodeApi'
import { VersionsIcon } from './VersionsIcon'

interface EvolutionPanelProps {
  commit: CommitView
  entries: EvolutionEntry[] | undefined
  settings: ViewSettings
  now: number
  onClose: () => void
}

function Id({ id, prefix, length }: { id: string; prefix: string; length: number }) {
  const parts = splitId(id, prefix, length)
  return (
    <span className="change-id">
      <span className="id-prefix">{parts.prefix}</span>
      <span className="id-rest">{parts.rest}</span>
    </span>
  )
}

function restoreLabel(commit: CommitView, entries: EvolutionEntry[], index: number): string {
  if (commit.isImmutable) {
    return 'This change is immutable'
  }
  return canRestoreVersion(entries, index)
    ? 'Restore the files of this version'
    : 'Cannot restore: this version has other parents (before a rebase)'
}

export function EvolutionPanel({ commit, entries, settings, now, onClose }: EvolutionPanelProps) {
  const openDiff = (from: EvolutionEntry, to: EvolutionEntry) =>
    postMessage({
      type: 'openVersionDiff',
      commitId: commit.commitId,
      fromCommitId: from.commitId,
      toCommitId: to.commitId,
    })
  const action = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    run()
  }

  const rows = (list: EvolutionEntry[]) =>
    list.map((entry, index) => {
      const previous = list[index + 1]
      const current = list[0]
      const open = previous ? () => openDiff(previous, entry) : undefined
      const onKeyDown = (event: KeyboardEvent) => {
        if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          open()
        }
      }
      return (
        <li
          key={entry.commitId}
          className={`evolution-row${open ? ' clickable' : ''}`}
          role={open ? 'button' : undefined}
          tabIndex={open ? 0 : undefined}
          title={open ? 'Show what this version changed' : 'First version of this change'}
          onClick={open}
          onKeyDown={onKeyDown}
        >
          <Id id={entry.commitId} prefix={entry.commitPrefix} length={settings.changeIdLength} />
          <span className="evolution-op">
            {index === 0 && <span className="evolution-current">current</span>}
            {operationLabel(entry.operation)}
          </span>
          <span className="evolution-time">{relativeTime(entry.timestamp, now)}</span>
          <span className="evolution-actions">
            {current && index > 0 && (
              <>
                <button
                  className="icon-button"
                  title="Compare with the current version"
                  aria-label="Compare with the current version"
                  onClick={action(() => openDiff(entry, current))}
                >
                  <i className="codicon codicon-compare-changes" />
                </button>
                <button
                  className="icon-button"
                  title={restoreLabel(commit, list, index)}
                  aria-label={restoreLabel(commit, list, index)}
                  disabled={commit.isImmutable || !canRestoreVersion(list, index)}
                  onClick={action(() =>
                    postMessage({
                      type: 'restoreVersion',
                      commitId: commit.commitId,
                      fromCommitId: entry.commitId,
                    }),
                  )}
                >
                  <i className="codicon codicon-history" />
                </button>
              </>
            )}
          </span>
        </li>
      )
    })

  return (
    <section className="evolution" aria-label="Evolution">
      <header className="evolution-head">
        <VersionsIcon />
        <span className="evolution-title">
          Evolution of{' '}
          <Id id={commit.changeId} prefix={commit.changePrefix} length={settings.changeIdLength} />{' '}
          {title(commit.description) || '(no description)'}
        </span>
        <button className="icon-button" title="Close" aria-label="Close" onClick={onClose}>
          <i className="codicon codicon-close" />
        </button>
      </header>
      <div className="evolution-body">
        {entries === undefined ? (
          <div className="muted padded">Loading versions…</div>
        ) : entries.length === 0 ? (
          <div className="muted padded">No versions found.</div>
        ) : (
          <ol className="evolution-list">{rows(entries)}</ol>
        )}
      </div>
    </section>
  )
}
