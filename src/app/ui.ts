// Returns the problem with the value, or nothing when it is valid.
export type Validate = (value: string) => string | null | undefined

export interface MessageOptions {
  detail?: string
}

export interface InputOptions {
  title?: string
  prompt?: string
  value?: string
  placeholder?: string
  password?: boolean
  validate?: Validate
}

// A label may start with a `$(codicon)` icon. Each host renders it in its own way.
export interface PickItem {
  label: string
  description?: string
  detail?: string
}

export interface PickOptions {
  title?: string
  placeholder?: string
  matchOnDescription?: boolean
  matchOnDetail?: boolean
}

export interface TypedPickOptions extends PickOptions {
  // Keeps the pick open and shows the problem until the chosen or typed value is valid.
  validate?: Validate
}

// A pick that also accepts free text. `update` replaces the items while the pick is open.
export interface OpenPick<T extends PickItem> {
  readonly choice: Promise<T | string | undefined>
  update(items: readonly T[]): void
}

// The prompts and notifications the app needs. Each host shows them in its own way.
export interface Ui {
  info(text: string, ...actions: string[]): Promise<string | undefined>
  warn(text: string, ...actions: string[]): Promise<string | undefined>
  error(text: string, ...actions: string[]): Promise<string | undefined>
  // A modal question. Resolves to the chosen action, or undefined when dismissed.
  ask(
    level: 'info' | 'warning',
    text: string,
    options: MessageOptions,
    ...actions: string[]
  ): Promise<string | undefined>
  input(options: InputOptions): Promise<string | undefined>
  pick<T extends PickItem>(items: readonly T[], options?: PickOptions): Promise<T | undefined>
  pickMany<T extends PickItem>(items: readonly T[], options?: PickOptions): Promise<T[] | undefined>
  pickOrType<T extends PickItem>(items: readonly T[], options?: TypedPickOptions): OpenPick<T>
  pickFolder(openLabel: string): Promise<string | undefined>
  progress<T>(title: string, task: () => Promise<T>): Promise<T>
  openExternal(url: string): Promise<boolean>
  copy(text: string): Promise<void>
}

export async function confirm(
  ui: Ui,
  message: string,
  action: string,
  detail?: string,
): Promise<boolean> {
  return (await ui.ask('warning', message, { detail }, action)) === action
}

// Picks a string with `pick`, for callers that only need the label.
export async function pickLabel(
  ui: Ui,
  labels: readonly string[],
  options?: PickOptions,
): Promise<string | undefined> {
  return (
    await ui.pick(
      labels.map((label) => ({ label })),
      options,
    )
  )?.label
}
