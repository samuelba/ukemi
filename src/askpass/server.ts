import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { flatpakAppId, sharedTempDir } from '../util/hostProcess'
import { nodeWrapperScript } from '../util/nodeWrapper'

// What askpassMain reads. From a Flatpak, git runs on the host and the script hands these over.
const ASKPASS_ENV = [
  'UKEMI_ASKPASS_SOCKET',
  'UKEMI_ASKPASS_NONCE',
  'UKEMI_ASKPASS_INTERACTIVE',
  'SSH_ASKPASS_PROMPT',
]
import {
  parseOtherPrompt,
  parsePrompt,
  type CredentialRequest,
  type OtherPromptRequest,
} from './prompt'

export type { CredentialRequest, OtherPromptRequest } from './prompt'
export type CredentialResolver = (request: CredentialRequest) => Promise<string | null>
// Asks the user. Resolves to the answer, or null when the user cancels.
export type PromptResolver = (request: OtherPromptRequest) => Promise<string | null>

interface HelperRequest {
  nonce: string
  prompt: string
  interactive: boolean
  sshMode: string
}

const MAX_REQUEST_BYTES = 4096

function readRequest(line: string): HelperRequest | null {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const record = value as Record<string, unknown>
    const { nonce, prompt } = record
    if (typeof nonce !== 'string' || typeof prompt !== 'string') {
      return null
    }
    const sshMode = typeof record.sshMode === 'string' ? record.sshMode : ''
    return { nonce, prompt, interactive: record.interactive !== false, sshMode }
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
    private readonly ask: PromptResolver,
  ) {}

  async start(): Promise<void> {
    // Git on the host and the helper in the sandbox both reach this folder at the same path.
    const base = sharedTempDir()
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, 'ukemi-askpass-'))
    const appId = flatpakAppId()
    const socketPath = join(dir, 'askpass.sock')
    const scriptPath = join(dir, 'askpass.sh')
    const sandbox = appId ? { appId, forwardEnv: ASKPASS_ENV } : null
    writeFileSync(
      scriptPath,
      nodeWrapperScript(this.nodePath, this.helperArgs, 'UKEMI_ASKPASS', sandbox),
      {
        mode: 0o700,
      },
    )
    const server = createServer((socket) => this.handle(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => resolve())
    })
    this.server = server
    this.dir = dir
    // `force` makes ssh use the helper although it has no display, for key passphrases and new
    // host keys.
    this.env = {
      GIT_ASKPASS: scriptPath,
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
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
    const { interactive } = request
    const credential = parsePrompt(request.prompt)
    if (credential) {
      return this.resolve({ ...credential, interactive })
    }
    const other = parseOtherPrompt(request.prompt, request.sshMode)
    return other ? this.ask({ ...other, interactive }) : null
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
