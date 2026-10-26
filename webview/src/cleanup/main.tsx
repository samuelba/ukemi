import '@vscode/codicons/dist/codicon.css'
import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import { CleanupApp } from './CleanupApp'
import './cleanup.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<CleanupApp />)
}
