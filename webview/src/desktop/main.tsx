import '@vscode/codicons/dist/codicon.css'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import '../shared/theme.css'
import '../graph/graph.css'
import '../split/split.css'
import '../cleanup/cleanup.css'
import '../editor/editor.css'
import '../history/history.css'
// In this order, the order of the cascade.
import './styles/base.css'
import './styles/titlebar.css'
import './styles/panes.css'
import './styles/sidebar.css'
import './styles/details.css'
import './styles/diff.css'
import './styles/prompts.css'
import './styles/toasts.css'
import './styles/repoTabs.css'
import './styles/rightPane.css'
import './styles/settings.css'
import './styles/bottomPanel.css'
import './styles/about.css'
import './styles/rowActions.css'
import './styles/statusBar.css'
import { installContextMenus } from './contextMenu'
import { Shell } from './Shell'

installContextMenus()

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Shell />)
}
