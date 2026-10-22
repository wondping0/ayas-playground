import { describe, expect, it } from 'vitest'
import { assertWithinRoot, isSafeBundlePath, normalizeBundlePath, UnsafePathError } from './safe-path'

describe('normalizeBundlePath', () => {
  it('normalizes ordinary paths', () => {
    expect(normalizeBundlePath('release_files/chall.py')).toBe('release_files/chall.py')
    expect(normalizeBundlePath('./release_files/./out.txt')).toBe('release_files/out.txt')
    expect(normalizeBundlePath('release_files//out.txt')).toBe('release_files/out.txt')
  })

  it('treats a backslash as a separator, not a literal', () => {
    // A Windows-authored archive must not smuggle traversal past a `../` check.
    expect(normalizeBundlePath('release_files\\chall.py')).toBe('release_files/chall.py')
    expect(() => normalizeBundlePath('release_files\\..\\..\\evil')).toThrow(UnsafePathError)
  })

  describe('rejects', () => {
    it.each([
      ['traversal', '../etc/passwd'],
      ['nested traversal', 'release_files/../../etc/passwd'],
      ['absolute posix', '/etc/passwd'],
      ['drive letter', 'C:/Windows/System32/evil'],
      ['drive letter backslash', 'C:\\Windows\\evil'],
      ['empty', ''],
      ['dot only', '.'],
      ['null byte', 'release_files/a\0b'],
      ['control character', 'release_files/a\x01b'],
      ['alternate data stream', 'release_files/notes.txt:hidden'],
      ['trailing dot', 'release_files/evil.'],
      ['trailing space', 'release_files/evil '],
      ['reserved CON', 'CON'],
      ['reserved con.txt', 'release_files/con.txt'],
      ['reserved NUL nested', 'a/nul'],
      ['reserved COM1', 'com1.py'],
      ['reserved LPT9 uppercase', 'release_files/LPT9.dat'],
    ])('%s', (_label, value) => {
      expect(() => normalizeBundlePath(value)).toThrow(UnsafePathError)
      expect(isSafeBundlePath(value)).toBe(false)
    })

    it('a path that is too long', () => {
      expect(() => normalizeBundlePath('a'.repeat(201))).toThrow(UnsafePathError)
    })

    it('a segment that is too long', () => {
      expect(() => normalizeBundlePath(`release_files/${'a'.repeat(101)}`)).toThrow(UnsafePathError)
    })

    it('a path that is too deep', () => {
      expect(() => normalizeBundlePath(Array(14).fill('a').join('/'))).toThrow(UnsafePathError)
    })
  })

  it('allows a name that merely contains a reserved word', () => {
    expect(normalizeBundlePath('release_files/console.py')).toBe('release_files/console.py')
    expect(normalizeBundlePath('release_files/nullify.py')).toBe('release_files/nullify.py')
  })
})

describe('assertWithinRoot', () => {
  it('accepts a path inside the root', () => {
    expect(() => assertWithinRoot('/data/run1', '/data/run1/release_files/a.py')).not.toThrow()
    expect(() => assertWithinRoot('/data/run1', '/data/run1')).not.toThrow()
  })

  it('rejects a sibling directory sharing a prefix', () => {
    // `/data/run10` must not pass a check for `/data/run1`.
    expect(() => assertWithinRoot('/data/run1', '/data/run10/evil')).toThrow(UnsafePathError)
  })

  it('rejects an escape', () => {
    expect(() => assertWithinRoot('/data/run1', '/etc/passwd')).toThrow(UnsafePathError)
  })

  it('normalizes Windows separators on both sides', () => {
    expect(() =>
      assertWithinRoot('C:\\data\\run1', 'C:\\data\\run1\\release_files\\a.py'),
    ).not.toThrow()
    expect(() => assertWithinRoot('C:\\data\\run1', 'C:\\data\\other\\a.py')).toThrow(
      UnsafePathError,
    )
  })
})
