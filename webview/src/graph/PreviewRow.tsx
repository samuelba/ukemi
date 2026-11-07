import type { PreviewNode } from '../../../shared/dropPreview'
import type { GraphRow } from '../../../shared/graphLayout'
import type { CommitView } from '../../../shared/protocol'
import { splitId, title } from '../shared/format'
import { GraphCell } from './GraphCell'

interface PreviewRowProps {
  node: PreviewNode
  commit: CommitView
  row: GraphRow
  lanes: number
  changeIdLength: number
}

// What the commit would look like in this row: a copy is a new mutable change without the
// bookmarks, and the faded row where a moved change was is no longer the working copy.
function shownCommit(node: PreviewNode, commit: CommitView, row: GraphRow): CommitView {
  if (node.role === 'new') {
    return { ...commit, row, isWorkingCopy: false, isImmutable: false, localBookmarks: [] }
  }
  if (node.role === 'old') {
    return { ...commit, row, isWorkingCopy: false, localBookmarks: [] }
  }
  return { ...commit, row }
}

// As CommitRow shows them: an empty working copy needs no label.
function placeholder(commit: CommitView): string {
  if (commit.isEmpty) {
    return commit.isWorkingCopy ? '' : '(empty)'
  }
  return '(no description)'
}

const ROLE_TITLES: Record<NonNullable<PreviewNode['role']>, string> = {
  moved: 'Moves here',
  carried: 'Moves along',
  new: 'A new copy',
  old: 'Where it is now',
  reparented: 'Gets new parents',
}

// A row of the previewed graph. It only shows: dragging, menus and actions wait for Apply.
export function PreviewRow({ node, commit, row, lanes, changeIdLength }: PreviewRowProps) {
  const shown = shownCommit(node, commit, row)
  const change = splitId(commit.changeId, commit.changePrefix, changeIdLength)
  const summary = title(commit.description)
  const classes = ['commit', 'preview-row', node.role && `preview-${node.role}`]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={classes}
      data-preview-id={node.id}
      role="treeitem"
      aria-level={1}
      title={node.role ? ROLE_TITLES[node.role] : undefined}
    >
      <GraphCell commit={shown} lanes={lanes} />
      <div className="commit-body">
        <div className="commit-head">
          {node.role === 'new' ? (
            <span className="change-id preview-new-id">new</span>
          ) : (
            <span className="change-id">
              <span className="id-prefix">{change.prefix}</span>
              <span className="id-rest">{change.rest}</span>
            </span>
          )}
          {shown.localBookmarks.length > 0 && (
            <span className="badges">
              {shown.localBookmarks.map((bookmark) => (
                <span key={bookmark.name} className="badge bookmark">
                  {bookmark.name}
                </span>
              ))}
            </span>
          )}
          <span className={`summary${summary ? '' : ' muted'}`}>
            {summary || placeholder(shown)}
          </span>
        </div>
      </div>
    </div>
  )
}
