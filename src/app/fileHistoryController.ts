import type { DiffDocument } from '../../shared/desktopProtocol'
import type {
  FileHistoryEntry,
  FileHistoryHostMessage,
  FileHistoryWebviewMessage,
} from '../../shared/fileHistory'
import type { ChangedFile } from '../../shared/model'
import type { CommitView } from '../../shared/protocol'
import type { RepoModel } from '../repo/repoModel'
import { errorMessage } from '../util/logger'
import type { CommandEnv } from './commands/context'
import { historyFile, revealInGraph, withEntry } from './commands/fileHistoryCommands'
import { loadBlame, loadFileHistory } from './fileHistory'
import type { PanelChannel, PanelHandler } from './panel'

// Builds the diff of one file in one change, as the host shows diffs.
export type FileDiffLoader = (
  model: RepoModel,
  commit: CommitView,
  file: ChangedFile,
) => Promise<DiffDocument>

// The history tab of one file: the changes that touched it, the file's diff in the selected one,
// and who last changed each line.
export function fileHistoryController(
  env: CommandEnv,
  model: RepoModel,
  path: string,
  panel: PanelChannel<FileHistoryHostMessage>,
  fileDiff: FileDiffLoader,
): PanelHandler<FileHistoryWebviewMessage> {
  let entries: FileHistoryEntry[] = []
  let blamed: Record<string, FileHistoryEntry> = {}
  const changeIdLength = () => env.settings.read(model.root).changeIdLength
  const fail = (what: string, error: unknown) => {
    const message = errorMessage(error)
    env.logger.warn(`${what} of ${path} failed: ${message}`)
    void panel.post({ type: 'error', message })
  }
  const entryFor = (commitId: string) =>
    entries.find((entry) => entry.commitId === commitId) ?? blamed[commitId]

  const select = async (commitId: string) => {
    const entry = entryFor(commitId)
    if (!entry) {
      void panel.post({
        type: 'diffError',
        commitId,
        message: 'Refresh the history and try again.',
      })
      return
    }
    await withEntry(env, entry, async (env, model, commit) => {
      try {
        const document = await fileDiff(model, commit, await historyFile(model, commit, path))
        void panel.post({ type: 'diff', commitId, document })
      } catch (error: unknown) {
        env.logger.warn(`diff of ${path} in ${commitId} failed: ${errorMessage(error)}`)
        void panel.post({ type: 'diffError', commitId, message: errorMessage(error) })
      }
    })
  }

  return async (message) => {
    switch (message.type) {
      case 'ready':
        try {
          entries = await loadFileHistory(model, path, changeIdLength())
          void panel.post({ type: 'load', path, entries })
        } catch (error: unknown) {
          fail('history', error)
        }
        return
      case 'loadBlame': {
        await model.settled()
        const workingCopy = model.graph?.commits.find((commit) => commit.isWorkingCopy)
        if (!workingCopy) {
          void panel.post({ type: 'error', message: 'The working copy is not loaded yet.' })
          return
        }
        try {
          const blame = await loadBlame(model, path, workingCopy.commitId, changeIdLength())
          blamed = blame.changes
          void panel.post({ type: 'blame', blame })
        } catch (error: unknown) {
          fail('blame', error)
        }
        return
      }
      case 'select':
        await select(message.commitId)
        return
      case 'openFile':
        await withEntry(env, entryFor(message.commitId), (env, model, commit, entry) =>
          env.workbench.openFileAtRevision(model, commit, entry.path),
        )
        return
      case 'reveal':
        await withEntry(env, entryFor(message.commitId), revealInGraph)
        return
    }
  }
}
