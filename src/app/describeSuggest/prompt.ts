// What a suggester gets to see of a change.
export interface DescribeContext {
  description: string
  stat: string
  diff: string
  ancestorDescriptions: readonly string[]
  instructions: string
}

// Lock files and generated output say little about the intent of a change but fill the budget.
const NOISE_PATH =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.min\.(js|css)$|\.map$|(^|\/)(dist|out|build|vendor|node_modules)\//

// Files that often hold credentials. Their content is never sent, whatever the budget.
const SECRET_PATH = new RegExp(
  [
    String.raw`(^|/)(\.env([._-].*|rc)?|[^/]*\.env)$`,
    String.raw`(^|/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$`,
    String.raw`\.(pem|key|p8|p12|pfx|ppk|keystore|jks|kdbx|tfvars|tfstate)$`,
    String.raw`(^|/)(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|\.htpasswd|\.dockercfg|kubeconfig)$`,
    String.raw`(^|/)(\.aws/credentials|\.docker/config\.json)$`,
  ].join('|'),
  'i',
)

const FILE_HEADER = /^diff --git a\/(.*?) b\/(.*)$/

// jj does not quote paths, so these lines name a file unambiguously where the header may not.
const PATH_LINE = /^(rename from |copy from |--- a\/|rename to |copy to |\+\+\+ b\/)(.+)$/gm

interface FilePatch {
  path: string
  sourcePath: string
  text: string
}

export function splitPatch(diff: string): FilePatch[] {
  const files: FilePatch[] = []
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const header = FILE_HEADER.exec(part.split('\n', 1)[0] ?? '')
    if (!header) {
      continue
    }
    const lines = pathLines(part)
    const source = lines.find((line) => /^(rename from|copy from|---)/.test(line.kind))
    const target = lines.find((line) => /^(rename to|copy to|\+\+\+)/.test(line.kind))
    files.push({
      path: target?.path ?? header[2] ?? '',
      sourcePath: source?.path ?? header[1] ?? '',
      text: part,
    })
  }
  return files
}

function pathLines(part: string): { kind: string; path: string }[] {
  return [...part.matchAll(PATH_LINE)].map((match) => ({
    kind: match[1] ?? '',
    path: match[2] ?? '',
  }))
}

// Every name the patch could be about: each way to split its header, and its path lines. A file
// is withheld when any of them looks like a secret file.
function candidatePaths(file: FilePatch): string[] {
  const header = (file.text.split('\n', 1)[0] ?? '').slice('diff --git a/'.length)
  const splits = [...header.matchAll(/ b\//g)].flatMap((match) => [
    header.slice(0, match.index),
    header.slice(match.index + ' b/'.length),
  ])
  return [file.path, file.sourcePath, ...splits, ...pathLines(file.text).map((line) => line.path)]
}

function isSecret(file: FilePatch): boolean {
  return candidatePaths(file).some((path) => SECRET_PATH.test(path))
}

function isNoise(file: FilePatch): boolean {
  return NOISE_PATH.test(file.path) || /^Binary files .* differ$/m.test(file.text)
}

// Keeps the patch under `maxBytes`. Secret and noisy files go first, then files are cut where
// the budget runs out, with notes so the model knows it sees only part of the change.
export function limitDiff(diff: string, maxBytes: number): string {
  const all = splitPatch(diff)
  const withheld = all.filter(isSecret).map((file) => file.path)
  const files = all.filter((file) => !isSecret(file))
  const omitted = files.filter(isNoise).map((file) => file.path)
  let budget = maxBytes
  const kept: string[] = []
  for (const file of files.filter((f) => !isNoise(f))) {
    const size = Buffer.byteLength(file.text)
    if (size <= budget) {
      kept.push(file.text)
      budget -= size
    } else if (budget > 0) {
      kept.push(`${truncateBytes(file.text, budget)}\n[… rest of ${file.path} truncated]\n`)
      budget = 0
    } else {
      omitted.push(file.path)
    }
  }
  const notes = [
    withheld.length > 0 ? `[Diff withheld, may hold secrets: ${withheld.join(', ')}]` : '',
    omitted.length > 0 ? `[Diff omitted for: ${omitted.join(', ')}]` : '',
  ].filter(Boolean)
  return kept.join('') + notes.map((note) => `\n${note}\n`).join('')
}

function truncateBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) {
    return text
  }
  // Dropping a partial character at the cut keeps the result valid UTF-8.
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/, '')
}

export function buildPrompt(context: DescribeContext): string {
  const sections = [
    'Write the description of a commit in a jj (Jujutsu) repository, based on its diff below.',
    'Rules:',
    '- Reply with the commit description only: no preamble, no explanation, no code fences.',
    '- First line: a summary of at most 72 characters, in the imperative mood.',
    '- Add a blank line and a short body only when the change needs explaining. Explain why, not how.',
    '- Follow the style of the recent descriptions below, such as a type or scope prefix.',
  ]
  if (context.instructions.trim()) {
    sections.push('', 'Additional instructions:', context.instructions.trim())
  }
  if (context.ancestorDescriptions.length > 0) {
    sections.push(
      '',
      'Recent descriptions in this repository, newest first:',
      ...context.ancestorDescriptions.map((d) => `---\n${d}`),
      '---',
    )
  }
  if (context.description.trim()) {
    sections.push(
      '',
      'The current description of this commit. Improve it, keeping what is still accurate:',
      context.description.trim(),
    )
  }
  sections.push('', 'Files changed:', context.stat.trim(), '', 'Diff:', context.diff)
  return sections.join('\n')
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// Models wrap the answer in a code fence now and then despite being asked not to.
export function cleanSuggestion(output: string): string {
  let text = output.replace(ANSI, '').replace(/\r\n/g, '\n').trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced) {
    text = (fenced[1] ?? '').trim()
  }
  return text
}
