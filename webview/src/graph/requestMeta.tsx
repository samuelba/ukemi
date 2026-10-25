import type { ReactNode } from 'react'
import type { CiState, RequestState } from '../../../shared/protocol'

export const REQUEST_LABEL: Record<RequestState, string> = {
  draft: 'Draft',
  open: 'Open',
  reviewed: 'Reviewed',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed',
}

const CI_ICON: Record<Exclude<CiState, 'none' | 'skipped'>, string> = {
  success: 'codicon-pass-filled',
  failure: 'codicon-error',
  pending: 'codicon-clock',
  manual: 'codicon-play',
}

export function CiStatusIcon({ state }: { state: CiState }): ReactNode {
  if (state === 'none') {
    return null
  }
  if (state === 'skipped') {
    return (
      <svg className="svg-icon ci-skipped" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M2.177 1.293 L1.47 2 L7.47 8 L1.47 14 L2.177 14.707 L8.531 8.354 L8.531 7.646 Z M8.176 1.293 L7.469 2 L13.469 8 L7.469 14 L8.176 14.707 L14.53 8.354 L14.53 7.646 Z"
        />
      </svg>
    )
  }
  return <i className={`codicon ${CI_ICON[state]} ci-${state}`} />
}
