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
    ([key, expr], index) =>
      `${jjString(`${index === 0 ? '{' : ','}${JSON.stringify(key)}:`)} ++ ${expr}`,
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
  }) + LINE_END

const FILE_LIST_FIELDS = {
  files: jsonArray(
    'diff.files()',
    'f',
    'json({"path" => f.path(), "status" => f.status(), "source" => f.source().path()})',
  ),
  conflicted: 'json(self.conflicted_files().map(|f| f.path()))',
}

export const FILES_TEMPLATE = jsonObject(FILE_LIST_FIELDS) + LINE_END

export const FILES_STATS_TEMPLATE =
  jsonObject({
    ...FILE_LIST_FIELDS,
    stats: jsonArray(
      'diff.stat().files()',
      's',
      'json({"path" => s.path(), "added" => s.lines_added(), "removed" => s.lines_removed()})',
    ),
  }) + LINE_END

export const EVOLOG_TEMPLATE =
  jsonObject({
    commit_id: 'json(commit.commit_id())',
    commit_prefix: 'json(commit.commit_id().shortest().prefix())',
    parents: 'json(commit.parents().map(|p| p.commit_id()))',
    description: 'json(commit.description())',
    timestamp: 'json(commit.committer().timestamp())',
    is_empty: 'json(commit.empty())',
    operation: 'if(operation, json(operation.description()), "\\"\\"")',
  }) + LINE_END

export const DIFF_FILES_TEMPLATE =
  'json({"path" => path.display(), "status" => status, "source" => source.path().display()})' +
  LINE_END

export const COMMIT_ID_TEMPLATE = 'commit_id ++ "\\n"'

export const WORKSPACE_TEMPLATE =
  'json({"name" => name, "root" => root, "commit_id" => target.commit_id(), "change_id" => target.change_id().short(8), "description" => target.description().first_line(), "is_empty" => target.empty(), "changed_files" => target.diff().files().len()}) ++ "\\n"'

export const PUSHED_BOOKMARK_TEMPLATE = 'if(remote && remote != "git", name ++ "\\n")'

const TRUNK_NAME = 'b.name() == "main" || b.name() == "master" || b.name() == "trunk"'

const TRUNK_BOOKMARK_NAMES =
  'separate("\\n", ' +
  `remote_bookmarks.filter(|b| b.remote() != "git" && (${TRUNK_NAME})).map(|b| b.name()), ` +
  `bookmarks.filter(|b| ${TRUNK_NAME}).map(|b| b.name()), ` +
  'remote_bookmarks.filter(|b| b.remote() != "git").map(|b| b.name())' +
  ')'

export const TRUNK_TEMPLATE = `commit_id ++ "\\n" ++ ${TRUNK_BOOKMARK_NAMES} ++ "\\n"`

const BOOKMARK_LIST_FIELDS = {
  name: 'json(name)',
  remote: 'json(remote)',
  present: 'json(present)',
  conflict: 'json(conflict)',
  tracked: 'json(tracked)',
  commit_id: 'if(normal_target, json(normal_target.commit_id()), "null")',
  description: 'if(normal_target, json(normal_target.description().first_line()), json(""))',
}

export const BOOKMARK_LIST_TEMPLATE =
  jsonObject({
    ...BOOKMARK_LIST_FIELDS,
    in_trunk: 'if(normal_target, json(normal_target.contained_in("::trunk()")), "false")',
  }) + LINE_END

export const BOOKMARK_LIST_GRAPH_TEMPLATE =
  jsonObject({
    ...BOOKMARK_LIST_FIELDS,
    in_trunk: 'json(false)',
  }) + LINE_END

export const OP_LOG_TEMPLATE =
  'json({"id" => id, "description" => description, "time" => time.end()}) ++ "\\n"'
