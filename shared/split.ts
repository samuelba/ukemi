import type { FileStatus } from './model'

export type Segment =
  { kind: 'same'; text: string } | { kind: 'change'; id: number; removed: string; added: string }

export interface SplitFile {
  path: string
  sourcePath: string
  status: FileStatus
  isBinary: boolean
  segments: Segment[]
}

export interface SplitRequest {
  commitId: string
  title: string
  description: string
  files: SplitFile[]
}

export interface SplitSelection {
  path: string
  hunks: number[]
  isWholeFile: boolean
}

export type SplitHostMessage = { type: 'load'; request: SplitRequest }

export type SplitWebviewMessage =
  | { type: 'ready' }
  | { type: 'apply'; message: string; selections: SplitSelection[] }
  | { type: 'cancel' }

export function changeIds(file: SplitFile): number[] {
  return file.segments.flatMap((s) => (s.kind === 'change' ? [s.id] : []))
}
