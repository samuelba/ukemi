import { execFile } from 'node:child_process'

const TIMEOUT_MS = 5_000
const MARKER = '__UKEMI_PATH__'

// An app started from the Dock or a launcher gets a minimal PATH without Homebrew, mise or
// cargo. The login shell knows the PATH the user set up, so jj and git are found as in a terminal.
export async function loginShellPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const shell = env.SHELL
  if (!shell || process.platform === 'win32') {
    return null
  }
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: TIMEOUT_MS, env },
      (error, stdout) => {
        const match = new RegExp(`${MARKER}(.*)${MARKER}`).exec(stdout)
        resolve(error || !match?.[1] ? null : match[1])
      },
    )
  })
}

// Uses the login shell's PATH when the app did not start from a terminal.
export async function adoptLoginShellPath(env: NodeJS.ProcessEnv): Promise<void> {
  // A Flatpak runs jj and git on the host, which has the user's own PATH already.
  if (env.FLATPAK_ID || (process.platform !== 'darwin' && env.TERM !== undefined)) {
    return
  }
  const path = await loginShellPath(env)
  if (path) {
    env.PATH = path
  }
}
