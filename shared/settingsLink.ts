const SETTINGS_COMMAND = 'workbench.action.openSettings'

export function settingsCommandHref(query: string): string {
  return `command:${SETTINGS_COMMAND}?${encodeURIComponent(JSON.stringify(query))}`
}
