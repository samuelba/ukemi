import { createConnection } from 'node:net'

const TIMEOUT_MS = 5 * 60_000

function readAnswer(data: string): string | null {
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value === 'object' && value !== null && 'answer' in value) {
      return typeof value.answer === 'string' ? value.answer : null
    }
  } catch {
    return null
  }
  return null
}

function main(prompt: string): void {
  const socketPath = process.env.UKEMI_ASKPASS_SOCKET
  const nonce = process.env.UKEMI_ASKPASS_NONCE
  if (!socketPath || !nonce) {
    process.exitCode = 1
    return
  }
  let data = ''
  const socket = createConnection(socketPath)
  const timer = setTimeout(() => socket.destroy(), TIMEOUT_MS)
  socket.setEncoding('utf8')
  const interactive = process.env.UKEMI_ASKPASS_INTERACTIVE !== '0'
  socket.on('connect', () => socket.write(`${JSON.stringify({ nonce, prompt, interactive })}\n`))
  socket.on('data', (chunk: string) => {
    data += chunk
  })
  socket.on('error', () => undefined)
  socket.on('close', () => {
    clearTimeout(timer)
    const answer = readAnswer(data)
    if (answer === null) {
      process.exitCode = 1
      return
    }
    process.stdout.write(`${answer}\n`)
  })
}

if (process.env.UKEMI_ASKPASS === '1') {
  main(process.argv[2] ?? '')
}
