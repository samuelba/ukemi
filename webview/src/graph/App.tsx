import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/model'
import type { CommitView, HostMessage, ViewState } from '../../../shared/protocol'
import { title } from '../shared/format'
import { postMessage } from '../shared/vscodeApi'
import { CommitRow } from './CommitRow'
import { DescribeDialog } from './DescribeDialog'
import { EmptyState } from './EmptyState'
import { EvolutionPanel } from './EvolutionPanel'
import { Toolbar } from './Toolbar'

interface Describing {
  commitId: string
  description: string
  isWorkingCopy: boolean
}

type Evolution = Extract<HostMessage, { type: 'evolution' }>

const fileKey = (repoId: string, commitId: string) => `${repoId}\n${commitId}`

export function App() {
  const [state, setState] = useState<ViewState | null>(null)
  const [files, setFiles] = useState<ReadonlyMap<string, ChangedFile[]>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [isWorkingCopyCollapsed, setIsWorkingCopyCollapsed] = useState(false)
  const requested = useRef(new Set<string>())
  const [selected, setSelected] = useState<string | null>(null)
  const [describing, setDescribing] = useState<Describing | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [isEvolutionOpen, setIsEvolutionOpen] = useState(false)
  const [evolutionChangeId, setEvolutionChangeId] = useState<string | null>(null)
  const [evolution, setEvolution] = useState<Evolution | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data
      switch (message.type) {
        case 'state':
          setState(message.state)
          setNow(Date.now())
          return
        case 'files':
          setFiles((prev) =>
            new Map(prev).set(fileKey(message.repoId, message.commitId), message.files),
          )
          return
        case 'evolution':
          setEvolution(message)
          return
        case 'describe': {
          const commit = state?.graph?.commits.find((c) => c.commitId === message.commitId)
          setDescribing({
            commitId: message.commitId,
            description: message.description,
            isWorkingCopy: commit?.isWorkingCopy ?? false,
          })
          return
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [state])

  useEffect(() => {
    postMessage({ type: 'ready' })
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const graph = state?.graph ?? null
  const repoId = graph?.repoId ?? ''

  const selectedCommit = graph?.commits.find((c) => c.commitId === selected)
  const evolutionCommit =
    selectedCommit ??
    graph?.commits.find((c) => c.changeId === evolutionChangeId) ??
    graph?.commits.find((c) => c.isWorkingCopy) ??
    null

  useEffect(() => {
    if (selectedCommit) {
      setEvolutionChangeId(selectedCommit.changeId)
    }
  }, [selectedCommit])

  useEffect(() => {
    if (isEvolutionOpen && evolutionCommit) {
      postMessage({ type: 'loadEvolution', commitId: evolutionCommit.commitId })
    }
  }, [isEvolutionOpen, evolutionCommit, graph])

  const evolutionEntries =
    evolution?.repoId === repoId && evolution.commitId === evolutionCommit?.commitId
      ? evolution.entries
      : undefined

  const lanes = useMemo(
    () => Math.max(1, ...(graph?.commits ?? []).map((c) => c.row.width)),
    [graph],
  )

  const isExpanded = useCallback(
    (commit: CommitView) =>
      commit.isWorkingCopy ? !isWorkingCopyCollapsed : expanded.has(commit.changeId),
    [expanded, isWorkingCopyCollapsed],
  )

  useEffect(() => {
    for (const commit of graph?.commits ?? []) {
      const key = fileKey(repoId, commit.commitId)
      if (!commit.isWorkingCopy && expanded.has(commit.changeId) && !requested.current.has(key)) {
        requested.current.add(key)
        postMessage({ type: 'loadFiles', commitId: commit.commitId })
      }
    }
  }, [graph, expanded, repoId])

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
      description: commit.description,
      isWorkingCopy: commit.isWorkingCopy,
    })
  }, [])

  if (!state) {
    return <EmptyState status="loading" repos={[]} activeRepoId={null} error={null} />
  }

  const filesFor = (commit: CommitView) =>
    commit.isWorkingCopy ? graph?.workingCopyFiles : files.get(fileKey(repoId, commit.commitId))

  return (
    <div className="app">
      <Toolbar
        repos={state.repos}
        activeRepoId={state.activeRepoId}
        graph={graph}
        isBusy={state.busy !== null}
        isEvolutionOpen={isEvolutionOpen}
        onToggleEvolution={() => setIsEvolutionOpen((prev) => !prev)}
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
              onSelect={setSelected}
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
        />
      )}
      {state.status === 'ready' && isEvolutionOpen && evolutionCommit && (
        <EvolutionPanel
          commit={evolutionCommit}
          entries={evolutionEntries}
          settings={state.settings}
          now={now}
          onClose={() => setIsEvolutionOpen(false)}
        />
      )}
      {describing && (
        <DescribeDialog
          key={describing.commitId}
          heading={`Describe ${title(describing.description) || describing.commitId.slice(0, 8)}`}
          initial={describing.description}
          canStartNew={describing.isWorkingCopy}
          onCancel={() => setDescribing(null)}
          onSave={(message, startNew) => {
            postMessage({ type: 'describe', commitId: describing.commitId, message, startNew })
            setDescribing(null)
          }}
        />
      )}
    </div>
  )
}
