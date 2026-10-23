import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeWrapperScript } from '../util/nodeWrapper'
import { parsePrompt, type CredentialRequest } from './prompt'

export type { CredentialRequest } from './prompt'
export type CredentialResolver = (request: CredentialRequest) => Promise<string | null>

const MAX_REQUEST_BYTES = 4096

function readRequest(line: string): { nonce: string; prompt: string } | null {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const { nonce, prompt } = value as Record<string, unknown>
    return typeof nonce === 'string' && typeof prompt === 'string' ? { nonce, prompt } : null
  } catch {
    return null
  }
}

export class AskpassServer {
  private server: Server | null = null
  private dir: string | null = null
  private readonly nonce = Buffer.from(randomBytes(32).toString('hex'))
  env: Record<string, string> = {}

  constructor(
    private readonly nodePath: string,
    private readonly helperArgs: readonly string[],
    private readonly resolve: CredentialResolver,
  ) {}

  async start(): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'ukemi-askpass-'))
    const socketPath = join(dir, 'askpass.sock')
    const scriptPath = join(dir, 'askpass.sh')
    writeFileSync(scriptPath, nodeWrapperScript(this.nodePath, this.helperArgs, 'UKEMI_ASKPASS'), {
      mode: 0o700,
    })
    const server = createServer((socket) => this.handle(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => resolve())
    })
    this.server = server
    this.dir = dir
    this.env = {
      GIT_ASKPASS: scriptPath,
      UKEMI_ASKPASS_SOCKET: socketPath,
      UKEMI_ASKPASS_NONCE: this.nonce.toString(),
    }
  }

  private handle(socket: Socket): void {
    let data = ''
    let isAnswered = false
    socket.setEncoding('utf8')
    socket.on('error', () => undefined)
    socket.on('data', (chunk: string) => {
      data += chunk
      if (data.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }
      const end = data.indexOf('\n')
      if (end < 0 || isAnswered) {
        return
      }
      isAnswered = true
      void this.answer(data.slice(0, end))
        .catch(() => null)
        .then((answer) => socket.end(`${JSON.stringify({ answer })}\n`))
    })
  }

  private async answer(line: string): Promise<string | null> {
    const request = readRequest(line)
    if (!request || !this.isValidNonce(request.nonce)) {
      return null
    }
    const credential = parsePrompt(request.prompt)
    return credential ? this.resolve(credential) : null
  }

  private isValidNonce(nonce: string): boolean {
    const given = Buffer.from(nonce)
    return given.length === this.nonce.length && timingSafeEqual(given, this.nonce)
  }

  dispose(): void {
    this.server?.close()
    this.server = null
    if (this.dir) {
      rmSync(this.dir, { recursive: true, force: true })
      this.dir = null
    }
    this.env = {}
  }
}
