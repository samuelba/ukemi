import type { CommitView, SuggesterView } from '../../../shared/protocol'
import type { RepoModel } from '../../repo/repoModel'
import type { Settings } from '../settings'
import { buildPrompt, limitDiff } from './prompt'
import { CLI_SPECS, CliSuggester, SuggestionCancelled, type Suggester } from './suggesters'

const ANCESTOR_DESCRIPTIONS = 10

export function cliSuggesters(settings: Settings): Suggester[] {
  return CLI_SPECS.map(
    (spec) =>
      new CliSuggester(spec, () => ({ model: settings.read().suggestModels[spec.id] ?? '' })),
  )
}

// Asks the tools the user has for a description of a change. Only the newest request of the
// dialog matters, so each one can be cancelled by its id.
export class DescriptionSuggestions {
  private readonly pending = new Map<string, AbortController>()

  constructor(
    private readonly suggesters: readonly Suggester[],
    private readonly settings: Settings,
  ) {}

  // The installed tools that the settings enable, in the order the settings list them.
  async list(): Promise<SuggesterView[]> {
    const enabled = this.settings
      .read()
      .suggestTools.map((id) => this.suggesters.find((s) => s.id === id))
      .filter((s): s is Suggester => s !== undefined)
    const available = await Promise.all(enabled.map((s) => s.available()))
    return enabled.filter((_, i) => available[i]).map(({ id, label }) => ({ id, label }))
  }

  async suggest(
    model: RepoModel,
    commit: CommitView,
    suggesterId: string,
    requestId: string,
  ): Promise<string> {
    const suggester = this.suggesters.find((s) => s.id === suggesterId)
    if (!suggester || !this.settings.read().suggestTools.includes(suggesterId)) {
      throw new Error(`Unknown suggester ${suggesterId}`)
    }
    const controller = new AbortController()
    this.cancel(requestId)
    this.pending.set(requestId, controller)
    try {
      const prompt = await this.prompt(model, commit)
      if (controller.signal.aborted) {
        throw new SuggestionCancelled()
      }
      return await suggester.suggest(prompt, controller.signal)
    } finally {
      if (this.pending.get(requestId) === controller) {
        this.pending.delete(requestId)
      }
    }
  }

  cancel(requestId: string): void {
    this.pending.get(requestId)?.abort()
    this.pending.delete(requestId)
  }

  private async prompt(model: RepoModel, commit: CommitView): Promise<string> {
    const config = this.settings.read(model.root)
    const [diff, stat, ancestorDescriptions] = await Promise.all([
      model.repo.diffGit(commit.commitId),
      model.repo.diffStat(commit.commitId),
      model.repo.ancestorDescriptions(commit.commitId, ANCESTOR_DESCRIPTIONS),
    ])
    if (!diff.trim()) {
      throw new Error('The change is empty, so there is nothing to describe.')
    }
    return buildPrompt({
      description: commit.description,
      stat,
      diff: limitDiff(diff, config.suggestMaxDiffBytes),
      ancestorDescriptions,
      instructions: config.suggestInstructions,
    })
  }
}
