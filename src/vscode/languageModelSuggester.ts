import * as vscode from 'vscode'
import type { Suggester } from '../app/describeSuggest/suggesters'
import { cleanSuggestion } from '../app/describeSuggest/prompt'
import { SuggestionCancelled } from '../app/describeSuggest/suggesters'
import type { Settings } from '../app/settings'

const ID = 'vscode-lm'

// The chat models that VS Code offers to extensions, such as those of GitHub Copilot Chat.
// VS Code asks the user once whether Ukemi may use them.
export class LanguageModelSuggester implements Suggester {
  readonly id = ID
  private name = 'Language model'

  constructor(private readonly settings: Settings) {}

  get label(): string {
    return this.name
  }

  async available(): Promise<boolean> {
    const model = await this.model()
    if (model) {
      this.name = model.vendor === 'copilot' ? 'Copilot Chat' : model.name
    }
    return model !== undefined
  }

  async suggest(prompt: string, signal: AbortSignal): Promise<string> {
    const model = await this.model()
    if (!model) {
      throw new Error('No language model is available in VS Code.')
    }
    const cancellation = new vscode.CancellationTokenSource()
    const cancel = () => cancellation.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(prompt)],
        { justification: 'Ukemi suggests a description for a change from its diff.' },
        cancellation.token,
      )
      let text = ''
      for await (const part of response.text) {
        text += part
      }
      const suggestion = cleanSuggestion(text)
      if (!suggestion) {
        throw new Error(`${model.name} gave no answer.`)
      }
      return suggestion
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new SuggestionCancelled()
      }
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      cancellation.dispose()
    }
  }

  // The model the settings name, by id or family, or else the first Copilot model.
  private async model(): Promise<vscode.LanguageModelChat | undefined> {
    const wanted = this.settings.read().suggestModels[ID]
    const models = wanted
      ? [
          ...(await vscode.lm.selectChatModels({ id: wanted })),
          ...(await vscode.lm.selectChatModels({ family: wanted })),
        ]
      : [
          ...(await vscode.lm.selectChatModels({ vendor: 'copilot' })),
          ...(await vscode.lm.selectChatModels()),
        ]
    return models[0]
  }
}
