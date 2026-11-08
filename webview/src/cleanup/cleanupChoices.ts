import type { CleanupSelection, CleanupSnapshot } from '../../../shared/cleanup'
import { carriedChoices, type CleanupChoices } from './carriedSelection'

export interface CleanupState {
  snapshot: CleanupSnapshot | null
  choices: CleanupChoices
}

// A checkbox of the form, or a new snapshot from the host.
export type CleanupAction =
  | { type: 'load'; snapshot: CleanupSnapshot }
  | {
      type: 'bookmark' | 'abandonCommits' | 'deleted' | 'deleteRemote'
      name: string
      selected: boolean
    }
  | { type: 'workspace' | 'deleteFiles'; name: string; selected: boolean }
  | { type: 'drop' | 'undescribed'; commitId: string; selected: boolean }

export const NO_CHOICES: CleanupChoices = {
  bookmarks: new Set(),
  abandonCommits: new Set(),
  deleted: new Set(),
  deleteRemote: new Set(),
  workspaces: new Set(),
  deleteFiles: new Set(),
  drops: new Set(),
  undescribedDrops: new Set(),
}

export const INITIAL_CLEANUP: CleanupState = { snapshot: null, choices: NO_CHOICES }

export function toggle(current: ReadonlySet<string>, name: string, selected: boolean): Set<string> {
  const next = new Set(current)
  if (selected) {
    next.add(name)
  } else {
    next.delete(name)
  }
  return next
}

// Some checkboxes come in pairs: the option of a row needs its row checked. Unchecking the row
// clears the option, and checking an option that does nothing alone checks its row.
function choose(
  choices: CleanupChoices,
  action: Exclude<CleanupAction, { type: 'load' }>,
): CleanupChoices {
  const c = choices
  switch (action.type) {
    case 'bookmark':
      return {
        ...c,
        bookmarks: toggle(c.bookmarks, action.name, action.selected),
        abandonCommits: action.selected
          ? c.abandonCommits
          : toggle(c.abandonCommits, action.name, false),
      }
    case 'abandonCommits':
      return { ...c, abandonCommits: toggle(c.abandonCommits, action.name, action.selected) }
    case 'deleted':
      return {
        ...c,
        deleted: toggle(c.deleted, action.name, action.selected),
        deleteRemote: action.selected ? c.deleteRemote : toggle(c.deleteRemote, action.name, false),
      }
    case 'deleteRemote':
      return {
        ...c,
        deleteRemote: toggle(c.deleteRemote, action.name, action.selected),
        deleted: action.selected ? toggle(c.deleted, action.name, true) : c.deleted,
      }
    case 'workspace':
      return {
        ...c,
        workspaces: toggle(c.workspaces, action.name, action.selected),
        deleteFiles: action.selected ? c.deleteFiles : toggle(c.deleteFiles, action.name, false),
      }
    case 'deleteFiles':
      return {
        ...c,
        deleteFiles: toggle(c.deleteFiles, action.name, action.selected),
        workspaces: action.selected ? toggle(c.workspaces, action.name, true) : c.workspaces,
      }
    case 'drop':
      return { ...c, drops: toggle(c.drops, action.commitId, action.selected) }
    case 'undescribed':
      return {
        ...c,
        undescribedDrops: toggle(c.undescribedDrops, action.commitId, action.selected),
      }
  }
}

export function cleanupReducer(state: CleanupState, action: CleanupAction): CleanupState {
  if (action.type === 'load') {
    // The host also sends a snapshot after a refresh, so the user's choices carry over.
    return {
      snapshot: action.snapshot,
      choices: carriedChoices(state.choices, state.snapshot, action.snapshot),
    }
  }
  return { ...state, choices: choose(state.choices, action) }
}

// What Apply sends. An option counts only while its row is checked.
export function selectionOf(choices: CleanupChoices): CleanupSelection {
  return {
    bookmarks: [...choices.bookmarks],
    abandonBookmarkCommits: [...choices.abandonCommits].filter((name) =>
      choices.bookmarks.has(name),
    ),
    deletedBookmarks: [...choices.deleted],
    deleteRemote: [...choices.deleteRemote].filter((name) => choices.deleted.has(name)),
    workspaces: [...choices.workspaces],
    deleteWorkspaceFiles: [...choices.deleteFiles].filter((name) => choices.workspaces.has(name)),
    divergent: [...choices.drops],
    undescribed: [...choices.undescribedDrops],
  }
}

// The rows Apply removes.
export function countOf(choices: CleanupChoices): number {
  return (
    choices.bookmarks.size +
    choices.deleted.size +
    choices.workspaces.size +
    choices.drops.size +
    choices.undescribedDrops.size
  )
}
