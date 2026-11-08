import { basename } from 'node:path'
import type { ShellInbound } from '../../shared/desktopProtocol'
import { isRepositoryKey } from '../../shared/settingsScope'
import type { Logger } from '../util/logger'
import type { SettingsFile } from './adapters/settingsFile'
import { isValidSettingValue, runsProgram, settingFields } from './settingsSchema'

export type PresentedSettings = Pick<SettingsFile, 'path' | 'values' | 'overrides' | 'update'>

export interface SettingsDeps {
  settings: PresentedSettings
  // The repositories the window shows, by id.
  repos: () => readonly { id: string; label: string }[]
  activeRoot: () => string | null
  post: (message: ShellInbound) => void
  // Asks in a native dialog, which the page cannot answer itself.
  confirm: (text: string, detail: string, action: string) => Promise<boolean>
  logger: Logger
}

// The settings form of a window: what it shows, and the values it writes back.
export class SettingsPresenter {
  // The repository the form last showed.
  private shownRoot: string | null = null

  constructor(private readonly deps: SettingsDeps) {}

  post(): void {
    const { settings } = this.deps
    const overrides = settings.overrides()
    const labels = new Map(this.deps.repos().map((s) => [s.id, s.label]))
    const overriddenIn = (key: string) =>
      [...overrides]
        .filter(([, values]) => key in values)
        .map(([root]) => labels.get(root) ?? basename(root))
    const root = this.deps.activeRoot()
    this.shownRoot = root
    this.deps.post({
      type: 'desktop.settings',
      fields: settingFields(settings.values(), overriddenIn),
      path: settings.path,
      repository: root
        ? {
            id: root,
            label: labels.get(root) ?? basename(root),
            values: { ...settings.values(root) },
          }
        : null,
    })
  }

  // The form's "This repository" mode follows the active repository.
  followActiveRepo(): void {
    if (this.shownRoot !== this.deps.activeRoot()) {
      this.post()
    }
  }

  // A value from the form. The renderer is not trusted, so the key, the value and the
  // repository are checked here.
  async set(key: unknown, value: unknown, repoId: unknown): Promise<void> {
    const field = settingFields({}).find((f) => f.key === key)
    if (typeof key !== 'string' || !field) {
      return
    }
    if (!isValidSettingValue(field, value)) {
      this.deps.logger.warn(`ignored an invalid value for the setting ${key}`)
      this.post()
      return
    }
    if (runsProgram(key) && !(await this.confirmProgram(key, value))) {
      this.post()
      return
    }
    if (repoId === undefined) {
      await this.deps.settings.update(key, value)
      return
    }
    // Only open repositories, so the renderer cannot write overrides for arbitrary paths.
    const isOpen = this.deps.repos().some((repo) => repo.id === repoId)
    if (typeof repoId === 'string' && isOpen && isRepositoryKey(key)) {
      await this.deps.settings.update(key, value, { root: repoId })
    }
  }

  private async confirmProgram(key: string, value: unknown): Promise<boolean> {
    if (typeof value !== 'string' || value.trim() === '') {
      return true
    }
    return this.deps.confirm(
      `Run jj from ${value}?`,
      `Ukemi runs this program for every jj command. The setting is ${key}.`,
      'Use It',
    )
  }
}
