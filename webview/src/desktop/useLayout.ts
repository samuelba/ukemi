import { useCallback, useState } from 'react'

const LAYOUT_KEY = 'ukemi.layout'
export const MIN_SIDEBAR = 180
export const MIN_DETAIL = 320
const MIN_GRAPH = 200
export const MIN_LOG = 90

export interface Layout {
  sidebar: number
  detail: number
  log: number
  showSidebar: boolean
  showDetail: boolean
  showPanel: boolean
}

export type UpdateLayout = (next: Partial<Layout> | ((current: Layout) => Partial<Layout>)) => void

const DEFAULT_LAYOUT: Layout = {
  sidebar: 248,
  detail: 560,
  log: 220,
  showSidebar: true,
  showDetail: true,
  showPanel: false,
}

function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<Layout>
    return { ...DEFAULT_LAYOUT, ...saved }
  } catch {
    return DEFAULT_LAYOUT
  }
}

// The pane sizes and which panes show, kept in the page's storage across starts.
export function useLayout(): [Layout, UpdateLayout] {
  const [layout, setLayout] = useState<Layout>(readLayout)
  const update = useCallback<UpdateLayout>(
    (next) =>
      setLayout((current) => {
        const merged = { ...current, ...(typeof next === 'function' ? next(current) : next) }
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(merged))
        } catch {
          // Layout is a convenience only.
        }
        return merged
      }),
    [],
  )
  return [layout, update]
}

// The panes keep their dragged widths while the window has room, and give way to their
// minimums when it does not, so a narrow window never pushes the change pane out of view.
export function workspaceColumns(layout: Layout): string {
  return [
    layout.showSidebar ? `minmax(${MIN_SIDEBAR}px, ${layout.sidebar}px) 1px` : '',
    `minmax(${MIN_GRAPH}px, 1fr)`,
    layout.showDetail ? `1px minmax(${MIN_DETAIL}px, ${layout.detail}px)` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function shellRows(layout: Layout): string | undefined {
  return layout.showPanel
    ? `var(--shell-titlebar) 1fr 1px ${layout.log}px var(--shell-statusbar)`
    : undefined
}
