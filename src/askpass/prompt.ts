export interface CredentialRequest {
  field: 'username' | 'password'
  host: string
}

const PROMPT = /^(Username|Password) for 'https:\/\/(?:[^@'/]*@)?([^':/]+)(?::\d+)?[^']*'/

export function parsePrompt(prompt: string): CredentialRequest | null {
  const match = PROMPT.exec(prompt)
  if (!match?.[1] || !match[2]) {
    return null
  }
  return {
    field: match[1] === 'Username' ? 'username' : 'password',
    host: match[2].toLowerCase(),
  }
}
