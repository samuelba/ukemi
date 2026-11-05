# Changelog

## [0.11.0](https://github.com/samuelba/ukemi/compare/v0.10.0...v0.11.0) (2026-11-05)


### Features

* custom revset filter and graph search (M7) ([74e7817](https://github.com/samuelba/ukemi/commit/74e7817863c85f23345601d92f247a501b50d70d))
* custom revset filter and graph search (M7) ([13bd7a4](https://github.com/samuelba/ukemi/commit/13bd7a4fea4ab63dca8ef60cabd4ea9cbc284433))
* drop a change between two changes to reorder the stack ([8d5bf5c](https://github.com/samuelba/ukemi/commit/8d5bf5ce19fcc93bde1a1d4b5490d761ffd14912))
* drop a change between two changes to reorder the stack ([25a5dda](https://github.com/samuelba/ukemi/commit/25a5dda35613e9819810a19658de7814c662ca39))
* expand hidden lines and show the whole file ([51e6c9b](https://github.com/samuelba/ukemi/commit/51e6c9b48a72ecde5168e917c44f0f445e47a441))
* expand hidden lines and show the whole file ([5e84305](https://github.com/samuelba/ukemi/commit/5e84305739544b4d0fafcc2567a7d1101c2bd41c))
* file history and blame (M8) ([9509aec](https://github.com/samuelba/ukemi/commit/9509aec40a73be1fe7e139561ea50bb5a57588e5))
* file history and blame (M8) ([16c72dd](https://github.com/samuelba/ukemi/commit/16c72dd0e80d744393ae9dfd5102f6d5d140cba5))
* load the commit graph in pages (F32) ([5a8b70b](https://github.com/samuelba/ukemi/commit/5a8b70b167d663c482bc97860d69aaa2f2ce2d28))
* load the commit graph in pages (F32) ([ca7b393](https://github.com/samuelba/ukemi/commit/ca7b393394c66c192d4e8e41279ef2f84679fec2))
* side-by-side, ignore-whitespace and image diffs ([ea668ff](https://github.com/samuelba/ukemi/commit/ea668ff679a56a3b08ad5f8b5492d2079ff3436f))
* side-by-side, ignore-whitespace and image diffs ([67619e3](https://github.com/samuelba/ukemi/commit/67619e369eed8a10d2026c7866d93f983997431b))


### Bug Fixes

* debounce window bounds and restore position and maximized state (F39) ([b6d596d](https://github.com/samuelba/ukemi/commit/b6d596dce61fb05372da2761e448793eeb5d5b42))
* debounce window bounds and restore position and maximized state (F39) ([88fc407](https://github.com/samuelba/ukemi/commit/88fc4078759c180274087023181b7975c0b7d602))
* end a window's jj processes when it closes (F43) ([bd32180](https://github.com/samuelba/ukemi/commit/bd321802fddfb08b045d1150d599c56f15fb60d4))
* end a window's jj processes when it closes (F43) ([981baf7](https://github.com/samuelba/ukemi/commit/981baf7b7974bbcc125badb7d92fcec89f604536))
* keep elided-parent edges across operations (F27) ([44de851](https://github.com/samuelba/ukemi/commit/44de8512a09897067d0f03b7d921e2dc4b9dff99))
* keep elided-parent edges across operations (F27) ([807ce3a](https://github.com/samuelba/ukemi/commit/807ce3a94338b247acdc11598b90a42361373238))
* keep launches made while the app starts (F40) ([f040c7c](https://github.com/samuelba/ukemi/commit/f040c7c53426042ece370562b38cd702a5c8ebbd))
* keep launches made while the app starts (F40) ([0a2b5bc](https://github.com/samuelba/ukemi/commit/0a2b5bce3645b5569f9d6164d1e7f85e170d5095))
* open a repository in the window that already shows it (F41) ([49ffec5](https://github.com/samuelba/ukemi/commit/49ffec548cc6f2c27a66816c64cfb69e8fd54faa))
* open a repository in the window that already shows it (F41) ([a8ba89b](https://github.com/samuelba/ukemi/commit/a8ba89bca7c449c4d95ccb662765d626e737f907))
* skip ignored folders when watching the working copy ([80d2c7b](https://github.com/samuelba/ukemi/commit/80d2c7b885f2a65f1ac24ed9041a95ae85abcad7))
* skip ignored folders when watching the working copy ([a98e717](https://github.com/samuelba/ukemi/commit/a98e7178f55dfe6cdcbc06c9fa6969351d8b2c8f))
* watch operations in secondary workspaces (F34) ([cdc8337](https://github.com/samuelba/ukemi/commit/cdc8337b3655ab7904f7d5a07c195ceeae4c0440))
* watch operations in secondary workspaces (F34) ([d22c7d4](https://github.com/samuelba/ukemi/commit/d22c7d4f588b74ac8c25dc6fc18a52a097398d50))


### Performance Improvements

* batch elision lookups in one jj process on jj 0.47+ ([4b18d36](https://github.com/samuelba/ukemi/commit/4b18d36c2a5732e9a475ed9e3119ebd1531ccdd8))
* batch elision lookups in one jj process on jj 0.47+ ([5ce5a21](https://github.com/samuelba/ukemi/commit/5ce5a217d1b4a8d060ff34c08b8f5fc54f67c4cb))
* keep elision lookups after a snapshot in any view ([9009aaf](https://github.com/samuelba/ukemi/commit/9009aafd5460dacd89a0942eb98f985291170150))
* keep elision lookups after a snapshot in any view ([4dcb0ce](https://github.com/samuelba/ukemi/commit/4dcb0ce2e8d830c1cb11319f8ef4540a7cc1db36))
* look up elided edges against the shown commits ([bd90aa3](https://github.com/samuelba/ukemi/commit/bd90aa34da9b07225bbdd367127f3936c46f370f))
* look up elided edges against the shown commits ([70c6bdb](https://github.com/samuelba/ukemi/commit/70c6bdb9189f9ec037e82201ab1b163e29902784))
* rebuild the graph page from ids after a snapshot ([0a2aa96](https://github.com/samuelba/ukemi/commit/0a2aa96a5844b05ebf093f4146053c3f89de8d4b))
* rebuild the graph page from ids after a snapshot ([369c0f8](https://github.com/samuelba/ukemi/commit/369c0f8c7b403fa87effbe9ec0a38a3bd3f3193e))
* reuse elision lookups across working-copy snapshots ([dc0133c](https://github.com/samuelba/ukemi/commit/dc0133c23d2c4acda645f9fa8b711496924c66f8))
* reuse elision lookups across working-copy snapshots ([878fdac](https://github.com/samuelba/ukemi/commit/878fdacdfe54a47183d8fbfa2a738320ce5dfb05))

## [0.10.0](https://github.com/samuelba/ukemi/compare/v0.9.0...v0.10.0) (2026-11-03)


### Features

* operation log view with restore and revert (M1) ([f647b25](https://github.com/samuelba/ukemi/commit/f647b25768579a369399e269f2f8cbe064dc760c))


### Bug Fixes

* drop rebased copies of commits from the release notes ([5c978e5](https://github.com/samuelba/ukemi/commit/5c978e5ffb365992b2e10b88bf060f511730c405))

## [0.9.0](https://github.com/samuelba/ukemi/compare/v0.8.0...v0.9.0) (2026-11-03)


### Features

* change the keyboard shortcuts of the desktop app ([f51ca0b](https://github.com/samuelba/ukemi/commit/f51ca0b6e097b8dd21e1a0c4b4690ac4fa8c0dd8))
* desktop version ([3a4ccf6](https://github.com/samuelba/ukemi/commit/3a4ccf664f2fca9e10081ea8304ef8ad885b7f23))
* find the desktop app by jj, jujutsu and git in Linux launchers ([f136e16](https://github.com/samuelba/ukemi/commit/f136e16294485ac1253f5c01047270f0f25b465a))
* list recently used repositories under File &gt; Open Recent ([463a42c](https://github.com/samuelba/ukemi/commit/463a42c5a9af68664877b4a951eed8d9ab57d8d5))
* resolve editor in desktop app ([8f5b644](https://github.com/samuelba/ukemi/commit/8f5b644067f6199be75dbd688cae4c48789f2194))
* suggest change descriptions with installed AI tools ([dbef4ea](https://github.com/samuelba/ukemi/commit/dbef4eaa2f6a9c409f4a4125460d6ebef081e58e))
* tell the app's users when a newer release is out ([9e2c6fc](https://github.com/samuelba/ukemi/commit/9e2c6fc64a43fc38e0a8bfd69837ad9fbfbc2c5d))
* zoom from the View menu, the mouse wheel and the status bar ([318a6f3](https://github.com/samuelba/ukemi/commit/318a6f38853b2ab64b62b9c482bb8a3a77fc052d))


### Bug Fixes

* ask before a new request takes a bookmark from another change ([49df262](https://github.com/samuelba/ukemi/commit/49df2622a11579687d8cd513cce7651ba74c005b))
* ask before Push All publishes bookmarks that no remote has ([9051bd2](https://github.com/samuelba/ukemi/commit/9051bd27e8bad27f7b5e7f4ffa73f97d691f8b89))
* ask for ssh key passphrases and new host keys ([2568ab6](https://github.com/samuelba/ukemi/commit/2568ab68d1df7b946d5ed3f0c70f9f8520095bad))
* check settings the app window sends before saving them ([04f1d75](https://github.com/samuelba/ukemi/commit/04f1d75d0431dbafbe9b51b5b5dabc632d236928))
* **ci:** build one macOS dmg per architecture with its own node-pty ([3a4ccf6](https://github.com/samuelba/ukemi/commit/3a4ccf664f2fca9e10081ea8304ef8ad885b7f23))
* **ci:** skip apt packages a release lacks, add a 1024px macOS icon ([3a4ccf6](https://github.com/samuelba/ukemi/commit/3a4ccf664f2fca9e10081ea8304ef8ad885b7f23))
* clean up only the changes that belong to the merged request ([28fa454](https://github.com/samuelba/ukemi/commit/28fa45412ce97940c9355d93979099f39ab96d0e))
* copy files into a divergent change, with no command in between ([7739e06](https://github.com/samuelba/ukemi/commit/7739e068023beaa1cecbbcc5235e54eddcc1b96c))
* do not undo a fetch or push from the undo command ([d7b6fb8](https://github.com/samuelba/ukemi/commit/d7b6fb8613f1aa5eb27b7774ba501c3ab7ad06b5))
* download the jj build for the platform Ukemi runs on ([ad32953](https://github.com/samuelba/ukemi/commit/ad3295348ac6573c50087d7bcd2108ee2850a02b))
* drop split choices whose hunks changed when the view reloads ([c4d5c5d](https://github.com/samuelba/ukemi/commit/c4d5c5d0a2f727328387d11bd0514ff62c54a231))
* end git and ssh too when a jj command times out ([d2618c5](https://github.com/samuelba/ukemi/commit/d2618c5a9dcc39bd82713cc0caa455610f6d337c))
* improve code quality ([6e61946](https://github.com/samuelba/ukemi/commit/6e61946e34027a4b64d4694034bac98988b9382f))
* keep each desktop window's active repository and views its own (F35) ([4100b1a](https://github.com/samuelba/ukemi/commit/4100b1ae5edac25a1b7fdd6c20d8ec3c0660a37f))
* keep jj's hints in error messages ([612f11b](https://github.com/samuelba/ukemi/commit/612f11be7341b10c1c0b3f73e2c9b25095e6e0af))
* keep settings and state when their JSON file does not parse ([7d2692d](https://github.com/samuelba/ukemi/commit/7d2692d2c547bd11a0f2c658fa625e82ab01a493))
* keep the Clean up choices when the view reloads after a refresh ([82be29f](https://github.com/samuelba/ukemi/commit/82be29f93b60d4e92db6bc13fc1a7064b6127363))
* keep the parent's description when squashing into an elided parent ([b1998ce](https://github.com/samuelba/ukemi/commit/b1998ce275fbd635a571751a9c7c5107a2727966))
* keep what the user typed while a file in the editor tab saves ([64c74d3](https://github.com/samuelba/ukemi/commit/64c74d3f5c66cc5dda0eddba5ccd979ff198d1fd))
* never delete the folder that holds the repository with a workspace ([f643b0a](https://github.com/samuelba/ukemi/commit/f643b0a9d47a2040277681a3aee213055dd83dfa))
* quit with an error box when the desktop app fails to start (F33) ([1e428ae](https://github.com/samuelba/ukemi/commit/1e428ae9798ab1f077ad48c11bbf0bc5511e7cc5))
* quote bookmark names that jj reads as revset expressions ([bfe9fdb](https://github.com/samuelba/ukemi/commit/bfe9fdbd832d366bc6bb73a2578bedde664e809a))
* read each refresh at one operation so a command in between is not missed ([fbd5984](https://github.com/samuelba/ukemi/commit/fbd5984e44217d1ecc96562ce18e9b3f7467a322))
* refresh pull and merge requests after a create or merge, even mid-refresh ([25b654f](https://github.com/samuelba/ukemi/commit/25b654f5f704ebfeb133a4ab7fbd1a1a90ebdb89))
* refresh when .gitignore or files under .github change in the app ([8a4d50d](https://github.com/samuelba/ukemi/commit/8a4d50d375cee0d44fdfc07d226a97a774a3622b))
* reload a crashed or hung desktop window and reattach its shells (F42) ([5ff6618](https://github.com/samuelba/ukemi/commit/5ff6618aa6d4ac179e4b7ed548fd4d76210a2984))
* report a failed desktop state write instead of an unhandled rejection (F38) ([33abd18](https://github.com/samuelba/ukemi/commit/33abd18b976ba9c0508a117e27ec7b5e88810315))
* report a failed fetch after shipping a request as a failed fetch ([ac27190](https://github.com/samuelba/ukemi/commit/ac27190dae906ca8cea018d2ef7cb14684b818f0))
* restore the old name too when discarding a renamed file ([1460e50](https://github.com/samuelba/ukemi/commit/1460e5022dc797b8ea47813e137c007aa8cae648))
* run commands on the change, not on a commit id from before a snapshot ([1068cc6](https://github.com/samuelba/ukemi/commit/1068cc6f1d8e40a9c75c42d8ac1084ecc483a147))
* share one GitLab sign-in redirect server between desktop windows (F36) ([7887251](https://github.com/samuelba/ukemi/commit/78872513af44b10968bd3f67738f27700be0fb69))
* show GitHub's GraphQL errors instead of a schema error ([c2471ec](https://github.com/samuelba/ukemi/commit/c2471ec592f32bf795cf15391fd068e521f983ed))
* show the warnings of jj commands that succeed ([38235d8](https://github.com/samuelba/ukemi/commit/38235d8e674ff0be04f23fcb627253e932e08247))
* skip graph reloads when a refresh records no new operation ([2ef10a2](https://github.com/samuelba/ukemi/commit/2ef10a2513d767f6530de71b75d3aa831f2b149c))
* spawn no orphan or second shell while a terminal starts (F37) ([f89c711](https://github.com/samuelba/ukemi/commit/f89c711d3111a2d922359cb84f5f99908b836144))
* split a merge commit against the merge of its parents ([803ad2c](https://github.com/samuelba/ukemi/commit/803ad2cbb7e05e22c02e784cdc103a83c64c17c1))
* stop the evolution view flickering on refreshes that change nothing ([84e1870](https://github.com/samuelba/ukemi/commit/84e18702b17f8b81a5f98d9c37c84041534e2db7))
* stop the jj timeout while a git sign-in prompt is open ([5bfbeb0](https://github.com/samuelba/ukemi/commit/5bfbeb01515ef67b4d15f898de0e693403565c01))
* tag log lines with the repository and copy them as one line ([6418f89](https://github.com/samuelba/ukemi/commit/6418f892244e33944ccc6c4a1faed31b20d27b12))
* tell a forge rate limit apart from an expired login ([3d09ad8](https://github.com/samuelba/ukemi/commit/3d09ad8b45e0728a766255b8069598223b787a4f))


### Performance Improvements

* diff large files in the app only when asked ([1a7f83e](https://github.com/samuelba/ukemi/commit/1a7f83e96736f62189d02d9301e232cd9d2414df))
* render only the graph rows that changed ([16cb842](https://github.com/samuelba/ukemi/commit/16cb842a8eb7ad35b3162fd44bfc1a77dc3607c8))
* run fewer jj processes per refresh ([90d379c](https://github.com/samuelba/ukemi/commit/90d379c18d37b4a5f3fef9e1c49770fc1d1c6fdb))

## [0.8.0](https://github.com/samuelba/ukemi/compare/v0.7.1...v0.8.0) (2026-10-31)


### Features

* stacked MRs/PRs ([6d68091](https://github.com/samuelba/ukemi/commit/6d680918835caf0c1ad3d8c4c66bbde200226f4f))
* support gh cli ([eb12445](https://github.com/samuelba/ukemi/commit/eb1244523f6e7b7f332869e003104c40d35e9541))


### Bug Fixes

* extension title, update images ([0e85a18](https://github.com/samuelba/ukemi/commit/0e85a18aaf2a7bce893f812d4754699e25e179e1))
* improve secrets handling ([38c7b2a](https://github.com/samuelba/ukemi/commit/38c7b2a30d51ad3ab0d98ce5597770cd43ffa097))
* opening panel layout ([6324625](https://github.com/samuelba/ukemi/commit/6324625e0142b9c98b9ae7249935bf3ad649a12a))
* update icons ([8483919](https://github.com/samuelba/ukemi/commit/8483919e1c66a1fedfc28ab86c7c5c96a449d553))

## [0.7.1](https://github.com/samuelba/ukemi/compare/v0.7.0...v0.7.1) (2026-10-30)


### Bug Fixes

* menu bleading from other extensions, add Advance Bookmark ([61933df](https://github.com/samuelba/ukemi/commit/61933dfdd7cd493a9fcf2c33d3307b39706172d9))

## [0.7.0](https://github.com/samuelba/ukemi/compare/v0.6.0...v0.7.0) (2026-10-30)


### Features

* rebase stack onto... ([e911638](https://github.com/samuelba/ukemi/commit/e9116383083b382e4189ae89865c3eceb8849e85))


### Bug Fixes

* create MR on slower GitLab ([5eda21e](https://github.com/samuelba/ukemi/commit/5eda21ea228ce032033dc23f34ab34b33d7347a8))
* homepage, readme ([5b50d57](https://github.com/samuelba/ukemi/commit/5b50d57202879200b768de737fcae82a29ed0adb))
* performance for larger repos ([70b73a9](https://github.com/samuelba/ukemi/commit/70b73a91cb16acafbaf18b410803ee4c32c2b8de))

## [0.6.0](https://github.com/samuelba/ukemi/compare/v0.5.1...v0.6.0) (2026-10-29)


### Features

* include author in release notes ([d5dee72](https://github.com/samuelba/ukemi/commit/d5dee72e74837e34c42568b219266a0c8392dc6e))
* replace animation with real logo ([5dc9f03](https://github.com/samuelba/ukemi/commit/5dc9f03fc15fbb07d078f08304f061ce06a67e3a))


### Bug Fixes

* merge MR on GitLab ([8019d24](https://github.com/samuelba/ukemi/commit/8019d24129035bd9e210ed91118105feb541a905))

## [0.5.1](https://github.com/samuelba/ukemi/compare/v0.5.0...v0.5.1) (2026-10-28)


### Bug Fixes

* opening log from Cursor ([a6c35af](https://github.com/samuelba/ukemi/commit/a6c35af5a5a5fef7cdbd8814cafad09230d47c27))

## [0.5.0](https://github.com/samuelba/ukemi/compare/v0.4.0...v0.5.0) (2026-10-28)


### Features

* choose target branch when creating a request ([719f2be](https://github.com/samuelba/ukemi/commit/719f2be901d2cb972ba776fef81c0e88c283e7e5))
* improve cleanup editor ([c8f14bc](https://github.com/samuelba/ukemi/commit/c8f14bc4428c3b8f8450bb570b3d011d97f75820))
* improve repo initialization ([38ad775](https://github.com/samuelba/ukemi/commit/38ad77536f9b5186610855e28dad2e071514ef04))
* merge conflict editor ([be0fc0a](https://github.com/samuelba/ukemi/commit/be0fc0a7fe7531c57fb5e8c2ff02672a64d49180))
* progress animation ([1faf8da](https://github.com/samuelba/ukemi/commit/1faf8dab8fb2b68bca85b19377a959ca48c792ea))
* rebase stack onto trunk ([7b9c070](https://github.com/samuelba/ukemi/commit/7b9c0709a215e80d7afde5fd9070253648697a98))


### Bug Fixes

* add CI badge, add urls to marketplaces to readme ([f8beb39](https://github.com/samuelba/ukemi/commit/f8beb39cec64a9f37c1ee7f60d21fdcc49456ae5))
* **graph:** open the context menu on the first right-click when the webview is unfocused ([69a71d4](https://github.com/samuelba/ukemi/commit/69a71d4f0b5aeed8d63455c4ff340d3c941ec45a))
* improve go-to action in toolbar ([8bf1e41](https://github.com/samuelba/ukemi/commit/8bf1e41c1665de313e31ce09be3bdff62dda3760))
* remove auto fetch menu entry ([1e1eb55](https://github.com/samuelba/ukemi/commit/1e1eb5530b52fa02189b592a423f4f6c5db394b7))
* removing a workspace, updates repo dropdown ([a3ccff5](https://github.com/samuelba/ukemi/commit/a3ccff53d21e0097431d2cffbb413f23244b560a))
* toolbar layout, align days dropdown on the left ([39d1624](https://github.com/samuelba/ukemi/commit/39d16246f74be58bcd3fdb290c11cddbc9430dbd))

## [0.4.0](https://github.com/samuelba/ukemi/compare/v0.3.0...v0.4.0) (2026-10-27)


### Features

* search filter for bookmarks panel ([53778c3](https://github.com/samuelba/ukemi/commit/53778c39be33f5295dbea3914cf651d84c3b1c28))
* setting for MR/PR status update frequency ([fd31a26](https://github.com/samuelba/ukemi/commit/fd31a26c3961b4e2e49cf6224afc51f78862c8c8))


### Bug Fixes

* settings link in Cursor ([c17ef5d](https://github.com/samuelba/ukemi/commit/c17ef5d436fe1619710c121789fee45ab2668970))

## [0.3.0](https://github.com/samuelba/ukemi/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* add deleted bookmarks and no descriptions commits to cleanup ([5ecea55](https://github.com/samuelba/ukemi/commit/5ecea5554882614dcfa4724f383addb74cba028d))
* bookmark panel ([513a69c](https://github.com/samuelba/ukemi/commit/513a69c6a3b3f5a358a667e6c9528d19fb03301d))
* improve bookmark panel, allow to track origin on local bookmark action ([d90a6e0](https://github.com/samuelba/ukemi/commit/d90a6e0f96fd9e5dbd46e95075d3a02b96dada23))
* move fetch sync toggle ([6f898be](https://github.com/samuelba/ukemi/commit/6f898bee1d50893f96a69424d5d64cf12a00bb35))
* rename to ukemi-jj ([7b37c19](https://github.com/samuelba/ukemi/commit/7b37c19864bc4d98e08ef0b40deac99032df6d76))
* update readme ([1199287](https://github.com/samuelba/ukemi/commit/119928709647aba15db0ec48455e7b4381f9b6bb))


### Bug Fixes

* drop merge commits from the release changelog ([ab16768](https://github.com/samuelba/ukemi/commit/ab1676817283a34d027302356890c33b08503302))
* **forge:** explain unknown remote hosts and scan all remotes ([e0d9cd3](https://github.com/samuelba/ukemi/commit/e0d9cd326aafa727f04e65f8c849e6db22025fac))
* go to bookmark, handle remote bookmarks better ([42216ce](https://github.com/samuelba/ukemi/commit/42216ce7a191f51c8fe3df546055cee91a8eac30))
* move settings gear on cursor ([cf0b710](https://github.com/samuelba/ukemi/commit/cf0b71021eed4a188b16099b09d8f242ba61cf8e))
* open Cursor settings filtered to Ukemi without freezing ([15f791b](https://github.com/samuelba/ukemi/commit/15f791bc420b675ea676713563c333986771c8f3))
* push all bookmarks, also push untracked new bookmarks ([d837f57](https://github.com/samuelba/ukemi/commit/d837f57d84719aebfddef7f3069b8c9662414120))

## [0.2.0](https://github.com/samuelba/ukemi/compare/v0.1.0...v0.2.0) (2026-10-27)


### Features

* add EVOLUTION panel and Working copy graph filter, rename changes to GRAPH ([9964262](https://github.com/samuelba/ukemi/commit/9964262d7158b84480994f0549b1ee27216cc51b))
* add graph and split webviews, manifest, icons and e2e test ([b9420c6](https://github.com/samuelba/ukemi/commit/b9420c68bc714d9ac989e4904986505790e734e3))
* add jj core, graph layout and repo discovery ([4972915](https://github.com/samuelba/ukemi/commit/4972915f76686ddd47a5d6b5dc3d93d7350d5845))
* add revert action to changed folders ([af52f14](https://github.com/samuelba/ukemi/commit/af52f1466b4a8638e4450411e5690f113009a685))
* add VS Code host with commands, diffs, SCM, forge and split ([2268eeb](https://github.com/samuelba/ukemi/commit/2268eeba91142bf73ebfee6ca6d1732511a4f42e))
* auto fetch with configurable interval ([2c8ddf6](https://github.com/samuelba/ukemi/commit/2c8ddf61477e7802c4ba91a08ff3835ac200f40c))
* changed file hover button to discard change ([80884c3](https://github.com/samuelba/ukemi/commit/80884c3d428a036bf7472c564589677b4d7545f9))
* changed file type icons ([119c776](https://github.com/samuelba/ukemi/commit/119c776d00d4524f468b442971e70123e71dae9d))
* changed files, as list or tree ([1421714](https://github.com/samuelba/ukemi/commit/14217149aec09e8681573698480420f47321f1c6))
* ci/cd, rename publisher, fix warnings ([cdd899c](https://github.com/samuelba/ukemi/commit/cdd899c38d341b0bebc2e5e8217484225b1d68a3))
* cleanup editor ([12e5149](https://github.com/samuelba/ukemi/commit/12e51490267c67f5af9bb6e56a0282998846dc9a))
* cloud icon with two arrows for push all tracked bookmarks ([4eafb16](https://github.com/samuelba/ukemi/commit/4eafb160978b47b641ad5201a4335b22c8aed927))
* commit hover button edit quick access ([b86c3d2](https://github.com/samuelba/ukemi/commit/b86c3d2c40a08157fa0020e5fcf5325d6b6f46bd))
* Ctrl + drag'n'drop commit to duplicate onto another, add duplicate onto to context menu ([a5cd95d](https://github.com/samuelba/ukemi/commit/a5cd95d6dc1836b89a1bd0913478b402bca284bf))
* drag'n'drop changes with Ctrl to copy ([1730f76](https://github.com/samuelba/ukemi/commit/1730f76f095a2a071362ac5addb5fe3c50334b14))
* empty batch on empty work copy ([811202d](https://github.com/samuelba/ukemi/commit/811202d3b5bfcf3a3c62d60001d42af91aae7d6d))
* evolution panel with version diffs and restore ([8ca5e3e](https://github.com/samuelba/ukemi/commit/8ca5e3e9cbf664e5b71eb1bd2f482bda10dd14f7))
* filter dropdown instead of filter buttons ([450f6f4](https://github.com/samuelba/ukemi/commit/450f6f4884caba0a9a1b1b0ecf5afbbd93735430))
* forge CI job status and GitLab OAuth/glab auth ([d6abb6e](https://github.com/samuelba/ukemi/commit/d6abb6eac68f9cfa50c4267fef98f35193b624ed))
* let users push to GitHub over HTTPS with a user name and token ([ab4f05f](https://github.com/samuelba/ukemi/commit/ab4f05f3d7186f68c1e40aa8054122738a6abeb4))
* line stats ([0d943ef](https://github.com/samuelba/ukemi/commit/0d943efedc03eaef0d19cc377c02e07907802b94))
* move repo label/dropdown to separate row ([1bbfb7e](https://github.com/samuelba/ukemi/commit/1bbfb7e98c513767e50ce77b01873c89c16c2116))
* push current bookmark, redo state, default filter, 14 days and settings button ([9bd4869](https://github.com/samuelba/ukemi/commit/9bd4869b018a1e1f5e86e78e4cc66256afd6462c))
* quick acces overlay button to squash into parent ([0b3787a](https://github.com/samuelba/ukemi/commit/0b3787a519c3a0097198507e57b9249a4dbb0a14))
* shortcut "new change from trunk" ([adb21fd](https://github.com/samuelba/ukemi/commit/adb21fd02b4ad97ba0bc7a2b877b2f29f9243f04))
* show/hide tags ([3b3aaa4](https://github.com/samuelba/ukemi/commit/3b3aaa478cfe939e367f7ca82134914c23ab208c))
* split Mine into Mine and My history filters ([8b12038](https://github.com/samuelba/ukemi/commit/8b12038a1393e8ae2c0606e3792c0eb2f4f1ab7d))
* sticky file headers in the split view ([d5c208a](https://github.com/samuelba/ukemi/commit/d5c208a93f8dbb352a9d150e18a9ae137d0c724d))
* submenu for duplicate and rebase in context menu ([db25d38](https://github.com/samuelba/ukemi/commit/db25d388c111027c651f113b1a6d4c28326602bb))
* sync-ignored icon when auto fetch is off ([18c1e98](https://github.com/samuelba/ukemi/commit/18c1e9892cd2f09b9999f966ea93530237547400))
* tinted file headers with coloured status in the split view ([a9bd56e](https://github.com/samuelba/ukemi/commit/a9bd56e90d2f065fe3eecd3b16317810c4e87e97))
* workspace panel and entry in context menu ([cbf01e7](https://github.com/samuelba/ukemi/commit/cbf01e7b11c907edae8ae3f59b71a3059bafbd44))


### Bug Fixes

* drag'n'drop files to the cursor chat ([665dce1](https://github.com/samuelba/ukemi/commit/665dce1debef069a89fd879c8ac481641ae68cc0))
* evolution icon ([6db22d3](https://github.com/samuelba/ukemi/commit/6db22d3be8c2375e025845dc9e02bbd6765adf41))
* icons ([5bd47b7](https://github.com/samuelba/ukemi/commit/5bd47b738fd3b953493bba1333da556967d339f8))
* loading animation width ([00ff77c](https://github.com/samuelba/ukemi/commit/00ff77c66d1c9f2e1fe11d3124301d386d60ab76))
* mark never-pushed bookmarks as unsynced, add CI and preview harness ([efc95fb](https://github.com/samuelba/ukemi/commit/efc95fb44589272ea0bb2f2c38f637bd3dd382eb))
* MR CI status badge style ([6259400](https://github.com/samuelba/ukemi/commit/62594004614f1e3209dba00f05fd8493339e09b9))
* remove double-click to edit commit ([09ffe6f](https://github.com/samuelba/ukemi/commit/09ffe6f5fefdd5288ae71ef07a6b9e789160ad6b))
* show the last 10 trunk commits in the recent filter ([17131c9](https://github.com/samuelba/ukemi/commit/17131c92a55fb268b5466f358df79161cd63d8cb))
* sign in to HTTPS remotes when pushing and fetching from Ukemi ([f8d7397](https://github.com/samuelba/ukemi/commit/f8d739798ac65fad7798b2a720392de9153309e2))
* skip virtual apt packages in the e2e job ([3b074ac](https://github.com/samuelba/ukemi/commit/3b074ac7c699d50a494c6c680a5912a0c300b996))
* stop the release PR failing format and e2e ([4592064](https://github.com/samuelba/ukemi/commit/45920640640b7f88c5ba9211c5be974c496d4e98))
* update actions ([94a5df5](https://github.com/samuelba/ukemi/commit/94a5df5c955deb405aa9c32801021f732aada0cb))

## 0.1.0

First release.

- Change graph with bookmarks, tags, workspaces, conflicts and pull/merge request badges.
- Drag and drop to rebase changes, move files and move bookmarks.
- Describe, new, edit, squash, split by hunks or files, abandon, duplicate and revert.
- Evolution panel: versions of a change, interdiff between versions, and restore.
- Fetch, push, undo and redo.
- GitHub pull requests and GitLab merge requests: create, status, CI, merge and clean-up.
- Repositories in subfolders and many repositories per workspace, with a repository dropdown.
- Downloads the official jj release when jj is not installed.
