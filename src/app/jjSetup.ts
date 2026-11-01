import { MIN_JJ_VERSION, resolveJj, type ResolvedJj } from '../jj/binary'
import type { Logger } from '../util/logger'

export const versionText = (v: { major: number; minor: number; patch: number }) =>
  `${v.major}.${v.minor}.${v.patch}`

// Finds a jj new enough for Ukemi: the configured path, then PATH, then the one Ukemi downloaded.
export async function locateJj(
  configuredPath: string,
  storageDir: string,
  logger: Logger,
): Promise<ResolvedJj | null> {
  const result = await resolveJj({ configuredPath, storageDir })
  switch (result.kind) {
    case 'found':
      logger.info(
        `using jj ${versionText(result.jj.version)} from ${result.jj.path} (${result.jj.source})`,
      )
      return result.jj
    case 'too-old':
      logger.warn(
        `jj ${versionText(result.version)} at ${result.path} is older than ${versionText(MIN_JJ_VERSION)}`,
      )
      return null
    case 'missing':
      if (result.configuredPathInvalid) {
        logger.warn('the configured ukemi.jjPath does not point to a working jj')
      }
      return null
  }
}
