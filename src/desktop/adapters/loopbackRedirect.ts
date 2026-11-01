import { createServer, type Server } from 'node:http'
import { Emitter } from '../../app/events'
import type { OAuthRedirect } from '../../app/gitlabAuth'

// The GitLab application must list this exact URI, so the port is fixed.
export const LOOPBACK_PORT = 47817
const PATH = '/gitlab-auth'

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Ukemi</title>
<body style="font:15px system-ui;padding:3rem;color:#1f1d1a;background:#f7f3ec">
<h1 style="font-weight:600">Signed in</h1><p>You can close this tab and go back to Ukemi.</p>`

// Receives the browser's redirect after GitLab sign-in on a local port.
export class LoopbackRedirect implements OAuthRedirect {
  private server: Server | null = null
  private readonly emitter = new Emitter<URLSearchParams>()
  readonly onDidRedirect = this.emitter.event

  constructor(private readonly port = LOOPBACK_PORT) {}

  async prepare(): Promise<string> {
    if (!this.server) {
      this.server = await this.listen()
    }
    return `http://127.0.0.1:${this.port}${PATH}`
  }

  dispose(): void {
    this.server?.close()
    this.server = null
    this.emitter.dispose()
  }

  private listen(): Promise<Server> {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`)
      if (request.method !== 'GET' || url.pathname !== PATH) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
      this.emitter.fire(url.searchParams)
    })
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.port, '127.0.0.1', () => resolve(server))
    })
  }
}
