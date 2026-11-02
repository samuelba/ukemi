import type { Language } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'

// One colored stretch of a line, by offsets within that line.
export interface Token {
  from: number
  to: number
  cls: string
}

// The same tag groups as the editor's HighlightStyle, as classes for text outside an editor.
const highlighter = tagHighlighter([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'tok-string' },
  { tag: [tags.comment, tags.meta], class: 'tok-comment' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'tok-number' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: 'tok-function',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'tok-type' },
  { tag: [tags.propertyName, tags.attributeName], class: 'tok-property' },
  { tag: tags.heading, class: 'tok-heading' },
  { tag: tags.link, class: 'tok-link' },
  { tag: tags.invalid, class: 'tok-invalid' },
])

// Parsing a huge file would stall the view for little gain.
const MAX_HIGHLIGHT_LENGTH = 300_000

// The tokens of each line of a whole file. Parsing the whole file keeps a comment or string that
// spans lines colored on every one of them.
export function highlightLines(text: string, language: Language | null): Token[][] | null {
  if (!language || text.length > MAX_HIGHLIGHT_LENGTH) {
    return null
  }
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1)
  }
  const lines: Token[][] = starts.map(() => [])
  let line = 0
  highlightTree(language.parser.parse(text), highlighter, (from, to, cls) => {
    // Spans arrive in document order, so the line only moves forward.
    while (line + 1 < starts.length && (starts[line + 1] as number) <= from) {
      line++
    }
    let at = from
    let index = line
    while (at < to && index < starts.length) {
      const start = starts[index] as number
      const end = index + 1 < starts.length ? (starts[index + 1] as number) - 1 : text.length
      const stop = Math.min(to, end)
      if (stop > at) {
        lines[index]?.push({ from: at - start, to: stop - start, cls })
      }
      at = end + 1
      index++
    }
  })
  return lines
}
