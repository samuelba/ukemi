import type { DesktopRendererMessage } from '../../../shared/desktopProtocol'
import type { RepoSummary } from '../../../shared/protocol'
import { postMessage } from '../shared/hostApi'
import { RepoTabs } from './RepoTabs'
import type { Layout, UpdateLayout } from './useLayout'

interface TitlebarProps {
  repos: readonly RepoSummary[]
  activeRepoId: string | null
  platform: string
  layout: Layout
  update: UpdateLayout
  onOpenPalette: () => void
}

// The repository tabs, the command search and the pane toggles.
export function Titlebar({
  repos,
  activeRepoId,
  platform,
  layout,
  update,
  onOpenPalette,
}: TitlebarProps) {
  return (
    <header className="titlebar">
      <span className="wordmark" aria-label="Ukemi">
        ukemi
      </span>
      <RepoTabs repos={repos} activeRepoId={activeRepoId} />
      <button className="titlebar-search" onClick={onOpenPalette} title="Run a command (F1)">
        <span className="codicon codicon-search" aria-hidden />
        <span>Run a command</span>
        <kbd>{platform === 'darwin' ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <button
        className={`icon-button${layout.showSidebar ? ' is-on' : ''}`}
        title="Toggle sidebar (Ctrl+B)"
        aria-pressed={layout.showSidebar}
        onClick={() => update({ showSidebar: !layout.showSidebar })}
      >
        <span className="codicon codicon-layout-sidebar-left" aria-hidden />
      </button>
      <button
        className={`icon-button${layout.showPanel ? ' is-on' : ''}`}
        title="Toggle panel: terminal and log"
        aria-pressed={layout.showPanel}
        onClick={() => update({ showPanel: !layout.showPanel })}
      >
        <span className="codicon codicon-layout-panel" aria-hidden />
      </button>
      <button
        className={`icon-button${layout.showDetail ? ' is-on' : ''}`}
        title="Toggle details (Ctrl+J)"
        aria-pressed={layout.showDetail}
        onClick={() => update({ showDetail: !layout.showDetail })}
      >
        <span className="codicon codicon-layout-sidebar-right" aria-hidden />
      </button>
      <button
        className="icon-button"
        title="More actions"
        onClick={(e) =>
          postMessage<DesktopRendererMessage>({
            type: 'desktop.titleMenu',
            x: e.currentTarget.getBoundingClientRect().left,
            y: e.currentTarget.getBoundingClientRect().bottom,
          })
        }
      >
        <span className="codicon codicon-ellipsis" aria-hidden />
      </button>
    </header>
  )
}
