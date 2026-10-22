export function jjString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

export function jsonObject(fields: Record<string, string>): string {
  const parts = Object.entries(fields).map(
    ([key, expr], index) => `${jjString(`${index === 0 ? '{' : ','}${JSON.stringify(key)}:`)} ++ ${expr}`,
  )
  return `${parts.join(' ++ ')} ++ ${jjString('}')}`
}

export function jsonArray(list: string, item: string, itemExpr: string): string {
  return `${jjString('[')} ++ ${list}.map(|${item}| ${itemExpr}).join(",") ++ ${jjString(']')}`
}

const LINE_END = ' ++ "\\n"'

export const LOG_TEMPLATE =
  jsonObject({
    change_id: 'json(change_id)',
    change_prefix: 'json(change_id.shortest().prefix())',
    commit_id: 'json(commit_id)',
    commit_prefix: 'json(commit_id.shortest().prefix())',
    parents: 'json(parents.map(|p| p.commit_id()))',
    description: 'json(description)',
    author: 'json(author)',
    committer: 'json(committer)',
    local_bookmarks: jsonArray(
      'local_bookmarks',
      'b',
      'json({"name" => b.name(), "synced" => b.synced(), "conflict" => b.conflict()})',
    ),
    remote_bookmarks: jsonArray(
      'remote_bookmarks',
      'b',
      'json({"name" => b.name(), "remote" => b.remote(), "tracked" => b.tracked()})',
    ),
    tags: 'json(tags.map(|t| t.name()))',
    working_copies: 'json(working_copies.map(|w| w.name()))',
    change_offset: 'json(change_offset)',
    is_working_copy: 'json(current_working_copy)',
    is_empty: 'json(empty)',
    has_conflict: 'json(conflict)',
    is_immutable: 'json(immutable)',
    is_divergent: 'json(divergent)',
    is_hidden: 'json(hidden)',
    is_mine: 'json(self.mine())',
    is_pushed: 'json(self.contained_in("::remote_bookmarks()"))',
  }) + LINE_END

export const FILES_TEMPLATE =
  jsonObject({
    files: jsonArray(
      'diff.files()',
      'f',
      'json({"path" => f.path(), "status" => f.status(), "source" => f.source().path()})',
    ),
    conflicted: 'json(self.conflicted_files().map(|f| f.path()))',
  }) + LINE_END

export const COMMIT_ID_TEMPLATE = 'commit_id ++ "\\n"'

export const WORKSPACE_TEMPLATE =
  'json({"name" => name, "root" => root, "commit_id" => target.commit_id()}) ++ "\\n"'

export const OP_LOG_TEMPLATE =
  'json({"id" => id, "description" => description, "time" => time.end()}) ++ "\\n"'
