import { describe, expect, test } from 'vitest'
import { answerPrompt } from '../../src/app/askpassPrompts'
import type { OtherPromptRequest } from '../../src/askpass/prompt'
import type { InputOptions } from '../../src/app/ui'

function setup(reply: { input?: string; choice?: string } = {}) {
  const shown: string[] = []
  const inputs: InputOptions[] = []
  const questions: { text: string; detail?: string }[] = []
  const ui = {
    info: async (text: string) => {
      shown.push(text)
      return undefined
    },
    ask: async (_level: string, text: string, options: { detail?: string }) => {
      questions.push({ text, detail: options.detail })
      return reply.choice
    },
    input: async (options: InputOptions) => {
      inputs.push(options)
      return reply.input
    },
  }
  return { ui, shown, inputs, questions }
}

function request(overrides: Partial<OtherPromptRequest>): OtherPromptRequest {
  return { text: 'Enter passphrase:', answer: 'secret', interactive: true, ...overrides }
}

describe('answerPrompt', () => {
  test('asks for a secret in a password box', async () => {
    const { ui, inputs } = setup({ input: 'hunter2' })

    expect(await answerPrompt(ui, request({}))).toBe('hunter2')
    expect(inputs[0]).toMatchObject({ prompt: 'Enter passphrase:', password: true })
  })

  test('returns null when the user cancels', async () => {
    const { ui } = setup()

    expect(await answerPrompt(ui, request({}))).toBeNull()
  })

  test('answers yes or no to a new host key, with the fingerprint as detail', async () => {
    const text =
      "The authenticity of host 'x' can't be established.\nKey is SHA256:abc.\nContinue (yes/no)? "
    const yes = setup({ choice: 'Yes' })
    const no = setup({ choice: undefined })

    expect(await answerPrompt(yes.ui, request({ text, answer: 'confirm' }))).toBe('yes')
    expect(await answerPrompt(no.ui, request({ text, answer: 'confirm' }))).toBe('no')
    expect(yes.questions[0]).toEqual({
      text: 'Continue (yes/no)?',
      detail: "The authenticity of host 'x' can't be established.\nKey is SHA256:abc.",
    })
  })

  test('shows a notice without waiting', async () => {
    const { ui, shown } = setup()

    expect(await answerPrompt(ui, request({ text: 'Touch your key', answer: 'notice' }))).toBe('')
    expect(shown).toEqual(['Touch your key'])
  })

  test('never asks for a background fetch', async () => {
    const { ui, inputs } = setup({ input: 'x' })

    expect(await answerPrompt(ui, request({ interactive: false }))).toBeNull()
    expect(inputs).toEqual([])
  })
})
