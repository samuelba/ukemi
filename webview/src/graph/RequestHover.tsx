import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CiCheck, RequestBadge } from '../../../shared/protocol'
import { postMessage } from '../shared/vscodeApi'
import { CiStatusIcon, REQUEST_LABEL } from './requestMeta'

const CLOSE_DELAY_MS = 120
const POPOVER_WIDTH = 280

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

function RequestPopoverBody({ request }: { request: RequestBadge }) {
  const groups = groupChecks(request.checks)
  const pipelineUrl = request.pipelineUrl
  return (
    <>
      <button type="button" className="request-popover-title" onClick={() => openExternal(request.url)}>
        #{request.number} {request.title}
      </button>
      <div className="request-popover-meta">
        {REQUEST_LABEL[request.state]}
        {request.ci === 'none' ? '' : ` · CI ${request.ci}`}
      </div>
      {pipelineUrl && (
        <button type="button" className="request-check" onClick={() => openExternal(pipelineUrl)}>
          Pipeline
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
              <span>{check.name}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

export function RequestHover({ request, children }: { request: RequestBadge; children: ReactNode }) {
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
            <RequestPopoverBody request={request} />
          </div>,
          document.body,
        )}
    </span>
  )
}
