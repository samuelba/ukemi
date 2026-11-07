import type { CiCheck } from './protocol'

export interface TimeSpan {
  startedAt?: string
  finishedAt?: string
}

function parse(iso: string | undefined): number | undefined {
  if (iso === undefined) {
    return undefined
  }
  const time = Date.parse(iso)
  return Number.isNaN(time) ? undefined : time
}

// How long a span ran: to its finish, or to now while it still runs. Undefined when it never
// started, or stopped without a finish time.
export function spanElapsed(span: TimeSpan, running: boolean, now: number): number | undefined {
  const started = parse(span.startedAt)
  if (started === undefined) {
    return undefined
  }
  const finished = parse(span.finishedAt)
  if (finished !== undefined) {
    return Math.max(0, finished - started)
  }
  return running ? Math.max(0, now - started) : undefined
}

export function checkElapsed(check: CiCheck, now: number): number | undefined {
  return spanElapsed(check, check.state === 'pending', now)
}

// From the earliest job start to the latest job finish. No finish while a job is still pending.
export function pipelineSpan(checks: readonly CiCheck[]): TimeSpan {
  let start: { time: number; iso: string } | undefined
  let finish: { time: number; iso: string } | undefined
  for (const check of checks) {
    const started = parse(check.startedAt)
    if (started !== undefined && check.startedAt && (!start || started < start.time)) {
      start = { time: started, iso: check.startedAt }
    }
    const finished = parse(check.finishedAt)
    if (finished !== undefined && check.finishedAt && (!finish || finished > finish.time)) {
      finish = { time: finished, iso: check.finishedAt }
    }
  }
  if (!start) {
    return {}
  }
  const running = checks.some((check) => check.state === 'pending')
  return running || !finish
    ? { startedAt: start.iso }
    : { startedAt: start.iso, finishedAt: finish.iso }
}

// A span with its unknown ends left out, as a forge reports them (null or missing).
export function definedSpan(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): TimeSpan {
  return {
    ...(startedAt ? { startedAt } : {}),
    ...(startedAt && finishedAt ? { finishedAt } : {}),
  }
}

export function pipelineFields(span: TimeSpan): {
  pipelineStartedAt?: string
  pipelineFinishedAt?: string
} {
  return {
    ...(span.startedAt ? { pipelineStartedAt: span.startedAt } : {}),
    ...(span.startedAt && span.finishedAt ? { pipelineFinishedAt: span.finishedAt } : {}),
  }
}
