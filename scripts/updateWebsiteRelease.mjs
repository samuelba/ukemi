// Writes the desktop download links of a GitHub release to the website's data file.
// Usage: node scripts/updateWebsiteRelease.mjs --tag v1.2.3 --out path/to/ukemi-release.json
// GH_TOKEN or GITHUB_TOKEN is used when set; the release is public, so it is optional.
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    out: { type: 'string' },
    repo: { type: 'string', default: 'samuelba/ukemi' },
  },
})
if (!values.tag || !values.out) {
  process.stderr.write(
    'usage: updateWebsiteRelease.mjs --tag <tag> --out <file> [--repo owner/name]\n',
  )
  process.exit(2)
}

// Asset names differ per format, so each key matches by suffix.
const patterns = {
  exe: /\.exe$/i,
  dmgArm64: /-arm64\.dmg$/i,
  dmgX64: /-x64\.dmg$/i,
  appimage: /\.AppImage$/i,
  deb: /\.deb$/i,
  rpm: /\.rpm$/i,
  snap: /\.snap$/i,
  flatpak: /\.flatpak$/i,
}
// Without these the page would show a dead main button.
const required = ['exe', 'dmgArm64', 'dmgX64', 'appimage']

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const response = await fetch(
  `https://api.github.com/repos/${values.repo}/releases/tags/${encodeURIComponent(values.tag)}`,
  {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ukemi-release-workflow',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  },
)
if (!response.ok) {
  process.stderr.write(`release ${values.tag}: ${response.status} ${await response.text()}\n`)
  process.exit(1)
}
const release = await response.json()

const assets = {}
for (const [key, pattern] of Object.entries(patterns)) {
  const asset = release.assets.find((a) => pattern.test(a.name))
  if (asset) assets[key] = asset.browser_download_url
}
const missing = required.filter((key) => !assets[key])
if (missing.length > 0) {
  process.stderr.write(`release ${values.tag} has no asset for: ${missing.join(', ')}\n`)
  process.exit(1)
}

const data = {
  version: release.tag_name.replace(/^v/, ''),
  tag: release.tag_name,
  date: (release.published_at ?? release.created_at).slice(0, 10),
  url: release.html_url,
  assets,
}
await writeFile(values.out, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`wrote ${values.out} for ${release.tag_name}\n`)
