export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export const NULL_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
