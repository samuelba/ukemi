import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { previewDrop, type PreviewDrop } from '../../../shared/dropPreview'
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
import { insertGaps } from './dropCommit'
import { DescribeDialog, type SuggestionReply } from './DescribeDialog'
import { DropPreviewBar } from './DropPreviewBar'
import { EmptyState } from './EmptyState'
import { FileIconFonts, FileIconThemeContext } from './FileIcon'
import { LANE_WIDTH } from './GraphCell'
import { GraphSearch } from './GraphSearch'
import { withUnchangedObjects } from './keepUnchanged'
import { LoadMoreRow } from './LoadMoreRow'
import { searchCommits, stepMatch } from './matchCommit'
import {
  applyPending,
  dropMessage,
  errorText,
  nextPending,
  previewText,
  resolvePending,
  startPending,
  type PendingDrop,
} from './pendingDrop'
import { PreviewRow } from './PreviewRow'
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

// An applied drop that the host never answers must not keep the preview up.
const APPLY_TIMEOUT_MS = 15_000

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
  const [pending, setPending] = useState<PendingDrop | null>(null)

  useHostMessages<HostMessage>(
    (message) => {
      switch (message.type) {
        case 'state':
          setState((previous) => withUnchangedObjects(previous, message.state))
          setPending((previous) => previous && nextPending(previous, message.state))
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

  const preview = useMemo(() => {
    const drop = pending && graph ? resolvePending(pending, graph.commits) : null
    if (!pending || !graph || !drop) {
      return null
    }
    return {
      drop,
      result: previewDrop(graph.commits, drop, { ghosts: pending.phase === 'preview' }),
    }
  }, [pending, graph])

  const lanes = useMemo(() => {
    const rows = preview?.result.ok
      ? preview.result.rows
      : (graph?.commits ?? []).map((commit) => commit.row)
    return rows.reduce((widest, row) => Math.max(widest, row.width), 1)
  }, [graph, preview])

  const commitsById = useMemo(
    () => new Map((graph?.commits ?? []).map((commit) => [commit.commitId, commit])),
    [graph],
  )

  const gaps = useMemo(() => insertGaps(graph?.commits ?? []), [graph])

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
  const previewDropsRef = useRef(true)
  previewDropsRef.current = state?.settings.previewDrops ?? true
  const dropCommit = useCallback((drop: PreviewDrop) => {
    const current = graphRef.current
    const started = previewDropsRef.current && current ? startPending(drop, current) : null
    if (started) {
      setPending(started)
    } else {
      postMessage(dropMessage(drop))
    }
  }, [])
  const cancelDrop = useCallback(() => setPending(null), [])

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

  const isApplying = pending?.phase === 'applying'
  useEffect(() => {
    if (!isApplying) {
      return
    }
    const timer = setTimeout(() => setPending(null), APPLY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isApplying])

  // Another drag starts over. The preview rows themselves cannot be dragged.
  const isPreviewing = pending?.phase === 'preview'
  useEffect(() => {
    if (!isPreviewing) {
      return
    }
    window.addEventListener('dragstart', cancelDrop, true)
    return () => window.removeEventListener('dragstart', cancelDrop, true)
  }, [isPreviewing, cancelDrop])

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

  const labelOf = (commitId: string) => {
    const commit = commitsById.get(commitId)
    return commit ? title(commit.description) || commit.changeId.slice(0, 8) : commitId.slice(0, 8)
  }

  const applyDrop = () => {
    if (preview?.result.ok && pending) {
      postMessage(dropMessage(preview.drop))
      setPending(applyPending(pending))
    }
  }

  const previewBar = preview && (
    <DropPreviewBar
      key="drop-preview"
      text={
        preview.result.ok
          ? previewText(preview.result.summary, labelOf)
          : errorText(preview.result.error, `“${labelOf(preview.drop.sourceId)}”`)
      }
      canApply={preview.result.ok}
      isApplying={isApplying}
      indent={lanes * LANE_WIDTH + 8}
      onApply={applyDrop}
      onCancel={cancelDrop}
    />
  )

  // The previewed graph, with the bar under the row the dropped change lands on.
  const previewRows = () => {
    const result = preview?.result
    if (!result?.ok) {
      return null
    }
    return result.nodes.flatMap((node, index) => {
      const commit = commitsById.get(node.commitId)
      const row = result.rows[index]
      if (!commit || !row) {
        return []
      }
      const shown = (
        <PreviewRow
          key={node.id}
          node={node}
          commit={commit}
          row={row}
          lanes={lanes}
          changeIdLength={state.settings.changeIdLength}
        />
      )
      return node.id === result.anchorId ? [shown, previewBar] : [shown]
    })
  }

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
          <div
            className={`graph${preview?.result.ok ? ' is-previewing' : ''}`}
            role="tree"
            aria-label="Changes"
          >
            {previewRows() ??
              graph.commits.flatMap((commit, index) => [
                <CommitRow
                  key={commit.commitId}
                  commit={commit}
                  gapAbove={gaps[index]?.above ?? null}
                  gapBelow={gaps[index]?.below ?? null}
                  canSquash={canSquashIntoParent(commit, commitsById)}
                  repoId={repoId}
                  lanes={lanes}
                  files={filesFor(commit)}
                  isExpanded={isExpanded(commit)}
                  isSelected={selected === commit.commitId}
                  isTabStop={selected === commit.commitId}
                  isDimmed={matchSet !== null && !matchSet.has(commit.commitId)}
                  hasRemotes={graph.hasRemotes}
                  hasForge={graph.forge !== null}
                  settings={state.settings}
                  onToggle={toggle}
                  onSelect={selectCommit}
                  onDescribe={startDescribe}
                  onDropCommit={dropCommit}
                />,
                ...(preview && commit.commitId === preview.drop.sourceId ? [previewBar] : []),
              ])}
            {graph.isTruncated && !preview?.result.ok && (
              // A new view starts with a fresh row, which may ask again at the same count.
              <LoadMoreRow
                key={`${repoId}\0${graph.filter}\0${graph.depth}\0${graph.revset ?? ''}`}
                shown={graph.commits.length}
              />
            )}
            {graph.commits.length === 0 && (
              <div className="muted padded" role="none">
                No changes match this filter.
              </div>
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
