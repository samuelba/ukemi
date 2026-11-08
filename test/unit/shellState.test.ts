import { describe, expect, test } from 'vitest'
import type { ChangeDetail, DiffDocument, LogLine, PanelTab } from '../../shared/desktopProtocol'
import {
  activeAfterClose,
  appendLog,
  withDetail,
  withExitedTerminal,
  withoutTab,
  withTab,
} from '../../webview/src/desktop/shellState'
import { shellRows, workspaceColumns, type Layout } from '../../webview/src/desktop/useLayout'

const line = (text: string) => ({ text }) as unknown as LogLine
const tab = (id: string, title = id): PanelTab => ({ id, title, kind: 'split' }) as PanelTab
const detail = (changeId: string) => ({ commit: { changeId } }) as unknown as ChangeDetail
const diff = { title: 'a.ts' } as unknown as DiffDocument

describe('appendLog', () => {
  test('appends, replaces, and keeps only the newest lines', () => {
    expect(appendLog([line('a')], [line('b')], false)).toEqual([line('a'), line('b')])
    expect(appendLog([line('a')], [line('b')], true)).toEqual([line('b')])
    expect(appendLog([line('a'), line('b')], [line('c')], false, 2)).toEqual([line('b'), line('c')])
  })
})

describe('tabs', () => {
  test('a tab with an open id replaces it, with its new title', () => {
    expect(withTab([tab('a'), tab('b')], tab('a', 'A2'))).toEqual([tab('a', 'A2'), tab('b')])
    expect(withTab([tab('a')], tab('b'))).toEqual([tab('a'), tab('b')])
  })

  test('closing the active tab falls back, closing another keeps it', () => {
    expect(withoutTab([tab('a'), tab('b')], 'a')).toEqual([tab('b')])
    expect(activeAfterClose('a', 'a', 'change')).toBe('change')
    expect(activeAfterClose('b', 'a', 'change')).toBe('b')
  })

  test('marks an exited terminal', () => {
    const terminals = [{ id: 't1', title: 'sh', cwd: '/', hasExited: false }]
    expect(withExitedTerminal(terminals, 't1')[0]?.hasExited).toBe(true)
  })
})

describe('withDetail', () => {
  test('keeps the diff for the same change and closes it for another', () => {
    const pane = { detail: detail('k1'), diff }
    expect(withDetail(pane, detail('k1')).diff).toBe(diff)
    expect(withDetail(pane, detail('k2')).diff).toBeNull()
    expect(withDetail(pane, null).diff).toBeNull()
  })
})

describe('layout grid', () => {
  const layout: Layout = {
    sidebar: 248,
    detail: 560,
    log: 220,
    showSidebar: true,
    showDetail: false,
    showPanel: false,
  }

  test('leaves out hidden panes', () => {
    expect(workspaceColumns(layout)).toBe('minmax(180px, 248px) 1px minmax(200px, 1fr)')
    expect(shellRows(layout)).toBeUndefined()
    expect(shellRows({ ...layout, showPanel: true })).toContain('220px')
  })
})
