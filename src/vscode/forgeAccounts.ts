import * as vscode from 'vscode'
import { Emitter } from '../app/events'
import type { ForgeAccounts } from '../app/forgeService'
import type { OAuthRedirect } from '../app/gitlabAuth'
import { sessionProviderFor, type GithubCredential } from '../forge/githubCredentials'

// Workspace settings come from the repository, so only the user's own value is trusted.
function enterpriseUri(): string | undefined {
  const inspected = vscode.workspace.getConfiguration('github-enterprise').inspect<string>('uri')
  const hasOverride =
    inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined
  return hasOverride
    ? inspected?.globalValue
    : vscode.workspace.getConfiguration('github-enterprise').get<string>('uri')
}

async function githubSession(host: string, interactive: boolean): Promise<GithubCredential | null> {
  const provider = sessionProviderFor(host, enterpriseUri())
  if (!provider) {
    return null
  }
  const session = await vscode.authentication.getSession(provider, ['repo'], {
    createIfNone: interactive,
    silent: !interactive,
  })
  return session ? { username: session.account.label, token: session.accessToken } : null
}

function isAuthPath(path: string): boolean {
  return path === '/gitlab-auth' || path === 'gitlab-auth'
}

// GitLab sends the browser to `vscode://<extension id>/gitlab-auth`, which reaches this handler.
function uriRedirect(extensionId: string): OAuthRedirect {
  const emitter = new Emitter<URLSearchParams>()
  const subscription = vscode.window.registerUriHandler({
    handleUri: (uri) => {
      if (isAuthPath(uri.path)) {
        emitter.fire(new URLSearchParams(uri.query))
      }
    },
  })
  return {
    prepare: async () => `${vscode.env.uriScheme}://${extensionId}/gitlab-auth`,
    onDidRedirect: emitter.event,
    dispose: () => {
      subscription.dispose()
      emitter.dispose()
    },
  }
}

export function vscodeForgeAccounts(extensionId: string): ForgeAccounts {
  return {
    githubSession,
    gitlabRedirect: uriRedirect(extensionId),
    untrustedMessage:
      'Ukemi: trust this workspace to sign in to a forge. Restricted Mode blocks stored credentials.',
  }
}
