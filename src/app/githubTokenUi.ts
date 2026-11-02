import type { CredentialUi, GithubCredential } from '../forge/githubCredentials'
import type { Ui } from './ui'

const SIGN_IN = 'Sign In with GitHub'
const ENTER_TOKEN = 'Enter Token'
const CREATE_TOKEN = 'Create Token'

function tokenPage(host: string): string {
  return `https://${host}/settings/tokens/new?scopes=repo&description=Ukemi`
}

const required = (what: string) => (value: string) =>
  value.trim().length > 0 ? undefined : `Enter ${what}.`

const TOKEN_DETAIL = 'Enter your user name and a personal access token with the "repo" scope.'
const SESSION_DETAIL =
  'Sign in with the GitHub account of the editor, or enter your user name and a personal access token with the "repo" scope.'

// `hasSession` offers the editor's own GitHub account. A host without one only offers a token.
export const githubTokenUi = (ui: Ui, hasSession: boolean): CredentialUi => ({
  async choose(host: string) {
    const choice = await ui.ask(
      'info',
      `Ukemi needs access to ${host}.`,
      { detail: hasSession ? SESSION_DETAIL : TOKEN_DETAIL },
      ...(hasSession ? [SIGN_IN] : []),
      ENTER_TOKEN,
      CREATE_TOKEN,
    )
    if (choice === CREATE_TOKEN) {
      await ui.openExternal(tokenPage(host))
      return 'token'
    }
    if (choice === SIGN_IN) {
      return 'session'
    }
    return choice === ENTER_TOKEN ? 'token' : undefined
  },

  async enterToken(host: string): Promise<GithubCredential | undefined> {
    const username = await ui.input({
      title: `GitHub user name for ${host}`,
      validate: required('your user name'),
    })
    if (!username) {
      return undefined
    }
    const token = await ui.input({
      title: `GitHub token for ${host}`,
      prompt: 'Paste a personal access token with the "repo" scope',
      password: true,
      validate: required('the token'),
    })
    return token ? { username: username.trim(), token: token.trim() } : undefined
  },
})
