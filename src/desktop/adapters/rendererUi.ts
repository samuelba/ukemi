import type {
  DesktopHostMessage,
  MessageLevel,
  UiAnswer,
  UiPickItem,
  UiRequest,
} from '../../../shared/desktopProtocol'
import type { OpenPick, PickItem, Ui, Validate } from '../../app/ui'

// What the main process does natively instead of in the window.
export interface NativeUi {
  ask(
    level: 'info' | 'warning',
    text: string,
    detail: string | undefined,
    actions: string[],
  ): Promise<string | undefined>
  pickFolder(openLabel: string): Promise<string | undefined>
  openExternal(url: string): Promise<boolean>
  copy(text: string): void
}

interface Pending {
  resolve: (answer: UiAnswer) => void
  validate?: (answer: UiAnswer) => string | null | undefined
}

const SAFE_EXTERNAL = /^(https?|mailto):/i

function pickItems(items: readonly PickItem[]): UiPickItem[] {
  return items.map(({ label, description, detail }) => ({ label, description, detail }))
}

// The prompts of the app, shown by the window's shell. Main sends a request, the shell answers.
export class RendererUi implements Ui {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly send: (message: DesktopHostMessage) => void,
    private readonly native: NativeUi,
  ) {}

  info(text: string, ...actions: string[]): Promise<string | undefined> {
    return this.message('info', text, actions)
  }

  warn(text: string, ...actions: string[]): Promise<string | undefined> {
    return this.message('warning', text, actions)
  }

  error(text: string, ...actions: string[]): Promise<string | undefined> {
    return this.message('error', text, actions)
  }

  ask(
    level: 'info' | 'warning',
    text: string,
    options: { detail?: string },
    ...actions: string[]
  ): Promise<string | undefined> {
    return this.native.ask(level, text, options.detail, actions)
  }

  async input(options: Parameters<Ui['input']>[0]): Promise<string | undefined> {
    const { validate, ...shown } = options
    const answer = await this.request({ kind: 'input', ...shown }, (a) =>
      a.kind === 'text' ? validate?.(a.value) : undefined,
    )
    return answer.kind === 'text' ? answer.value : undefined
  }

  async pick<T extends PickItem>(
    items: readonly T[],
    options: Parameters<Ui['pick']>[1] = {},
  ): Promise<T | undefined> {
    const answer = await this.request({
      kind: 'pick',
      items: pickItems(items),
      ...options,
      many: false,
      typed: false,
    })
    return answer.kind === 'item' ? items[answer.index] : undefined
  }

  async pickMany<T extends PickItem>(
    items: readonly T[],
    options: Parameters<Ui['pickMany']>[1] = {},
  ): Promise<T[] | undefined> {
    const answer = await this.request({
      kind: 'pick',
      items: pickItems(items),
      ...options,
      many: true,
      typed: false,
    })
    if (answer.kind !== 'items') {
      return undefined
    }
    return answer.indexes.flatMap((index) => {
      const item = items[index]
      return item ? [item] : []
    })
  }

  pickOrType<T extends PickItem>(
    initial: readonly T[],
    options: Parameters<Ui['pickOrType']>[1] = {},
  ): OpenPick<T> {
    let items = initial
    const { validate, ...shown } = options
    const labelOf = (answer: UiAnswer): string | undefined =>
      answer.kind === 'text'
        ? answer.value.trim()
        : answer.kind === 'item'
          ? items[answer.index]?.label
          : undefined
    const { id, answer } = this.start(
      { kind: 'pick', items: pickItems(items), ...shown, many: false, typed: true },
      validate ? (a) => checkLabel(validate, labelOf(a)) : undefined,
    )
    const choice = answer.then((a): T | string | undefined => {
      if (a.kind === 'item') {
        return items[a.index]
      }
      return a.kind === 'text' ? a.value.trim() || undefined : undefined
    })
    return {
      choice,
      update: (next) => {
        if (this.pending.has(id)) {
          items = next
          this.send({ type: 'desktop.uiUpdate', id, items: pickItems(next) })
        }
      },
    }
  }

  pickFolder(openLabel: string): Promise<string | undefined> {
    return this.native.pickFolder(openLabel)
  }

  async progress<T>(title: string, task: () => Promise<T>): Promise<T> {
    const { id } = this.start({ kind: 'progress', title })
    try {
      return await task()
    } finally {
      this.finish(id, { kind: 'cancel' })
    }
  }

  async openExternal(url: string): Promise<boolean> {
    return SAFE_EXTERNAL.test(url) ? this.native.openExternal(url) : false
  }

  async copy(text: string): Promise<void> {
    this.native.copy(text)
  }

  // Handles the shell's answer. An invalid value keeps the prompt open with the problem shown.
  answer(id: number, answer: UiAnswer): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    const problem = answer.kind === 'cancel' ? undefined : pending.validate?.(answer)
    if (problem) {
      this.send({ type: 'desktop.uiInvalid', id, problem })
      return
    }
    this.finish(id, answer)
  }

  // Dismisses everything still open, as when the window closes.
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.finish(id, { kind: 'cancel' })
    }
  }

  private async message(level: MessageLevel, text: string, actions: string[]) {
    const answer = await this.request({ kind: 'message', level, text, modal: false, actions })
    return answer.kind === 'action' ? answer.action : undefined
  }

  private request(request: UiRequest, validate?: Pending['validate']): Promise<UiAnswer> {
    return this.start(request, validate).answer
  }

  private start(
    request: UiRequest,
    validate?: Pending['validate'],
  ): { id: number; answer: Promise<UiAnswer> } {
    const id = this.nextId++
    const answer = new Promise<UiAnswer>((resolve) => {
      this.pending.set(id, { resolve, validate })
    })
    this.send({ type: 'desktop.ui', id, request })
    return { id, answer }
  }

  private finish(id: number, answer: UiAnswer): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    this.send({ type: 'desktop.uiClose', id })
    pending.resolve(answer)
  }
}

function checkLabel(validate: Validate, label: string | undefined): string | null | undefined {
  return validate(label ?? '')
}
