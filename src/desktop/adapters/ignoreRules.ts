import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { repositoryStore } from '../../repo/workspaceFolder'

export type ReadText = (path: string) => Promise<string | null>

const readTextOrNull: ReadText = async (path) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

// The git repo behind jj's git backend: .git when colocated, .jj/repo/store/git otherwise.
async function gitDir(root: string, read: ReadText): Promise<string | null> {
  const store = join(repositoryStore(root), 'store')
  const target = (await read(join(store, 'git_target')))?.trim()
  return target ? resolve(store, target) : null
}

const INTERNAL = new Set(['.jj', '.git'])

// Paths in a .jj or .git folder at any depth, which jj never snapshots (nested repos and
// submodules included). Only those exact names: .gitignore and .github are the user's files.
export function isInternal(rel: string): boolean {
  return rel.split('/').some((part) => INTERNAL.has(part))
}

export function joinRel(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`
}

export function isRulesFile(rel: string): boolean {
  return rel === '.gitignore' || rel.endsWith('/.gitignore')
}

export function parentRel(rel: string): string {
  const slash = rel.lastIndexOf('/')
  return slash < 0 ? '' : rel.slice(0, slash)
}

// The ignore rules jj applies when it snapshots: every .gitignore in the tree, and the backing
// git repo's info/exclude. Paths are relative to the workspace root, with '/' separators. The
// global core.excludesFile is left out, so a file only it ignores still counts as a change; that
// costs an extra refresh, never a missed one.
export class IgnoreRules {
  private readonly cache = new Map<string, Promise<Ignore | null>>()

  constructor(
    private readonly root: string,
    private readonly read: ReadText = readTextOrNull,
  ) {}

  // Whether jj ignores the path, either itself or through one of its parent folders.
  async isIgnored(rel: string, isDirectory: boolean): Promise<boolean> {
    const parts = rel.split('/').filter((part) => part !== '')
    for (let length = 1; length <= parts.length; length++) {
      const folder = length < parts.length || isDirectory
      if (await this.matches(parts.slice(0, length), folder)) {
        return true
      }
    }
    return false
  }

  // Drops the cached rules of a folder whose .gitignore changed.
  invalidate(folderRel: string): void {
    this.cache.delete(folderRel)
  }

  // A deeper .gitignore overrides a shallower one, and a later rule overrides an earlier one.
  private async matches(parts: string[], isDirectory: boolean): Promise<boolean> {
    let ignored = false
    for (let depth = 0; depth < parts.length; depth++) {
      const rules = await this.rulesFor(parts.slice(0, depth).join('/'))
      if (!rules) {
        continue
      }
      const result = rules.test(parts.slice(depth).join('/') + (isDirectory ? '/' : ''))
      if (result.ignored) {
        ignored = true
      } else if (result.unignored) {
        ignored = false
      }
    }
    return ignored
  }

  private rulesFor(folderRel: string): Promise<Ignore | null> {
    let rules = this.cache.get(folderRel)
    if (!rules) {
      rules = this.load(folderRel)
      this.cache.set(folderRel, rules)
    }
    return rules
  }

  private async load(folderRel: string): Promise<Ignore | null> {
    const texts: string[] = []
    if (folderRel === '') {
      const git = await gitDir(this.root, this.read)
      const exclude = git ? await this.read(join(git, 'info', 'exclude')) : null
      if (exclude) {
        texts.push(exclude)
      }
    }
    const own = await this.read(join(this.root, folderRel, '.gitignore'))
    if (own) {
      texts.push(own)
    }
    // One string, not an array: `add` takes each array item as a single pattern.
    return texts.length > 0 ? ignore().add(texts.join('\n')) : null
  }
}
