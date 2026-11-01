import { useEffect, useState } from 'react'
import type { AboutInfo, DesktopRendererMessage } from '../../../shared/desktopProtocol'
import { postMessage } from '../shared/hostApi'

function send(message: DesktopRendererMessage): void {
  postMessage(message)
}

const COPIED_MS = 1_600

// Help > About: what this build is, what it runs on, and where it comes from.
export function AboutDialog({
  info,
  text,
  onClose,
}: {
  info: AboutInfo
  text: string
  onClose: () => void
}) {
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!isCopied) {
      return
    }
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [isCopied])

  const facts: Array<[string, string]> = [
    ['jj', info.jj ? `${info.jj.version} · ${info.jj.path}` : 'not found'],
    ['Electron', info.electron],
    ['Chromium', info.chromium],
    ['Node', info.node],
    ['System', info.os],
    ['Data', info.userData],
  ]

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="prompt about" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="about-header">
          <h2 id="about-title" className="about-wordmark">
            ukemi
          </h2>
          <span className="about-version">{info.version}</span>
          <p className="about-description">{info.description}</p>
        </header>
        <dl className="about-facts">
          {facts.map(([label, value]) => (
            <div key={label} className="about-fact">
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        <nav className="about-links" aria-label="Links">
          <button
            className="link-button"
            onClick={() => send({ type: 'desktop.openExternal', url: info.website })}
          >
            Website
          </button>
          <button
            className="link-button"
            onClick={() => send({ type: 'desktop.openExternal', url: info.repository })}
          >
            Source code
          </button>
          <button
            className="link-button"
            onClick={() =>
              send({ type: 'desktop.openExternal', url: `${info.repository}/blob/main/LICENSE` })
            }
          >
            {info.license} License
          </button>
        </nav>
        <footer className="prompt-footer about-footer">
          <span className="prompt-hint">{info.copyright}</span>
          <span className="titlebar-spacer" />
          <button
            className="button-quiet"
            onClick={() => {
              send({ type: 'desktop.copy', text })
              setIsCopied(true)
            }}
          >
            <span className={`codicon codicon-${isCopied ? 'check' : 'copy'}`} aria-hidden />
            {isCopied ? 'Copied' : 'Copy'}
          </button>
          <button className="button-primary" autoFocus onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
