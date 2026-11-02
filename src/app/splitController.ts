import type { SplitHostMessage, SplitRequest, SplitWebviewMessage } from '../../shared/split'
import { SplitSession } from '../split/splitSession'
import { ensureWrapper, type SplitToolPaths } from '../split/toolRun'
import { errorMessage } from '../util/logger'
import type { CommandEnv, Target } from './commands/context'
import type { PanelChannel, PanelHandler } from './panel'

// Loads the split session into the panel and applies it. Returns the panel's message handler.
export function splitController(
  env: CommandEnv,
  { model, commit }: Target,
  panel: PanelChannel<SplitHostMessage>,
  paths: SplitToolPaths,
): PanelHandler<SplitWebviewMessage> {
  let ready = false
  let request: SplitRequest | null = null
  let session: SplitSession | null = null

  const postLoad = async () => {
    if (panel.isClosed || !ready || !request) {
      return
    }
    await panel.post({ type: 'load', request })
  }

  const load = async () => {
    try {
      const files = await model.filesFor(commit.commitId)
      if (panel.isClosed) {
        return
      }
      if (files.length === 0) {
        panel.close()
        void env.ui.info('Ukemi: this change has no files to split.')
        return
      }
      session = await SplitSession.load(
        model.repo,
        { commitId: commit.commitId, parentId: commit.parents[0], description: commit.description },
        files,
      )
      if (panel.isClosed) {
        return
      }
      request = session.request
      await postLoad()
    } catch (error: unknown) {
      if (!panel.isClosed) {
        panel.close()
        void env.ui.error(`Ukemi: split failed to load: ${errorMessage(error)}`)
      }
    }
  }
  void load()

  return async (message) => {
    switch (message.type) {
      case 'ready':
        ready = true
        await postLoad()
        return
      case 'cancel':
        panel.close()
        return
      case 'apply': {
        const loaded = session
        if (!loaded) {
          return
        }
        const tool = await ensureWrapper(paths)
        panel.close()
        await env.operations.run('Split', model, () =>
          loaded.apply(model.repo, tool, message.message, message.selections),
        )
        return
      }
    }
  }
}
