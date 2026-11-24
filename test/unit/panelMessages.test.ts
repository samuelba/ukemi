import { describe, expect, test } from 'vitest'
import type { SidePanelRow, SidePanels } from '../../shared/desktopProtocol'
import { PanelMessages } from '../../src/desktop/panelMessages'

function row(id: string, description = ''): SidePanelRow {
  return {
    id,
    label: id,
    description,
    tooltip: '',
    icon: 'history',
    contextValue: 'operation',
    view: 'ukemi.operations',
    arg: { kind: 'operation', id },
  }
}

function panels(operations: SidePanelRow[]): SidePanels {
  return { bookmarks: [], workspaces: [row('default')], operations }
}

describe('PanelMessages', () => {
  test('sends every panel the first time', () => {
    const first = panels([row('op1')])

    expect(new PanelMessages().next(first)).toEqual(first)
  })

  test('sends nothing when no panel changed', () => {
    const messages = new PanelMessages()
    messages.next(panels([row('op1')]))

    expect(messages.next(panels([row('op1')]))).toBeNull()
  })

  test('sends only the panels that changed', () => {
    const messages = new PanelMessages()
    messages.next(panels([row('op1', '1 minute ago')]))

    expect(messages.next(panels([row('op1', '2 minutes ago')]))).toEqual({
      operations: [row('op1', '2 minutes ago')],
    })
  })

  test('sees a change inside the argument of a row', () => {
    const messages = new PanelMessages()
    messages.next(panels([row('op1')]))

    const changed = panels([{ ...row('op1'), arg: { kind: 'operation', id: 'op2' } }])

    expect(messages.next(changed)).toEqual({ operations: changed.operations })
  })

  test('sends every panel again to a window that loaded again', () => {
    const messages = new PanelMessages()
    const shown = panels([row('op1')])
    messages.next(shown)
    messages.forget()

    expect(messages.next(shown)).toEqual(shown)
  })
})
