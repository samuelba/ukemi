import { flatpakAppId } from './hostProcess'

export interface SandboxEntry {
  appId: string
  // Variables the helper reads, passed from the host into the sandbox.
  forwardEnv: readonly string[]
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// A script that git or jj runs to start one of Ukemi's helpers with the app in Node mode. From a
// Flatpak, git and jj run on the host, so the script enters the sandbox again with `flatpak run`.
export function nodeWrapperScript(
  nodePath: string,
  args: readonly string[],
  flag: string,
  sandbox: SandboxEntry | null = defaultSandbox(),
): string {
  const helper = args.map(quote).join(' ')
  if (!sandbox) {
    return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ${flag}=1 exec ${quote(nodePath)} ${helper} "$@"\n`
  }
  const forwarded = sandbox.forwardEnv.map((name) => `--env=${name}="\${${name}:-}"`)
  const options = [
    `--command=${quote(nodePath)}`,
    '--env=ELECTRON_RUN_AS_NODE=1',
    `--env=${flag}=1`,
    ...forwarded,
  ]
  return `#!/bin/sh\nexec flatpak run ${options.join(' ')} ${quote(sandbox.appId)} ${helper} "$@"\n`
}

function defaultSandbox(): SandboxEntry | null {
  const appId = flatpakAppId()
  return appId ? { appId, forwardEnv: [] } : null
}
