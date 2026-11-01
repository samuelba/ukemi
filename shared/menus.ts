// Reads the menus that package.json contributes to VS Code, so other hosts show the same items.

export type MenuContext = Readonly<Record<string, unknown>>

export interface CommandContribution {
  command: string
  title: string
  category?: string
  // A codicon like `$(trash)`, or light and dark image paths.
  icon?: unknown
}

export interface MenuContribution {
  command?: string
  submenu?: string
  group?: string
  when?: string
}

export interface SubmenuContribution {
  id: string
  label: string
}

export interface MenuManifest {
  commands: CommandContribution[]
  menus: Record<string, MenuContribution[]>
  submenus?: SubmenuContribution[]
}

export type MenuEntry =
  | { kind: 'command'; command: string; title: string }
  | { kind: 'submenu'; label: string; items: MenuEntry[] }
  | { kind: 'separator' }

type Value = string | boolean | RegExp

type Expr =
  | { kind: 'literal'; value: boolean }
  | { kind: 'key'; key: string }
  | { kind: 'not'; expr: Expr }
  | { kind: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'compare'; key: string; op: '==' | '!=' | '=~'; value: Value }

type Token =
  | { kind: 'op'; text: '!' | '&&' | '||' | '==' | '!=' | '=~' | '(' | ')' }
  | { kind: 'word'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'regex'; source: string; flags: string }

const OPERATORS = ['&&', '||', '==', '!=', '=~', '!', '(', ')'] as const

