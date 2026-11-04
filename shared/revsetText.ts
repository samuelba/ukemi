// A jj string literal, for templates and revsets.
export function jjString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

// jj reads `ok|main`, `rel-` or `a,b` as expressions, not as names. Git allows such branch names,
// so a fetch can bring them in. Plain names stay bare, so pickers and labels look as jj shows them.
const PLAIN_SYMBOL = /^[\p{L}\p{N}_/]+(?:[.+-][\p{L}\p{N}_/]+)*$/u

export function revsetSymbol(name: string): string {
  return PLAIN_SYMBOL.test(name) ? name : jjString(name)
}
