import { describe, expect, it } from 'vitest'
import {
  buildManifest,
  computeBundleHash,
  filesUnder,
  hasFile,
  hashBytes,
  publicFileManifest,
  type BundleFile,
} from './manifest'

function file(path: string, content = 'x'): BundleFile {
  return { path, size: content.length, sha256: hashBytes(content) }
}

const FILES = [
  file('challenge.yml', 'name: x'),
  file('release_files/output.txt', 'ciphertext'),
  file('server_files/generate.py', 'secret'),
  file('solver/solve.py', 'solve'),
  file('writeup.md', 'how'),
]

describe('computeBundleHash', () => {
  it('is stable regardless of input order', () => {
    const a = computeBundleHash(FILES)
    const b = computeBundleHash([...FILES].reverse())
    expect(a).toBe(b)
  })

  it('changes when a file’s contents change', () => {
    const changed = FILES.map((f) =>
      f.path === 'release_files/output.txt' ? file(f.path, 'different') : f,
    )
    expect(computeBundleHash(changed)).not.toBe(computeBundleHash(FILES))
  })

  it('changes when two files swap names', () => {
    // Contents are identical as a multiset; only the pairing changed. This is
    // the case a contents-only hash would miss.
    const swapped = [
      file('a.txt', 'one'),
      file('b.txt', 'two'),
    ]
    const reswapped = [
      file('a.txt', 'two'),
      file('b.txt', 'one'),
    ]
    expect(computeBundleHash(swapped)).not.toBe(computeBundleHash(reswapped))
  })

  it('changes when a file is added or removed', () => {
    expect(computeBundleHash(FILES.slice(0, 4))).not.toBe(computeBundleHash(FILES))
    expect(computeBundleHash([...FILES, file('extra.txt')])).not.toBe(computeBundleHash(FILES))
  })

  it('is not confusable by a path containing the delimiter', () => {
    const a = [file('a\0b', 'x')]
    const b = [file('a', 'b')]
    expect(computeBundleHash(a)).not.toBe(computeBundleHash(b))
  })
})

describe('buildManifest', () => {
  it('sorts files and totals their bytes', () => {
    const manifest = buildManifest([...FILES].reverse())
    expect(manifest.files.map((f) => f.path)).toEqual([
      'challenge.yml',
      'release_files/output.txt',
      'server_files/generate.py',
      'solver/solve.py',
      'writeup.md',
    ])
    expect(manifest.totalBytes).toBe(FILES.reduce((n, f) => n + f.size, 0))
  })
})

describe('queries', () => {
  const manifest = buildManifest(FILES)

  it('finds files under a prefix', () => {
    expect(filesUnder(manifest, 'release_files').map((f) => f.path)).toEqual([
      'release_files/output.txt',
    ])
  })

  it('does not match a prefix that is only a string prefix', () => {
    const m = buildManifest([file('release_files_backup/x'), file('release_files/y')])
    expect(filesUnder(m, 'release_files').map((f) => f.path)).toEqual(['release_files/y'])
  })

  it('checks for an exact file', () => {
    expect(hasFile(manifest, 'writeup.md')).toBe(true)
    expect(hasFile(manifest, 'writeup')).toBe(false)
  })
})

describe('publicFileManifest', () => {
  const manifest = buildManifest(FILES)

  it('exposes only release files, stripped of their prefix', () => {
    expect(publicFileManifest(manifest)).toEqual([{ path: 'output.txt', size: 'ciphertext'.length }])
  })

  it('never leaks the solver, the writeup, or server files', () => {
    const paths = publicFileManifest(manifest).map((f) => f.path)
    expect(paths.some((p) => p.includes('solve'))).toBe(false)
    expect(paths.some((p) => p.includes('generate'))).toBe(false)
    expect(paths.some((p) => p.includes('writeup'))).toBe(false)
  })

  it('exposes no hashes or contents', () => {
    for (const entry of publicFileManifest(manifest)) {
      expect(Object.keys(entry).sort()).toEqual(['path', 'size'])
    }
  })
})
