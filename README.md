# Ukemi: Jujutsu (jj) GUI

Ukemi is a visual interface for [Jujutsu (jj)](https://jj-vcs.github.io/jj/) in VS Code. In judo, _ukemi_ is the art of falling safely. With jj and `undo`, every change is safe to try.

## Features

- **Change graph.** See your changes, bookmarks, tags, workspaces and conflicts. The working copy has a red seal. Filter by _Recent_, _Mine_, _My history_, _Stack_ or _Working copy_ (the working copy and its last 5 parents) and choose the history depth.
- **Drag and drop.** Drag a change onto another change to rebase it with its descendants. Hold Alt to move only that change. Drag a file to another change to move its changes. Drag a bookmark to move it.
- **Edit history.** Use the context menu or the hover action to describe, create, edit, squash, split, abandon, duplicate and revert changes. Click a change to show or hide its files.
- **Split by hunks.** Select hunks in a split editor. The selected hunks go into a new change before the original.
- **Evolution.** The Evolution panel shows how the selected change evolved: each amend, describe, snapshot and rebase. Select a change in the graph. Click a version to see what it changed, compare it with the current version, or restore its files.
- **Diffs.** Click a file to see its diff. The Source Control view shows the working copy for repositories that the Git extension does not show.
- **Sync.** Fetch, push tracked bookmarks, undo and redo from the toolbar. SSH remotes use your SSH agent. For HTTPS remotes, Ukemi uses your git credential helper first, then your GitHub sign-in in the editor or your GitLab sign-in. For GitHub, you can also choose a user name and a personal access token with the `repo` scope. Use **Sign In to GitHub or GitLab** to change the choice, and **Sign Out of GitHub or GitLab** to remove a stored token.
- **Pull and merge requests.** Create GitHub pull requests and GitLab merge requests from a change. See their status and CI result in the graph. Hover a request you opened to see the jobs, and use the open icon to open it in the browser. Merge them and clean up after the merge.
- **Many repositories.** Ukemi finds repositories in subfolders, for example `tools/firmware/repo`. When it finds more than one, select it in the dropdown. Ukemi follows the active editor.
- **No setup.** When jj is missing, Ukemi offers to download the official static release and checks its SHA-256 digest.

## Requirements

- Linux (tested on Ubuntu 24.04 and Fedora 41).
- jj 0.40 or later. Ukemi downloads jj 0.46 when you agree.

## Settings

Select the gear in the title bar of the Ukemi view to open the Ukemi settings.

| Setting                                     | Purpose                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ukemi.jjPath`                              | Path to jj. Empty means search `PATH` and common folders.                             |
| `ukemi.defaultFilter`, `ukemi.historyDepth` | Filter and time range that the graph shows first.                                     |
| `ukemi.repoScanDepth`                       | Folder levels to search for repositories.                                             |
| `ukemi.showSourceControl`                   | When to show the working copy in Source Control.                                      |
| `ukemi.gitlab.hosts`, `ukemi.github.hosts`  | Self-hosted GitLab and GitHub Enterprise hosts.                                       |
| `ukemi.gitlab.oauthApplications`            | GitLab OAuth client IDs by host. The client ID is not a secret.                       |
| `ukemi.forge.ciOnlyMine`                    | Show CI status only on open requests that you authored. Default: on.                  |
| `ukemi.forge.requestLimit`                  | How many recently updated merge and pull requests to load. Default: 50. Maximum: 500. |

## Sign in

- **GitHub** uses the GitHub account of the editor, or a personal access token with the `repo` scope.
- **GitLab** tries, in order: an OAuth session, a personal access token, then the `glab` CLI. For `glab`, Ukemi runs `glab api --hostname <host>` and does not read the token. `glab` sends its own `Bearer` header and refreshes a web login.
- OAuth and personal access tokens are stored in VS Code secret storage. On Linux that is the OS keyring (libsecret), not a clear-text file. **Sign Out** removes both and stops using `glab` until the next sign-in. The `glab` login itself stays in `glab`.

### GitLab OAuth application

OAuth needs a non-confidential application on that GitLab host, with the `api` scope and these redirect URIs:

- `vscode://samuelba.ukemi-jj/gitlab-auth`
- `cursor://samuelba.ukemi-jj/gitlab-auth`

Put the client ID in `ukemi.gitlab.oauthApplications`, for example `{ "git.example.com": "abc123" }`. If the host has no client ID, Ukemi asks for a personal access token with the `api` scope instead.

CI status refreshes about every 15 seconds while one of your pipelines is running, and about every 60 seconds otherwise. It pauses while the window is not focused.

## Development

Install the dependencies once:

```sh
npm install
```

### Run from source

1. Open the `ukemi` folder in VS Code: `code ukemi`. The launch configuration is in `ukemi/.vscode`.
2. Press F5, or select **Run Ukemi** in the Run and Debug view. The `watch` task builds the code first.
3. In the new Extension Development Host window, open a folder that contains a jj repository.
4. Select the Ukemi icon in the activity bar.

The launch configuration disables VisualJJ in the development window, so that only one jj view shows.

### Live changes

The `watch` task stays active and rebuilds `dist/` each time you save. There is no hot reload. After a rebuild:

| You changed                  | Do this in the Extension Development Host                             |
| ---------------------------- | --------------------------------------------------------------------- |
| `webview/src/**`             | Run **Developer: Reload Webviews**, or close and open the Ukemi view. |
| `src/**` or `shared/**`      | Run **Developer: Reload Window** (Ctrl+R).                            |
| `package.json` contributions | Stop the debug session and press F5 again.                            |

To watch without the debugger, run `npm run watch` in a terminal.

### Test and package

```sh
npm test            # unit and integration tests, needs jj on PATH
npm run test:e2e    # runs the extension inside the installed VS Code
npm run package     # builds ukemi-jj-0.2.0.vsix
```

### Install the VSIX

```sh
code --install-extension ukemi-jj-0.2.0.vsix
```

In Cursor, `npm run install:cursor` packages and installs in one step.

Then run **Developer: Restart Extension Host** or **Developer: Reload Window**. The editor keeps the old code loaded and does not ask for a restart when the version number is the same. To remove it, run `code --uninstall-extension samuelba.ukemi-jj`.

## Release

A push to `main` does not publish. [release-please](https://github.com/googleapis/release-please) opens a release pull request from conventional commits (`feat` bumps minor before 1.0, `fix` bumps patch, `feat!` bumps major after 1.0). Merging that pull request creates the `vX.Y.Z` tag, the GitHub Release, and attaches `ukemi-jj-X.Y.Z.vsix`. Merge commits are removed from those notes afterward.

Set the repository secret `RELEASE_PLEASE_TOKEN` to a fine-grained personal access token if CI should run on that pull request. Without it, the release still works.

Upload that `.vsix` by hand. Cursor reads extensions from Open VSX, so publish in both places.

### VS Code Marketplace

1. Create an Azure DevOps organization and a personal access token with Marketplace (publish) scope.
2. Create the publisher `samuelba` at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage). The publisher id must exist before the first upload.
3. Upload `ukemi-jj-X.Y.Z.vsix` in the web UI, or run `npx vsce publish --packagePath ukemi-jj-X.Y.Z.vsix -p "$VSCE_PAT"`.

### Open VSX (Cursor)

1. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub and sign the Eclipse publisher agreement.
2. Create a token, then create the namespace once: `npx ovsx create-namespace samuelba -p "$OVSX_PAT"`.
3. Publish: `npx ovsx publish ukemi-jj-X.Y.Z.vsix -p "$OVSX_PAT"`.

After the first public release, a later change can publish from `.github/workflows/release.yml` with the secrets `VSCE_PAT` and `OVSX_PAT`.
