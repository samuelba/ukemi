// Builds the desktop app from this checkout and installs it: `npm run desktop:install`.
//
// macOS: copies Ukemi.app to /Applications, or ~/Applications when that is not writable, and adds
// a `ukemi` command to ~/.local/bin. An app built on this Mac carries no quarantine flag, so
// Gatekeeper does not block it.
// Linux: builds the deb or rpm package for this distribution and installs it with the package
// manager, which adds the app menu entry and the `ukemi` command.
import { spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'out', 'desktop-release')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function run(command, args, env = {}) {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.error) {
    fail(`${command} did not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status}`)
  }
}

function hasCommand(name) {
  return spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0
}

// No signing identity: a local build stays unsigned, or ad-hoc signed on Apple silicon.
function electronBuilder(args) {
  run('npx', ['electron-builder', ...args, '--publish', 'never'], {
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  })
}

function isWritable(dir) {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Opens Ukemi with the folders given. `open -n` starts a second instance, which hands its
// arguments to a running one and quits. It runs from /, so relative paths become absolute.
function macLauncher(app) {
  return `#!/bin/sh
# Installed by npm run desktop:install.
for arg do
  shift
  case $arg in
    -* | /*) ;;
    *) arg="$PWD/$arg" ;;
  esac
  set -- "$@" "$arg"
done
exec open -n -a '${app}' --args "$@"
`
}

function installLauncher(app) {
  const bin = join(homedir(), '.local', 'bin')
  mkdirSync(bin, { recursive: true })
  const launcher = join(bin, 'ukemi')
  writeFileSync(launcher, macLauncher(app))
  chmodSync(launcher, 0o755)
  process.stdout.write(`Installed the ukemi command in ${launcher}\n`)
  if (!(process.env.PATH ?? '').split(delimiter).includes(bin)) {
    process.stdout.write(`${bin} is not on PATH. Add it to use the ukemi command.\n`)
  }
}

function installMac() {
  electronBuilder(['--mac', 'dir', `--${process.arch}`])
  // electron-builder names the folder mac for x64 and mac-<arch> for the others.
  const built = ['mac', `mac-${process.arch}`]
    .map((dir) => join(output, dir, 'Ukemi.app'))
    .find((app) => existsSync(app))
  if (!built) {
    fail(`electron-builder did not produce Ukemi.app in ${output}`)
  }
  const applications = isWritable('/Applications')
    ? '/Applications'
    : join(homedir(), 'Applications')
  mkdirSync(applications, { recursive: true })
  const app = join(applications, 'Ukemi.app')
  rmSync(app, { recursive: true, force: true })
  // ditto keeps the bundle's symlinks, file modes and signatures.
  run('ditto', [built, app])
  process.stdout.write(`Installed ${app}\n`)
  installLauncher(app)
}

function linuxDistribution() {
  const release = existsSync('/etc/os-release') ? readFileSync('/etc/os-release', 'utf8') : ''
  const field = (name) => release.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))?.[1] ?? ''
  return `${field('ID')} ${field('ID_LIKE')}`.split(/\s+/).filter(Boolean)
}

function builtPackage(extension) {
  const file = readdirSync(output).find(
    (name) => name.includes(version) && name.endsWith(`.${extension}`),
  )
  if (!file) {
    fail(`electron-builder did not produce a .${extension} for ${version} in ${output}`)
  }
  return join(output, file)
}

function installDeb() {
  electronBuilder(['--linux', 'deb'])
  // --reinstall also replaces an installed build of the same version.
  run('sudo', ['apt-get', 'install', '--reinstall', '-y', builtPackage('deb')])
}

function installedRpmVersion() {
  const result = spawnSync('rpm', ['-q', '--qf', '%{VERSION}', 'ukemi'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function installRpm(ids) {
  if (!hasCommand('rpmbuild')) {
    fail('Building the rpm needs rpmbuild. On Fedora: sudo dnf install rpm-build libxcrypt-compat')
  }
  electronBuilder(['--linux', 'rpm'])
  const rpm = builtPackage('rpm')
  if (ids.some((id) => id.includes('suse'))) {
    run('sudo', ['zypper', '--non-interactive', 'install', '--allow-unsigned-rpm', '--force', rpm])
    return
  }
  // dnf install skips a package whose version is already installed.
  const action = installedRpmVersion() === version ? 'reinstall' : 'install'
  run('sudo', ['dnf', action, '-y', rpm])
}

const RPM_FAMILIES = ['fedora', 'rhel', 'centos', 'suse']

function installLinux() {
  const ids = linuxDistribution()
  if (ids.some((id) => id === 'debian' || id === 'ubuntu') && hasCommand('apt-get')) {
    installDeb()
  } else if (ids.some((id) => RPM_FAMILIES.some((family) => id.includes(family)))) {
    installRpm(ids)
  } else {
    fail(
      `No installer for this distribution (${ids.join(', ') || 'unknown'}).\n` +
        'Build the AppImage instead: npm run desktop:package:appimage',
    )
  }
  process.stdout.write('Installed Ukemi. Start it from the app menu, or run: ukemi\n')
}

run('npm', ['run', 'desktop:bundle'])
if (process.platform === 'darwin') {
  installMac()
} else if (process.platform === 'linux') {
  installLinux()
} else {
  fail('desktop:install supports macOS and Linux. On Windows, run: npm run desktop:package')
}
