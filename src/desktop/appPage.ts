export const APP_SCHEME = 'ukemi'
export const APP_HOST = 'app'

// Whether a frame shows one of the app's own pages, the only ones that may talk to main.
export function isAppPage(url: string): boolean {
  if (!URL.canParse(url)) {
    return false
  }
  const parsed = new URL(url)
  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === APP_HOST &&
    parsed.username === '' &&
    parsed.password === ''
  )
}
