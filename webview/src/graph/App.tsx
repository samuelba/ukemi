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
import { canSquashIntoParent } from './canSquashIntoParent'
import { CommitRow } from './CommitRow'
import { DescribeDialog, type SuggestionReply } from './DescribeDialog'
import { EmptyState } from './EmptyState'
import { FileIconFonts, FileIconThemeContext } from './FileIcon'
import { GraphSearch } from './GraphSearch'
import { withUnchangedObjects } from './keepUnchanged'
import { searchCommits, stepMatch } from './matchCommit'
import { RevsetBar, type RevsetReply } from './RevsetBar'
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
  const [isEditingRevset, setIsEditingRevset] = useState(false)
  const [revsetHistory, setRevsetHistory] = useState<string[]>([])
  const [revsetReply, setRevsetReply] = useState<RevsetReply | null>(null)
  const replyCount = useRef(0)
  const [isSearching, setIsSearching] = useState(false)
  const [searchText, setSearchText] = useState('')

  useHostMessages<HostMessage>(
    (message) => {
      switch (message.type) {
        case 'state':
          setState((previous) => withUnchangedObjects(previous, message.state))
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
        case 'revsetHistory':
          setRevsetHistory(message.history)
          return
        case 'revsetResult':
          replyCount.current += 1
          setRevsetReply({ id: replyCount.current, revset: message.revset, error: message.error })
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
    () => (graph?.commits ?? []).reduce((widest, c) => Math.max(widest, c.row.width), 1),
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

  // Reads the graph through a ref, so the callback, and with it the memoized rows, stays the same
  // across refreshes.
  const graphRef = useRef(graph)
  graphRef.current = graph
  const selectCommit = useCallback((commitId: string) => {
    const commit = graphRef.current?.commits.find((c) => c.commitId === commitId)
    setSelection({ commitId, changeId: commit?.changeId ?? '' })
    postMessage({ type: 'selectCommit', commitId })
  }, [])

  const selected = useMemo(
    () => (graph ? selectedRow(graph.commits, selection) : null),
    [graph, selection],
  )

  // Another repository starts with its working copy selected.
  useEffect(() => {
    setSelection(null)
  }, [repoId])

  const closeRevset = useCallback(() => setIsEditingRevset(false), [])

  // Once a revset shows, the bar stays for it. Picking a filter later then closes the bar.
  const shownRevset = graph?.revset ?? null
  useEffect(() => {
    if (shownRevset !== null) {
      setIsEditingRevset(false)
    }
  }, [shownRevset])

  const matches = useMemo(
    () => (isSearching && graph ? searchCommits(graph.commits, searchText) : null),
    [isSearching, graph, searchText],
  )
  const matchSet = useMemo(() => (matches ? new Set(matches) : null), [matches])
  const matchIndex = matches && selected ? matches.indexOf(selected) : -1

  const stepSearch = (direction: 1 | -1) => {
    const next = matches ? stepMatch(matches, selected, direction) : null
    if (next) {
      selectCommit(next)
      setRevealId(next)
    }
  }

  const closeSearch = () => {
    setIsSearching(false)
    setSearchText('')
  }

  const openSearch = useCallback(() => {
    setIsSearching(true)
    document.querySelector<HTMLInputElement>('.graph-search-input')?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

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
          isSearching={isSearching}
          onCustomRevset={() => setIsEditingRevset(true)}
          onSearch={() => (isSearching ? closeSearch() : openSearch())}
        >
          {graph && (graph.revset !== null || isEditingRevset) && (
            <RevsetBar
              key={`${graph.repoId}\n${graph.revset ?? ''}`}
              graph={graph}
              history={revsetHistory}
              reply={revsetReply}
              onClose={closeRevset}
            />
          )}
          {isSearching && (
            <GraphSearch
              text={searchText}
              matchCount={matches?.length ?? null}
              position={matchIndex >= 0 ? matchIndex + 1 : null}
              onChange={setSearchText}
              onStep={stepSearch}
              onClose={closeSearch}
            />
          )}
        </Toolbar>
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
                canSquash={canSquashIntoParent(commit, commitsById)}
                repoId={repoId}
                lanes={lanes}
                files={filesFor(commit)}
                isExpanded={isExpanded(commit)}
                isSelected={selected === commit.commitId}
                isDimmed={matchSet !== null && !matchSet.has(commit.commitId)}
                hasRemotes={graph.hasRemotes}
                hasForge={graph.forge !== null}
                settings={state.settings}
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
