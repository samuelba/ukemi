// A .gitignore line that matches exactly one repo-relative path. The leading `/` anchors it to the
// file's directory, so `#` and `!` cannot start it, and glob characters and trailing spaces are
// escaped so they match literally.
export function ignoreLine(path: string): string {
  const escaped = path
    .replace(/[\\*?[\]]/g, (char) => `\\${char}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))
  return `/${escaped}`
}

// Returns the .gitignore content with a line for `path` added at the end, or unchanged when the
// same line is already there.
export function appendIgnoreLine(content: string, path: string): string {
  const line = ignoreLine(path)
  if (content.split(/\r?\n/).some((existing) => existing.trimEnd() === line)) {
    return content
  }
  const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n'
  return `${content}${separator}${line}\n`
}
