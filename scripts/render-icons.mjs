import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resources = resolve(import.meta.dirname, '..', 'resources')

// The macOS app icon needs at least 512 px. electron-builder makes the .icns from the 1024 px one.
for (const [source, target, size] of [
  ['icon.svg', 'icon.png', 256],
  ['icon.svg', 'icon-1024.png', 1024],
]) {
  const svg = readFileSync(resolve(resources, source))
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(resolve(resources, target), png)
  process.stdout.write(`${target} (${size}px)\n`)
}
