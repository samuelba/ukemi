import type { ChildProcess } from 'node:child_process'

// A tool can start helpers that inherit its output pipes, like git starting ssh. Killing only the
// tool would leave them running, and the run would last until they end. Started in its own
// process group (spawn's `detached`), they all go.
export const OWN_GROUP = process.platform !== 'win32'

export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (OWN_GROUP && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The group is gone already.
    }
  }
  child.kill(signal)
}