function readRegex(input: string, start: number): { token: Token; end: number } {
  let i = start + 1
  let source = ''
  while (i < input.length && input[i] !== '/') {
    if (input[i] === '\\' && i + 1 < input.length) {
      source += input.slice(i, i + 2)
      i += 2
      continue
    }
    source += input[i]
    i += 1
  }
  if (i >= input.length) {
    throw new Error(`unterminated regex in: ${input}`)
  }
  i += 1
  let flags = ''
  while (i < input.length && /[a-z]/.test(input[i] ?? '')) {
    flags += input[i]
    i += 1
  }
  return { token: { kind: 'regex', source, flags }, end: i }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i] ?? ''
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    const previous = tokens.at(-1)
    if (char === '/' && previous?.kind === 'op' && previous.text === '=~') {
      const { token, end } = readRegex(input, i)
      tokens.push(token)
      i = end
      continue
    }
    const operator = OPERATORS.find((op) => input.startsWith(op, i))
    if (operator) {
      tokens.push({ kind: 'op', text: operator })
      i += operator.length
      continue
    }
    if (char === "'" || char === '"') {
      const end = input.indexOf(char, i + 1)
      if (end < 0) {
        throw new Error(`unterminated string in: ${input}`)
      }
      tokens.push({ kind: 'string', text: input.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const word = /^[^\s!&|=()'"]+/.exec(input.slice(i))?.[0]
    if (!word) {
      throw new Error(`unexpected "${char}" in: ${input}`)
    }
    tokens.push({ kind: 'word', text: word })
    i += word.length
  }
  return tokens
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): Expr {
    const expr = this.or()
    if (this.index < this.tokens.length) {
      throw new Error(`unexpected input in: ${this.source}`)
    }
    return expr
  }

  private peekOp(text: string): boolean {
    const token = this.tokens[this.index]
    return token?.kind === 'op' && token.text === text
  }

  private or(): Expr {
    let left = this.and()
    while (this.peekOp('||')) {
      this.index += 1
      left = { kind: 'or', left, right: this.and() }
    }
    return left
  }

  private and(): Expr {
    let left = this.unary()
    while (this.peekOp('&&')) {
      this.index += 1
      left = { kind: 'and', left, right: this.unary() }
    }
    return left
  }

  private unary(): Expr {
    if (this.peekOp('!')) {
      this.index += 1
      return { kind: 'not', expr: this.unary() }
    }
    if (this.peekOp('(')) {
      this.index += 1
      const inner = this.or()
      if (!this.peekOp(')')) {
        throw new Error(`missing ")" in: ${this.source}`)
      }
      this.index += 1
      return inner
    }
    return this.comparison()
  }

  private comparison(): Expr {
    const token = this.tokens[this.index]
    if (token?.kind !== 'word') {
      throw new Error(`expected a key in: ${this.source}`)
    }
    this.index += 1
    const op = this.tokens[this.index]
    if (op?.kind === 'op' && (op.text === '==' || op.text === '!=' || op.text === '=~')) {
      this.index += 1
      return { kind: 'compare', key: token.text, op: op.text, value: this.value() }
    }
    if (token.text === 'true' || token.text === 'false') {
      return { kind: 'literal', value: token.text === 'true' }
    }
    return { kind: 'key', key: token.text }
  }

  private value(): Value {
    const token = this.tokens[this.index]
    this.index += 1
    switch (token?.kind) {
      case 'string':
        return token.text
      case 'regex':
        return new RegExp(token.source, token.flags)
      case 'word':
        return token.text === 'true' ? true : token.text === 'false' ? false : token.text
      default:
        throw new Error(`expected a value in: ${this.source}`)
    }
  }
}

const parsed = new Map<string, Expr>()

export function parseWhen(when: string): Expr {
  const cached = parsed.get(when)
  if (cached) {
    return cached
  }
  const expr = new Parser(tokenize(when), when).parse()
  parsed.set(when, expr)
  return expr
}

function equals(actual: unknown, expected: Value): boolean {
  if (typeof expected === 'boolean') {
    return actual === expected
  }
  return String(actual ?? '') === String(expected)
}

function evaluate(expr: Expr, context: MenuContext): boolean {
  switch (expr.kind) {
    case 'literal':
      return expr.value
    case 'key':
      return Boolean(context[expr.key])
    case 'not':
      return !evaluate(expr.expr, context)
    case 'and':
      return evaluate(expr.left, context) && evaluate(expr.right, context)
    case 'or':
      return evaluate(expr.left, context) || evaluate(expr.right, context)
    case 'compare': {
      const actual = context[expr.key]
      if (expr.op === '=~') {
        return expr.value instanceof RegExp && expr.value.test(String(actual ?? ''))
      }
      if (expr.value instanceof RegExp) {
        return false
      }
      const same = equals(actual, expr.value)
      return expr.op === '==' ? same : !same
    }
  }
}

// Evaluates a VS Code `when` clause. A missing clause always holds.
export function evaluateWhen(when: string | undefined, context: MenuContext): boolean {
  return when === undefined || when.trim() === '' || evaluate(parseWhen(when), context)
}

interface Placed {
  group: string
  order: number
  label: string
  entry: MenuEntry
}

function placement(group: string | undefined): { group: string; order: number } {
  const [name = '', order] = (group ?? '').split('@')
  return { group: name, order: order === undefined ? Number.MAX_SAFE_INTEGER : Number(order) }
}

// `navigation` comes first, then the other groups by name, as VS Code sorts them.
function compareGroups(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  if (left === 'navigation') {
    return -1
  }
  if (right === 'navigation') {
    return 1
  }
  return left.localeCompare(right)
}

// Resolves a contributed menu to the entries that apply, with separators between groups.
// `offers` drops commands the host does not register.
export function resolveMenu(
  manifest: MenuManifest,
  menuId: string,
  context: MenuContext,
  offers: (command: string) => boolean = () => true,
): MenuEntry[] {
  const titles = new Map(manifest.commands.map((c) => [c.command, c.title]))
  const labels = new Map((manifest.submenus ?? []).map((s) => [s.id, s.label]))
  const placed: Placed[] = []
  for (const item of manifest.menus[menuId] ?? []) {
    // VS Code shows the inline group as buttons on the item, not in its menu.
    if (isInline(item) || !evaluateWhen(item.when, context)) {
      continue
    }
    const { group, order } = placement(item.group)
    if (item.command && offers(item.command)) {
      const title = titles.get(item.command) ?? item.command
      placed.push({
        group,
        order,
        label: title,
        entry: { kind: 'command', command: item.command, title },
      })
    } else if (item.submenu) {
      const items = resolveMenu(manifest, item.submenu, context, offers)
      const label = labels.get(item.submenu) ?? item.submenu
      if (items.length > 0) {
        placed.push({ group, order, label, entry: { kind: 'submenu', label, items } })
      }
    }
  }
  placed.sort(
    (a, b) =>
      compareGroups(a.group, b.group) || a.order - b.order || a.label.localeCompare(b.label),
  )
  const entries: MenuEntry[] = []
  placed.forEach((item, index) => {
    if (index > 0 && placed[index - 1]?.group !== item.group) {
      entries.push({ kind: 'separator' })
    }
    entries.push(item.entry)
  })
  return entries
}

export interface InlineAction {
  command: string
  title: string
  // The codicon name, like `trash`. Null when the command has no codicon.
  icon: string | null
}

function isInline(item: MenuContribution): boolean {
  return placement(item.group).group === 'inline'
}

function codicon(icon: unknown): string | null {
  return typeof icon === 'string' ? (/^\$\(([\w-]+)\)$/.exec(icon)?.[1] ?? null) : null
}

// The buttons VS Code shows on a tree item or a title bar: the `inline` group of a menu.
export function inlineActions(
  manifest: MenuManifest,
  menuId: string,
  context: MenuContext,
  offers: (command: string) => boolean = () => true,
): InlineAction[] {
  const commands = new Map(manifest.commands.map((c) => [c.command, c]))
  return (manifest.menus[menuId] ?? [])
    .filter((item) => isInline(item) && item.command && offers(item.command))
    .filter((item) => evaluateWhen(item.when, context))
    .map((item) => ({ item, order: placement(item.group).order }))
    .sort((a, b) => a.order - b.order)
    .flatMap(({ item }) => {
      const command = commands.get(item.command ?? '')
      return command
        ? [{ command: command.command, title: command.title, icon: codicon(command.icon) }]
        : []
    })
}

// Merges the `data-vscode-context` of an element and its ancestors. The closest value wins.
export function mergeContexts(closestFirst: readonly string[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const raw of [...closestFirst].reverse()) {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value === 'object' && value !== null) {
        Object.assign(merged, value)
      }
    } catch {
      // A malformed context adds nothing, as in VS Code.
    }
  }
  return merged
}
