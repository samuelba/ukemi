# Ukemi: Jujutsu (jj) GUI

Ukemi is a visual interface for [Jujutsu (jj)](https://jj-vcs.github.io/jj/) in VS Code. In judo, *ukemi* is the art of falling safely. With jj and `undo`, every change is safe to try.

## Features

- **Change graph.** See your changes, bookmarks, tags, workspaces and conflicts. The working copy has a red seal. Filter by *Recent*, *Mine* or *Stack* and choose the history depth.
- **Drag and drop.** Drag a change onto another change to rebase it with its descendants. Hold Alt to move only that change. Drag a file to another change to move its changes. Drag a bookmark to move it.
- **Edit history.** Use the context menu to describe, create, edit, squash, split, abandon, duplicate and revert changes. Double-click a change to edit it.
- **Split by hunks.** Select hunks in a split editor. The selected hunks go into a new change before the original.
- **Diffs.** Click a file to see its diff. The Source Control view shows the working copy for repositories that the Git extension does not show.
- **Sync.** Fetch, push tracked bookmarks, undo and redo from the toolbar.
- **Pull and merge requests.** Create GitHub pull requests and GitLab merge requests from a change. See their status and CI result in the graph. Merge them and clean up after the merge.
- **Many repositories.** Ukemi finds repositories in subfolders, for example `tools/firmware/repo`. When it finds more than one, select it in the dropdown. Ukemi follows the active editor.
- **No setup.** When jj is missing, Ukemi offers to download the official static release and checks its SHA-256 digest.

## Requirements

- Linux (tested on Ubuntu 24.04 and Fedora 41).
- jj 0.40 or later. Ukemi downloads jj 0.46 when you agree.

## Settings

| Setting | Purpose |
| --- | --- |
| `ukemi.jjPath` | Path to jj. Empty means search `PATH` and common folders. |
| `ukemi.repoScanDepth` | Folder levels to search for repositories. |
| `ukemi.showSourceControl` | When to show the working copy in Source Control. |
| `ukemi.gitlab.hosts`, `ukemi.github.hosts` | Self-hosted GitLab and GitHub Enterprise hosts. |

## Sign in

- **GitHub** uses the VS Code GitHub account.
- **GitLab** uses a personal access token with the `api` scope. Ukemi keeps it in the VS Code secret storage.

## Development

```sh
npm install
npm run build
npm test
npm run package
```

Press F5 in VS Code to start an Extension Development Host.
