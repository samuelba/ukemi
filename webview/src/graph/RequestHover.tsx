import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { checkElapsed, spanElapsed } from '../../../shared/ciTiming'
import type { CiCheck, CiSummary, CommitCi, RequestBadge } from '../../../shared/protocol'
import { formatDuration } from '../shared/format'
import { staleRequestsNote } from '../../../shared/forgeStale'
import { stackLabel } from '../../../shared/stack'
import { postMessage } from '../shared/hostApi'
import { CiStatusIcon, REQUEST_LABEL } from './requestMeta'

const CLOSE_DELAY_MS = 120
const POPOVER_WIDTH = 280
const TICK_MS = 1000

function openExternal(url: string): void {
  postMessage({ type: 'openUrl', url })
}

function groupChecks(checks: readonly CiCheck[]): { stage: string; checks: CiCheck[] }[] {
  const groups = new Map<string, CiCheck[]>()
  const order: string[] = []
  for (const check of checks) {
    const stage = check.stage ?? ''
    const list = groups.get(stage)
    if (list) {
      list.push(check)
    } else {
      groups.set(stage, [check])
      order.push(stage)
    }
  }
  return order.map((stage) => ({ stage, checks: groups.get(stage) ?? [] }))
}

// The current time, ticking each second while something still runs.
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

function isRunning(summary: CiSummary): boolean {
  return (
    (summary.ci === 'pending' && !!summary.pipelineStartedAt && !summary.pipelineFinishedAt) ||
    summary.checks.some((check) => check.state === 'pending' && !!check.startedAt)
  )
}

function pipelineElapsed(summary: CiSummary, now: number): number | undefined {
  return spanElapsed(
    { startedAt: summary.pipelineStartedAt, finishedAt: summary.pipelineFinishedAt },
    summary.ci === 'pending',
    now,
  )
}

// The pipeline link and the jobs, grouped by stage.
function CiChecks({ summary, now }: { summary: CiSummary; now: number }) {
  const groups = groupChecks(summary.checks)
  const pipelineUrl = summary.pipelineUrl
  return (
    <>
      {pipelineUrl && (
        <button type="button" className="request-check" onClick={() => openExternal(pipelineUrl)}>
          <span className="request-check-name">Pipeline</span>
          <Elapsed ms={pipelineElapsed(summary, now)} />
        </button>
      )}
      {groups.length === 0 && <div className="request-popover-empty">No jobs</div>}
      {groups.map((group) => (
        <div key={group.stage || 'checks'} className="request-stage">
          {group.stage && <div className="request-stage-name">{group.stage}</div>}
          {group.checks.map((check) => (
            <button
              key={`${group.stage}-${check.name}-${check.url}`}
              type="button"
              className="request-check"
              disabled={!check.url}
              onClick={() => openExternal(check.url)}
            >
              <CiStatusIcon state={check.state} />
              <span className="request-check-name">{check.name}</span>
              <Elapsed ms={checkElapsed(check, now)} />
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

function Elapsed({ ms }: { ms: number | undefined }) {
  return ms === undefined ? null : <span className="request-check-time">{formatDuration(ms)}</span>
}

function RequestPopoverBody({
  request,
  refreshError,
}: {
  request: RequestBadge
  refreshError: string | undefined
}) {
  const pipelineUrl = request.pipelineUrl
  const now = useNow(isRunning(request))
  const pipelineMs = pipelineElapsed(request, now)
  return (
    <>
      <button
        type="button"
        className="request-popover-title"
        onClick={() => openExternal(request.url)}
      >
        #{request.number} {request.title}
      </button>
      <div className="request-popover-meta">
        {REQUEST_LABEL[request.state]}
        {request.ci === 'none' ? '' : ` · CI ${request.ci}`}
        {!pipelineUrl && pipelineMs !== undefined ? ` · ${formatDuration(pipelineMs)}` : ''}
        {request.stack ? ` · ${stackLabel(request.stack)} in stack` : ''}
      </div>
      {refreshError && (
        <div className="request-popover-stale">{staleRequestsNote(refreshError)}</div>
      )}
      <CiChecks summary={request} now={now} />
    </>
  )
}

function TrunkCiPopoverBody({
  trunkCi,
  trunkName,
  refreshError,
}: {
  trunkCi: CommitCi
  trunkName: string
  refreshError: string | undefined
}) {
  const now = useNow(isRunning(trunkCi))
  const pipelineMs = trunkCi.pipelineUrl ? undefined : pipelineElapsed(trunkCi, now)
  return (
    <>
      <div className="request-popover-title static">CI of {trunkName}</div>
      <div className="request-popover-meta">
        {trunkCi.ci === 'none' ? 'No CI' : `CI ${trunkCi.ci}`}
        {pipelineMs !== undefined ? ` · ${formatDuration(pipelineMs)}` : ''}
        {` · ${trunkCi.commitId.slice(0, 12)}`}
      </div>
      {refreshError && (
        <div className="request-popover-stale">{staleRequestsNote(refreshError)}</div>
      )}
      {trunkCi.ci !== 'none' && <CiChecks summary={trunkCi} now={now} />}
    </>
  )
}

export function RequestHover({
  request,
  refreshError,
  children,
}: {
  request: RequestBadge
  refreshError: string | undefined
  children: ReactNode
}) {
  return (
    <CiHover content={<RequestPopoverBody request={request} refreshError={refreshError} />}>
      {children}
    </CiHover>
  )
}

export function TrunkCiHover({
  trunkCi,
  trunkName,
  refreshError,
  children,
}: {
  trunkCi: CommitCi
  trunkName: string
  refreshError: string | undefined
  children: ReactNode
}) {
  return (
    <CiHover
      content={
        <TrunkCiPopoverBody trunkCi={trunkCi} trunkName={trunkName} refreshError={refreshError} />
      }
    >
      {children}
    </CiHover>
  )
}

// Opens its content in a popover while the pointer is over the children or the popover.
function CiHover({ content, children }: { content: ReactNode; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  function clearClose(): void {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function open(): void {
    clearClose()
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    const spaceBelow = window.innerHeight - rect.bottom
    const top =
      spaceBelow < 120 && rect.top > spaceBelow
        ? Math.max(8, rect.top - Math.min(280, rect.top - 8))
        : rect.bottom
    setPosition({
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)),
    })
  }

  function scheduleClose(): void {
    clearClose()
    closeTimer.current = setTimeout(() => setPosition(null), CLOSE_DELAY_MS)
  }

  return (
    <span className="request-hover" ref={anchor} onMouseEnter={open} onMouseLeave={scheduleClose}>
      {children}
      {position &&
        createPortal(
          <div
            className="request-popover"
            style={{ top: position.top, left: position.left }}
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
            onClick={(event) => event.stopPropagation()}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}
