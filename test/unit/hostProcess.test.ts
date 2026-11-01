import { describe, expect, test } from 'vitest'
import { ghConfigFile } from '../../src/forge/ghConfig'
import { glabConfigFile } from '../../src/forge/glabConfig'
import { flatpakAppId, hostConfigEnv, hostSpawn, sharedTempDir } from '../../src/util/hostProcess'
import { nodeWrapperScript } from '../../src/util/nodeWrapper'

const plain = { PATH: '/usr/bin', HOME: '/home/u' }
const flatpak = {
  ...plain,
  PATH: '/app/bin:/usr/bin',
  FLATPAK_ID: 'dev.samuelba.ukemi',
  XDG_CACHE_HOME: '/home/u/.var/app/dev.samuelba.ukemi/cache',
}

describe('hostSpawn', () => {
  test('runs the program directly outside a sandbox, with the extra variables', () => {
    const spawned = hostSpawn('jj', ['log'], { cwd: '/repo', env: { A: '1' } }, plain)
    expect(spawned).toEqual({ command: 'jj', args: ['log'], env: { ...plain, A: '1' } })
  })

  test('runs the program on the host from a Flatpak, passing only its own variables', () => {
    const spawned = hostSpawn('jj', ['log', '-r', '@'], { cwd: '/repo', env: { A: '1' } }, flatpak)
    expect(spawned.command).toBe('flatpak-spawn')
    expect(spawned.args).toEqual([
      '--host',
      '--watch-bus',
      '--directory=/repo',
      '--env=TMPDIR=/home/u/.var/app/dev.samuelba.ukemi/cache/tmp',
      '--env=A=1',
      'jj',
      'log',
      '-r',
      '@',
    ])
    // The host keeps its own PATH: the sandbox's PATH names folders that only exist inside it.
    expect(spawned.args.join(' ')).not.toContain('PATH=')
    expect(spawned.env).toEqual(flatpak)
  })
})

describe('sharedTempDir', () => {
  test('is the system temp folder outside a sandbox', () => {
    expect(flatpakAppId(plain)).toBeNull()
    expect(sharedTempDir(plain)).not.toContain('.var')
  })

  test('is in the app cache, which the host sees at the same path, inside a Flatpak', () => {
    expect(flatpakAppId(flatpak)).toBe('dev.samuelba.ukemi')
    expect(sharedTempDir(flatpak)).toBe('/home/u/.var/app/dev.samuelba.ukemi/cache/tmp')
  })
})

describe('nodeWrapperScript', () => {
  test('runs the helper with the app as Node', () => {
    expect(nodeWrapperScript('/opt/ukemi', ['/opt/askpass.js'], 'UKEMI_ASKPASS')).toBe(
      "#!/bin/sh\nELECTRON_RUN_AS_NODE=1 UKEMI_ASKPASS=1 exec '/opt/ukemi' '/opt/askpass.js' \"$@\"\n",
    )
  })

  test('re-enters the sandbox from the host and forwards the variables the helper reads', () => {
    const script = nodeWrapperScript('/app/ukemi', ['/app/askpass.js'], 'UKEMI_ASKPASS', {
      appId: 'dev.samuelba.ukemi',
      forwardEnv: ['UKEMI_ASKPASS_SOCKET'],
    })
    expect(script).toBe(
      "#!/bin/sh\nexec flatpak run --command='/app/ukemi' --env=ELECTRON_RUN_AS_NODE=1 --env=UKEMI_ASKPASS=1 " +
        '--env=UKEMI_ASKPASS_SOCKET="${UKEMI_ASKPASS_SOCKET:-}" ' +
        "'dev.samuelba.ukemi' '/app/askpass.js' \"$@\"\n",
    )
  })
})

describe('hostConfigEnv', () => {
  test('keeps the environment outside a sandbox', () => {
    const env = { ...plain, XDG_CONFIG_HOME: '/home/u/.cfg' }
    expect(hostConfigEnv(env)).toEqual(env)
  })

  test("uses the host's config folder inside a Flatpak, not the app's own", () => {
    const sandboxed = { ...flatpak, XDG_CONFIG_HOME: '/home/u/.var/app/dev.samuelba.ukemi/config' }
    expect(hostConfigEnv(sandboxed).XDG_CONFIG_HOME).toBeUndefined()
    expect(
      hostConfigEnv({ ...sandboxed, HOST_XDG_CONFIG_HOME: '/home/u/.cfg' }).XDG_CONFIG_HOME,
    ).toBe('/home/u/.cfg')
  })

  test('finds the gh and glab logins of the host from a Flatpak', () => {
    const sandboxed = { ...flatpak, XDG_CONFIG_HOME: '/home/u/.var/app/dev.samuelba.ukemi/config' }
    expect(ghConfigFile(hostConfigEnv(sandboxed), '/home/u', 'linux')).toBe(
      '/home/u/.config/gh/hosts.yml',
    )
    expect(glabConfigFile(hostConfigEnv(sandboxed), '/home/u')).toBe(
      '/home/u/.config/glab-cli/config.yml',
    )
  })
})
