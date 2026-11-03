export interface CredentialPrompt {
  field: 'username' | 'password'
  host: string
}

export interface CredentialRequest extends CredentialPrompt {
  interactive: boolean
}

const PROMPT = /^(Username|Password) for 'https:\/\/(?:[^@'/]*@)?([^':/]+)(?::\d+)?[^']*'/

export function parsePrompt(prompt: string): CredentialPrompt | null {
  const match = PROMPT.exec(prompt)
  if (!match?.[1] || !match[2]) {
    return null
  }
  return {
    field: match[1] === 'Username' ? 'username' : 'password',
    host: match[2].toLowerCase(),
  }
}

// How the user answers a prompt that is not for a forge credential: ssh asks for a key passphrase,
// a password or a PIN, asks to trust a new host key, or only shows a notice.
export type PromptAnswer = 'secret' | 'text' | 'confirm' | 'notice'

export interface OtherPrompt {
  text: string
  answer: PromptAnswer
}

export interface OtherPromptRequest extends OtherPrompt {
  interactive: boolean
}

const QUESTION = /\((?:yes\/no)[^)]*\)\?\s*$/
const USERNAME = /^Username for /

// `sshMode` is SSH_ASKPASS_PROMPT, which ssh sets to `confirm` or `none` for prompts that are not
// for a secret.
export function parseOtherPrompt(prompt: string, sshMode = ''): OtherPrompt | null {
  const text = prompt.trim()
  if (!text) {
    return null
  }
  if (sshMode === 'none') {
    return { text, answer: 'notice' }
  }
  if (sshMode === 'confirm' || QUESTION.test(text)) {
    return { text, answer: 'confirm' }
  }
  return { text, answer: USERNAME.test(text) ? 'text' : 'secret' }
}
