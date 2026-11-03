import type { OtherPromptRequest } from '../askpass/prompt'
import type { Ui } from './ui'

// Answers the prompts of git and ssh that are not for a forge credential, such as a key
// passphrase or a new host key. A background fetch never asks, so it fails instead.
export async function answerPrompt(
  ui: Pick<Ui, 'info' | 'ask' | 'input'>,
  request: OtherPromptRequest,
): Promise<string | null> {
  if (!request.interactive) {
    return null
  }
  const lines = request.text.split('\n').map((line) => line.trim())
  switch (request.answer) {
    case 'notice':
      void ui.info(lines.join(' '))
      return ''
    case 'confirm': {
      const question = lines.at(-1) ?? ''
      const detail = lines.slice(0, -1).join('\n') || undefined
      const choice = await ui.ask('warning', question, { detail }, 'Yes', 'No')
      return choice === 'Yes' ? 'yes' : 'no'
    }
    case 'secret':
    case 'text': {
      const value = await ui.input({
        title: 'Ukemi',
        prompt: lines.join(' '),
        password: request.answer === 'secret',
      })
      return value ?? null
    }
  }
}
