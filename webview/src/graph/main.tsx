import '@vscode/codicons/dist/codicon.css'
import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import { App } from './App'
import './graph.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<App />)
}
