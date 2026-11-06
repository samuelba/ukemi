import {
  downloadJj,
  managedBinaryPath,
  MIN_JJ_VERSION,
  PINNED_RELEASE,
  probeVersion,
  removeOldManagedBinaries,
  resolveJj,
  type ResolvedJj,
} from '../jj/binary'
import { errorMessage, type Logger } from '../util/logger'

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
      if (result.jj.source === 'managed') {
        void removeOldManagedBinaries(storageDir)
      }
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

// A jj that an earlier Ukemi downloaded is replaced by the pinned release without asking, since
// the user already chose to let Ukemi manage jj. Resolves to the new jj, or null when there is
// nothing to upgrade or the download failed, in which case the old jj stays in use.
export async function upgradeManagedJj(
  jj: ResolvedJj,
  storageDir: string,
  logger: Logger,
  download: (storageDir: string) => Promise<string> = downloadJj,
): Promise<ResolvedJj | null> {
  if (jj.source !== 'managed' || jj.path === managedBinaryPath(storageDir)) {
    return null
  }
  logger.info(`updating the downloaded jj ${versionText(jj.version)} to ${PINNED_RELEASE.version}`)
  try {
    const path = await download(storageDir)
    const version = await probeVersion(path)
    if (!version) {
      throw new Error(`${path} does not run`)
    }
    logger.info(`installed jj to ${path}`)
    return { path, version, source: 'managed' }
  } catch (error: unknown) {
    logger.warn(`could not update jj, keeping ${jj.path}: ${errorMessage(error)}`)
    return null
  }
}
