export function nodeWrapperScript(nodePath: string, args: readonly string[], flag: string): string {
  const quoted = [nodePath, ...args].map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ')
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ${flag}=1 exec ${quoted} "$@"\n`
}
