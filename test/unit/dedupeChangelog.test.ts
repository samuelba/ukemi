import { describe, expect, test } from 'vitest'
import { omitMergeCommitEntries } from '../../scripts/dedupeChangelog'

const notes = `## [0.3.0](https://github.com/samuelba/ukemi/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* rename to ukemi-jj ([4424f41](https://github.com/samuelba/ukemi/commit/4424f4131dcbf431ef50329221766f7ef41d0f6d))
* rename to ukemi-jj ([7b37c19](https://github.com/samuelba/ukemi/commit/7b37c19864bc4d98e08ef0b40deac99032df6d76))


### Bug Fixes

* **forge:** explain unknown remote hosts and scan all remotes ([e2c3579](https://github.com/samuelba/ukemi/commit/e2c3579a6cdbb7db6e6b19338b3a5df9b31e8c38))
* **forge:** explain unknown remote hosts and scan all remotes ([e0d9cd3](https://github.com/samuelba/ukemi/commit/e0d9cd326aafa727f04e65f8c849e6db22025fac))
* move settings gear on cursor ([7e93d60](https://github.com/samuelba/ukemi/commit/7e93d60276a7a94f451f5a31b0375b7a1d940d53))
* move settings gear on cursor ([cf0b710](https://github.com/samuelba/ukemi/commit/cf0b71021eed4a188b16099b09d8f242ba61cf8e))
* open Cursor settings filtered to Ukemi without freezing ([0d5e3bc](https://github.com/samuelba/ukemi/commit/0d5e3bc5b805570f6bcef5f5b8f2c21fe5a83904))
* open Cursor settings filtered to Ukemi without freezing ([15f791b](https://github.com/samuelba/ukemi/commit/15f791bc420b675ea676713563c333986771c8f3))

---
This PR was generated with Release Please.
`

describe('omitMergeCommitEntries', () => {
  test('drops merge commits from the release notes and keeps the branch commits', () => {
    const mergeShas = new Set([
      '4424f4131dcbf431ef50329221766f7ef41d0f6d',
      'e2c3579a6cdbb7db6e6b19338b3a5df9b31e8c38',
      '7e93d60276a7a94f451f5a31b0375b7a1d940d53',
      '0d5e3bc5b805570f6bcef5f5b8f2c21fe5a83904',
    ])

    const filtered = omitMergeCommitEntries(notes, mergeShas)

    expect(filtered)
      .toBe(`## [0.3.0](https://github.com/samuelba/ukemi/compare/v0.2.0...v0.3.0) (2026-10-27)


### Features

* rename to ukemi-jj ([7b37c19](https://github.com/samuelba/ukemi/commit/7b37c19864bc4d98e08ef0b40deac99032df6d76))


### Bug Fixes

* **forge:** explain unknown remote hosts and scan all remotes ([e0d9cd3](https://github.com/samuelba/ukemi/commit/e0d9cd326aafa727f04e65f8c849e6db22025fac))
* move settings gear on cursor ([cf0b710](https://github.com/samuelba/ukemi/commit/cf0b71021eed4a188b16099b09d8f242ba61cf8e))
* open Cursor settings filtered to Ukemi without freezing ([15f791b](https://github.com/samuelba/ukemi/commit/15f791bc420b675ea676713563c333986771c8f3))

---
This PR was generated with Release Please.
`)
    expect(omitMergeCommitEntries(filtered, mergeShas)).toBe(filtered)
  })

  test('drops an empty section and keeps two commits that share a subject', () => {
    const shared = `## 1.2.0

### Features

* same subject ([aaa](https://github.com/samuelba/ukemi/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))
* same subject ([bbb](https://github.com/samuelba/ukemi/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb))

### Bug Fixes

* only the merge ([ccc](https://github.com/samuelba/ukemi/commit/cccccccccccccccccccccccccccccccccccccccc))

---
footer
`

    expect(omitMergeCommitEntries(shared, new Set(['cccccccccccccccccccccccccccccccccccccccc'])))
      .toBe(`## 1.2.0

### Features

* same subject ([aaa](https://github.com/samuelba/ukemi/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))
* same subject ([bbb](https://github.com/samuelba/ukemi/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb))

---
footer
`)
  })
})
