import '@vscode/codicons/dist/codicon.css'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import '../shared/theme.css'
import '../graph/graph.css'
import '../split/split.css'
import '../cleanup/cleanup.css'
import './desktop.css'
import { installContextMenus } from './contextMenu'
import { Shell } from './Shell'

installContextMenus()

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Shell />)
}
