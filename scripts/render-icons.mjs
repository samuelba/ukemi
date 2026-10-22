import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resources = resolve(import.meta.dirname, '..', 'resources')

for (const [source, target, size] of [['icon.svg', 'icon.png', 256]]) {
  const svg = readFileSync(resolve(resources, source))
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(resolve(resources, target), png)
  process.stdout.write(`${target} (${size}px)\n`)
}
