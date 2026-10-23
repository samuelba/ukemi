import * as vscode from 'vscode'
import type { CredentialUi, GithubCredential } from '../forge/githubCredentials'

const SIGN_IN = 'Sign In with GitHub'
const ENTER_TOKEN = 'Enter Token'
const CREATE_TOKEN = 'Create Token'

function tokenPage(host: string): vscode.Uri {
  return vscode.Uri.parse(`https://${host}/settings/tokens/new?scopes=repo&description=Ukemi`)
}

const required = (what: string) => (value: string) =>
  value.trim().length > 0 ? undefined : `Enter ${what}.`

export const githubTokenUi: CredentialUi = {
  async choose(host: string) {
    const choice = await vscode.window.showInformationMessage(
      `Ukemi needs access to ${host}.`,
      {
        modal: true,
        detail:
          'Sign in with the GitHub account of the editor, or enter your user name and a personal access token with the "repo" scope.',
      },
      SIGN_IN,
      ENTER_TOKEN,
      CREATE_TOKEN,
    )
    if (choice === CREATE_TOKEN) {
      await vscode.env.openExternal(tokenPage(host))
      return 'token'
    }
    if (choice === SIGN_IN) {
      return 'session'
    }
    return choice === ENTER_TOKEN ? 'token' : undefined
  },

  async enterToken(host: string): Promise<GithubCredential | undefined> {
    const username = await vscode.window.showInputBox({
      title: `GitHub user name for ${host}`,
      ignoreFocusOut: true,
      validateInput: required('your user name'),
    })
    if (!username) {
      return undefined
    }
    const token = await vscode.window.showInputBox({
      title: `GitHub token for ${host}`,
      prompt: 'Paste a personal access token with the "repo" scope',
      password: true,
      ignoreFocusOut: true,
      validateInput: required('the token'),
    })
    return token ? { username: username.trim(), token: token.trim() } : undefined
  },
}
