import type { SecretStore } from '../forge/secretStore'
import type { Disposable, Event } from './events'
import type { Settings } from './settings'
import type { Ui } from './ui'

export interface WindowState {
  readonly isFocused: boolean
  readonly onDidFocus: Event<void>
  // Untrusted repositories never get stored forge credentials.
  readonly isTrusted: boolean
  readonly onDidGrantTrust: Event<void>
}

export interface Folder {
  name: string
  path: string
}

export interface FolderSource {
  // The folders open in this window. Repositories are discovered inside them.
  folders(): Folder[]
  readonly onDidChangeFolders: Event<void>
  // The file the user is looking at, so the graph can follow it.
  activeFile(): string | undefined
  readonly onDidChangeActiveFile: Event<string | undefined>
}

export interface RepoWatchHandlers {
  // A working-copy file changed. Paths inside `.jj` and `.git` are already filtered out.
  onFile(): void
  // A new jj operation was written.
  onOperation(): void
}

export type WatchRepo = (root: string, handlers: RepoWatchHandlers) => Disposable

// Reports that something in `folder` changed which might be a repository appearing or going away.
export type WatchFolder = (folder: string, onChange: () => void) => Disposable

export interface KeyValueStore {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): PromiseLike<void>
}

// Everything the app services need from the host, besides the jj runner and logger.
export interface Host {
  readonly ui: Ui
  readonly settings: Settings
  readonly window: WindowState
  readonly folders: FolderSource
  readonly watchRepo: WatchRepo
  readonly watchFolder: WatchFolder
  readonly store: KeyValueStore
  readonly secrets: SecretStore
}
