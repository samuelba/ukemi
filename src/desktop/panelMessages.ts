import type { SidePanels } from '../../shared/desktopProtocol'

type PanelName = keyof SidePanels

// The side panels are built again on every change, and most changes leave them as they were. A
// panel the window already shows is left out, and nothing is sent when no panel changed.
export class PanelMessages {
  private readonly sent = new Map<PanelName, string>()

  // The window loaded again and shows no panels.
  forget(): void {
    this.sent.clear()
  }

  next(panels: SidePanels): Partial<SidePanels> | null {
    const changed = (Object.keys(panels) as PanelName[]).filter((name) => {
      const json = JSON.stringify(panels[name])
      if (this.sent.get(name) === json) {
        return false
      }
      this.sent.set(name, json)
      return true
    })
    if (changed.length === 0) {
      return null
    }
    return Object.fromEntries(changed.map((name) => [name, panels[name]])) as Partial<SidePanels>
  }
}
