import { homedir } from 'node:os'
import { runTool } from '../util/runTool'
import { isSafeHttpsHost } from './hostName'

export type SshRun = (args: readonly string[]) => Promise<{ code: number; stdout: string }>

const SSH_TIMEOUT_MS = 3_000
const MAX_OUTPUT = 64_000

// What a remote URL may name as an SSH host: no leading dash that ssh would read as an option.
const ALIAS = /^[a-z0-9][a-z0-9._-]*$/i

export const runSsh: SshRun = async (args) => {
  const { stdout, code } = await runTool('ssh', args, {
    cwd: homedir(),
    timeoutMs: SSH_TIMEOUT_MS,
    maxOutput: MAX_OUTPUT,
  })
  return { stdout, code }
}

// Finds the server behind a host alias of ~/.ssh/config, such as `github-work`. `ssh -G` prints
// the configuration for a host without connecting.
export class SshHosts {
  private readonly hostNames = new Map<string, Promise<string | null>>()

  constructor(private readonly run: SshRun = runSsh) {}

  // The aliases among `hosts`, with the server each stands for.
  async resolve(hosts: readonly string[]): Promise<Map<string, string>> {
    const resolved = await Promise.all(
      hosts.map(async (host) => [host, await this.hostName(host)] as const),
    )
    const aliases = new Map<string, string>()
    for (const [host, hostName] of resolved) {
      if (hostName && hostName !== host.toLowerCase()) {
        aliases.set(host, hostName)
      }
    }
    return aliases
  }

  private hostName(host: string): Promise<string | null> {
    if (!ALIAS.test(host)) {
      return Promise.resolve(null)
    }
    let pending = this.hostNames.get(host)
    if (!pending) {
      pending = this.lookup(host)
      this.hostNames.set(host, pending)
      // A failed run, such as ssh missing or timing out, is tried again next time.
      void pending.then((hostName) => hostName ?? this.hostNames.delete(host))
    }
    return pending
  }

  private async lookup(host: string): Promise<string | null> {
    try {
      const { code, stdout } = await this.run(['-G', '--', host])
      const hostName = /^hostname (\S+)$/m.exec(stdout)?.[1]?.toLowerCase()
      return code === 0 && hostName && isSafeHttpsHost(hostName) ? hostName : null
    } catch {
      return null
    }
  }
}
