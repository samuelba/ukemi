import { describe, expect, test } from 'vitest'
import type { ChangedFile } from '../../shared/model'
import { buildFileTree, changedPathsInDirectory } from '../../shared/fileTree'

function file(path: string, sourcePath = path): ChangedFile {
  return { path, sourcePath, status: 'modified', isConflicted: false }
}

describe('buildFileTree', () => {
  test('nests a file under its folders', () => {
    expect(buildFileTree([file('src/a.ts'), file('src/sub/b.ts')])).toEqual([
      {
        kind: 'dir',
        name: 'src',
        path: 'src',
        children: [
          {
            kind: 'dir',
            name: 'sub',
            path: 'src/sub',
            children: [{ kind: 'file', name: 'b.ts', file: file('src/sub/b.ts') }],
          },
          { kind: 'file', name: 'a.ts', file: file('src/a.ts') },
        ],
      },
    ])
  })

  test('keeps two files in one folder as siblings', () => {
    expect(buildFileTree([file('src/a.ts'), file('src/b.ts')])).toEqual([
      {
        kind: 'dir',
        name: 'src',
        path: 'src',
        children: [
          { kind: 'file', name: 'a.ts', file: file('src/a.ts') },
          { kind: 'file', name: 'b.ts', file: file('src/b.ts') },
        ],
      },
    ])
  })

  test('compacts a chain of single-child folders', () => {
    expect(buildFileTree([file('src/vscode/graphView.ts')])).toEqual([
      {
        kind: 'dir',
        name: 'src/vscode',
        path: 'src/vscode',
        children: [{ kind: 'file', name: 'graphView.ts', file: file('src/vscode/graphView.ts') }],
      },
    ])
  })

  test('leaves a root file at the top level', () => {
    expect(buildFileTree([file('README.md')])).toEqual([
      { kind: 'file', name: 'README.md', file: file('README.md') },
    ])
  })

  test('places a rename under the destination path', () => {
    const renamed = {
      ...file('new/name.ts'),
      sourcePath: 'old/name.ts',
      status: 'renamed' as const,
    }
    expect(buildFileTree([renamed])).toEqual([
      {
        kind: 'dir',
        name: 'new',
        path: 'new',
        children: [{ kind: 'file', name: 'name.ts', file: renamed }],
      },
    ])
  })
})

describe('changedPathsInDirectory', () => {
  const files = [
    file('src/a.ts'),
    file('src/sub/b.ts'),
    file('src2/a.ts'),
    file('README.md'),
    file('src/vscode/graphView.ts'),
  ]

  test('keeps files under the directory and skips a sibling prefix', () => {
    expect(changedPathsInDirectory(files, 'src')).toEqual([
      'src/a.ts',
      'src/sub/b.ts',
      'src/vscode/graphView.ts',
    ])
  })

  test('matches a compacted folder path', () => {
    expect(changedPathsInDirectory(files, 'src/vscode')).toEqual(['src/vscode/graphView.ts'])
  })

  test('uses the destination of a rename', () => {
    const renamed = { ...file('new/name.ts'), sourcePath: 'old/name.ts' }
    expect(changedPathsInDirectory([renamed], 'new')).toEqual(['new/name.ts'])
    expect(changedPathsInDirectory([renamed], 'old')).toEqual([])
  })

  test('matches nothing for an empty directory', () => {
    expect(changedPathsInDirectory(files, '')).toEqual([])
  })
})
