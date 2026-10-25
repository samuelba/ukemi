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
