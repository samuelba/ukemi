import { useId } from 'react'

interface LoadingMarkProps {
  spinning?: boolean
}

export function LoadingMark({ spinning = false }: LoadingMarkProps) {
  const maskId = `mark-gap${useId().replace(/:/g, '')}`
  const className = spinning ? 'empty-mark spinning' : 'empty-mark'
  return (
    <svg className={className} viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="256" height="256" fill="#fff" />
          <polygon points="128,124 176,-8 255,65" fill="#000" />
        </mask>
      </defs>
      <path
        mask={`url(#${maskId})`}
        fill="var(--ukemi-mark-ink)"
        fillRule="evenodd"
        d="M 36 124 A 92 92 0 1 0 220 124 A 92 92 0 1 0 36 124 Z M 63 120 A 71 71 0 1 0 205 120 A 71 71 0 1 0 63 120 Z"
      />
      <g className="mark-base">
        <path
          d="M 106 174 L 106 128"
          fill="none"
          stroke="var(--ukemi-mark-ink)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <circle cx="106" cy="174" r="13" fill="var(--ukemi-mark-ink)" />
        <g className="mark-upper">
          <path
            d="M 106 128 C 106 104 150 116 150 96"
            fill="none"
            stroke="var(--ukemi-mark-ink)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <circle cx="106" cy="128" r="13" fill="var(--ukemi-mark-ink)" />
          <g className="mark-head">
            <g transform="rotate(-8 150 84)">
              <rect x="130" y="64" width="40" height="40" rx="6" fill="var(--shu)" />
              <rect
                x="137"
                y="71"
                width="26"
                height="26"
                rx="3"
                fill="none"
                stroke="var(--washi)"
                strokeWidth="3"
              />
            </g>
          </g>
        </g>
      </g>
    </svg>
  )
}

export function LoadingScreen({ heading }: { heading: string }) {
  return (
    <div className="empty" role="status">
      <LoadingMark spinning />
      <div className="empty-heading">{heading}</div>
    </div>
  )
}
