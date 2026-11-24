import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HostMessage, ViewState, WebviewMessage } from '../../shared/protocol'

let state: ViewState

vi.mock('vscode', () => {
  const event = () => ({ dispose: () => undefined })
  return {
    env: { appName: 'Visual Studio Code' },
    workspace: { workspaceFolders: [], onDidChangeConfiguration: event },
    window: { onDidChangeActiveColorTheme: event },
  }
})
vi.mock('../../src/vscode/config', () => ({ readConfig: () => ({}) }))
vi.mock('../../src/vscode/fileIconTheme', () => ({
  iconThemeResourceRoots: () => [],
  loadFileIconTheme: async () => null,
}))
vi.mock('../../src/vscode/webviewPanel', () => ({ webviewHtml: () => '' }))
vi.mock('../../src/app/viewState', () => ({ buildViewState: () => state }))

const { GraphView } = await import('../../src/vscode/graphView')

function fakeWebview() {
  const posted: HostMessage[] = []
  let receive: (message: WebviewMessage) => Promise<void> = async () => undefined
  const webview = {
    options: {},
    html: '',
    postMessage: async (message: HostMessage) => {
      posted.push(message)
      return true
    },
    onDidReceiveMessage: (listener: typeof receive) => {
      receive = listener
      return { dispose: () => undefined }
    },
  }
  const view = {
    webview,
    visible: true,
    onDidDispose: () => ({ dispose: () => undefined }),
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
  }
  return { view, posted, ready: () => receive({ type: 'ready' }) }
}

function graphView() {
  const event = () => ({ dispose: () => undefined })
  return new GraphView(
    {} as never,
    { onDidChange: event } as never,
    { onDidChange: event } as never,
    { isAvailable: true },
    { error: () => undefined } as never,
  )
}

const graph = { workingCopyFiles: [], commits: [] }
const graphs = (posted: HostMessage[]) =>
  posted.flatMap((message) => (message.type === 'state' ? [message.state.graph] : []))

describe('GraphView state messages', () => {
  beforeEach(() => {
    state = { graph, repos: [], activeRepoId: null, busy: null } as unknown as ViewState
  })

  test('leaves out a graph the webview already shows', async () => {
    const view = graphView()
    const webview = fakeWebview()
    view.resolveWebviewView(webview.view as never)
    await webview.ready()

    state = { ...state, busy: 'Fetch' }
    view.postState()

    expect(graphs(webview.posted)).toEqual([graph, null])
    expect(webview.posted.at(-1)).toMatchObject({ graphUnchanged: true, state: { busy: 'Fetch' } })
  })

  test('sends the whole state until the webview is ready', async () => {
    const view = graphView()
    const webview = fakeWebview()
    view.resolveWebviewView(webview.view as never)

    view.postState()
    view.postState()
    await webview.ready()

    expect(graphs(webview.posted)).toEqual([graph, graph, graph])
  })

  test('keeps track of each webview on its own', async () => {
    const view = graphView()
    const sidebar = fakeWebview()
    const editor = fakeWebview()
    view.resolveWebviewView(sidebar.view as never)
    await sidebar.ready()
    view.resolveWebviewView(editor.view as never)
    await editor.ready()

    expect(graphs(sidebar.posted)).toEqual([graph, null])
    expect(graphs(editor.posted)).toEqual([graph])
  })

  test('sends the graph again to a webview that loaded again', async () => {
    const view = graphView()
    const webview = fakeWebview()
    view.resolveWebviewView(webview.view as never)
    await webview.ready()
    await webview.ready()

    expect(graphs(webview.posted)).toEqual([graph, graph])
  })
})
