import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FileIconTheme } from '../../../shared/fileIconTheme'
import type { ChangedFile } from '../../../shared/model'
import type {
  CommitView,
  HostMessage,
  SuggesterView,
  ViewState,
  WebviewMessage,
} from '../../../shared/protocol'
import { title } from '../shared/format'
import { useHostMessages } from '../shared/hooks'
import { postMessage } from '../shared/hostApi'
import { CommitRow } from './CommitRow'
import { DescribeDialog, type SuggestionReply } from './DescribeDialog'
import { EmptyState } from './EmptyState'
import { FileIconFonts, FileIconThemeContext } from './FileIcon'
import { selectedRow, type Selection } from './selection'
import { Toolbar } from './Toolbar'

interface Describing {
  commitId: string
  changeId: string
  description: string
  isWorkingCopy: boolean
}

const fileKey = (repoId: string, commitId: string) => `${repoId}\n${commitId}`

export function App() {
  const [state, setState] = useState<ViewState | null>(null)
  const [fileIcons, setFileIcons] = useState<FileIconTheme | null>(null)
  // The desktop app has no host theme and provides its own bundled one around the graph.
  const bundledIcons = useContext(FileIconThemeContext)
  const [files, setFiles] = useState<ReadonlyMap<string, ChangedFile[]>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [isWorkingCopyCollapsed, setIsWorkingCopyCollapsed] = useState(false)
  const requested = useRef(new Set<string>())
  const [selection, setSelection] = useState<Selection | null>(null)
  const announced = useRef<string | null>(null)
  const [revealId, setRevealId] = useState<string | null>(null)
  const [describing, setDescribing] = useState<Describing | null>(null)
  const [suggesters, setSuggesters] = useState<SuggesterView[]>([])
  const [suggestionReply, setSuggestionReply] = useState<SuggestionReply | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useHostMessages<HostMessage>(
    (message) => {
      switch (message.type) {
        case 'state':
          setState(message.state)
          setNow(Date.now())
          return
        case 'reveal': {
          const commit = state?.graph?.commits.find((c) => c.commitId === message.commitId)
          setSelection({ commitId: message.commitId, changeId: commit?.changeId ?? '' })
          setRevealId(message.commitId)
          postMessage({ type: 'selectCommit', commitId: message.commitId })
          return
        }
        case 'files':
          setFiles((prev) =>
            new Map(prev).set(fileKey(message.repoId, message.commitId), message.files),
          )
          return
        case 'fileIcons':
          setFileIcons(message.theme)
          return
        case 'suggesters':
          setSuggesters(message.suggesters)
          return
        case 'descriptionSuggestion':
          setSuggestionReply({
            requestId: message.requestId,
            text: message.text,
            error: message.error,
          })
          return
        case 'describe': {
          const commit = state?.graph?.commits.find((c) => c.commitId === message.commitId)
          setDescribing({
            commitId: message.commitId,
            changeId: message.changeId,
            description: message.description,
            isWorkingCopy: commit?.isWorkingCopy ?? false,
          })
          return
        }
      }
    },
    { type: 'ready' } satisfies WebviewMessage,
  )

  // Tools get installed and settings change, so the list is asked for each time.
  const isDescribing = describing !== null
  useEffect(() => {
    if (isDescribing) {
      postMessage({ type: 'listSuggesters' } satisfies WebviewMessage)
    }
  }, [isDescribing])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const graph = state?.graph ?? null
  const repoId = graph?.repoId ?? ''

  useEffect(() => {
    if (!revealId) {
      return
    }
    const row = document.querySelector(`[data-commit-id="${CSS.escape(revealId)}"]`)
    if (!row) {
      return
    }
    row.scrollIntoView({ block: 'nearest' })
    setRevealId(null)
  }, [revealId, graph])

  const lanes = useMemo(
    () => Math.max(1, ...(graph?.commits ?? []).map((c) => c.row.width)),
    [graph],
  )

  const commitsById = useMemo(
    () => new Map((graph?.commits ?? []).map((commit) => [commit.commitId, commit])),
    [graph],
  )

  const isExpanded = useCallback(
    (commit: CommitView) =>
      commit.isWorkingCopy ? !isWorkingCopyCollapsed : expanded.has(commit.changeId),
    [expanded, isWorkingCopyCollapsed],
  )

  const showLineStats = state?.settings.showLineStats ?? false

  useEffect(() => {
    requested.current = new Set()
    setFiles(new Map())
  }, [showLineStats])

  useEffect(() => {
    for (const commit of graph?.commits ?? []) {
      const key = fileKey(repoId, commit.commitId)
      if (!commit.isWorkingCopy && expanded.has(commit.changeId) && !requested.current.has(key)) {
        requested.current.add(key)
        postMessage({ type: 'loadFiles', commitId: commit.commitId })
      }
    }
  }, [graph, expanded, repoId, showLineStats])

  const toggle = useCallback((commit: CommitView) => {
    if (commit.isWorkingCopy) {
      setIsWorkingCopyCollapsed((prev) => !prev)
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(commit.changeId)) {
        next.add(commit.changeId)
      }
      return next
    })
  }, [])

  const startDescribe = useCallback((commit: CommitView) => {
    setDescribing({
      commitId: commit.commitId,
      changeId: commit.changeId,
      description: commit.description,
      isWorkingCopy: commit.isWorkingCopy,
    })
  }, [])

  const selectCommit = useCallback(
    (commitId: string) => {
      const commit = graph?.commits.find((c) => c.commitId === commitId)
      setSelection({ commitId, changeId: commit?.changeId ?? '' })
      postMessage({ type: 'selectCommit', commitId })
    },
    [graph],
  )

  const selected = useMemo(
    () => (graph ? selectedRow(graph.commits, selection) : null),
    [graph, selection],
  )

  // Another repository starts with its working copy selected.
  useEffect(() => {
    setSelection(null)
  }, [repoId])

  // The host learns about the working copy chosen by default, so its views show the same change.
  useEffect(() => {
    if (selection === null && selected && announced.current !== repoId) {
      announced.current = repoId
      postMessage({ type: 'selectCommit', commitId: selected })
    }
  }, [selection, selected, repoId])

  if (!state) {
    return <EmptyState status="loading" repos={[]} activeRepoId={null} error={null} busy={null} />
  }

  const filesFor = (commit: CommitView) =>
    commit.isWorkingCopy ? graph?.workingCopyFiles : files.get(fileKey(repoId, commit.commitId))

  return (
    <FileIconThemeContext.Provider value={fileIcons ?? bundledIcons}>
      <FileIconFonts theme={fileIcons} />
      <div className="app">
        <Toolbar
          repos={state.repos}
          activeRepoId={state.activeRepoId}
          graph={graph}
          isBusy={state.busy !== null}
          autoFetch={state.autoFetch}
          showGitTags={state.settings.showGitTags}
        />
        {state.busy && (
          <div className="busy" role="status">
            <div className="busy-bar" />
            <span>{state.busy}…</span>
          </div>
        )}
        {state.error && state.status === 'ready' && (
          <div className="error-box" role="alert">
            <i className="codicon codicon-error" />
            <span className="error-text">{state.error}</span>
            <button
              className="icon-button"
              title="Dismiss"
              onClick={() => postMessage({ type: 'dismissError' })}
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        )}
        {state.status === 'ready' && graph ? (
          <div className="graph" role="list">
            {graph.commits.map((commit) => (
              <CommitRow
                key={commit.commitId}
                commit={commit}
                commitsById={commitsById}
                repoId={repoId}
                lanes={lanes}
                files={filesFor(commit)}
                isExpanded={isExpanded(commit)}
                isSelected={selected === commit.commitId}
                hasRemotes={graph.hasRemotes}
                hasForge={graph.forge !== null}
                settings={state.settings}
                now={now}
                onToggle={toggle}
                onSelect={selectCommit}
                onDescribe={startDescribe}
              />
            ))}
            {graph.commits.length === 0 && (
              <div className="muted padded">No changes match this filter.</div>
            )}
          </div>
        ) : (
          <EmptyState
            status={state.status}
            repos={state.repos}
            activeRepoId={state.activeRepoId}
            error={state.error}
            busy={state.busy}
          />
        )}
        {describing && (
          <DescribeDialog
            key={describing.commitId}
            heading={`Describe ${title(describing.description) || describing.commitId.slice(0, 8)}`}
            commitId={describing.commitId}
            initial={describing.description}
            canStartNew={describing.isWorkingCopy}
            suggesters={suggesters}
            suggestionReply={suggestionReply}
            onCancel={() => setDescribing(null)}
            onSave={(message, startNew) => {
              postMessage({
                type: 'describe',
                commitId: describing.commitId,
                changeId: describing.changeId,
                message,
                startNew,
              })
              setDescribing(null)
            }}
          />
        )}
      </div>
    </FileIconThemeContext.Provider>
  )
}
