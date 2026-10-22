import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/core/errors'
import { hashBytes } from '@/lib/core/manifest'
import { goodBundle, rawZip } from '../../../test/helpers/zip'
import { extractBundle, packBundle } from './archive'

/**
 * Extraction is a security boundary: it runs on a stranger's archive, before
 * any sandbox exists. These tests build real malicious archives rather than
 * asserting on a sanitized library's behaviour.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aya-archive-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.AYA_MAX_BUNDLE_FILES
  delete process.env.AYA_MAX_UNCOMPRESSED_BYTES
  delete process.env.AYA_MAX_UPLOAD_BYTES
})

describe('extractBundle — happy path', () => {
  it('extracts a well-formed bundle', async () => {
    const { manifest, root } = await extractBundle(goodBundle(), join(dir, 'out'))

    expect(manifest.files.map((f) => f.path)).toEqual([
      'challenge.yml',
      'release_files/output.txt',
      'server_files/generate.py',
      'solver/solve.py',
      'writeup.md',
    ])
    expect(root).toContain('out')

    const written = await readFile(join(root, 'release_files/output.txt'), 'utf8')
    expect(written).toBe('n = 1234\nc = 5678\n')
  })

  it('records true sizes and hashes', async () => {
    const content = 'n = 1234\nc = 5678\n'
    const { manifest } = await extractBundle(goodBundle(), join(dir, 'out'))
    const entry = manifest.files.find((f) => f.path === 'release_files/output.txt')
    expect(entry?.size).toBe(content.length)
    expect(entry?.sha256).toBe(hashBytes(content))
  })

  it('handles stored (uncompressed) entries', async () => {
    const zip = rawZip([{ name: 'a.txt', data: 'hello', store: true }])
    const { manifest } = await extractBundle(zip, join(dir, 'out'))
    expect(manifest.files[0]?.size).toBe(5)
  })

  it('normalizes paths on the way in', async () => {
    const zip = rawZip([{ name: './release_files//a.txt', data: 'x' }])
    const { manifest } = await extractBundle(zip, join(dir, 'out'))
    expect(manifest.files[0]?.path).toBe('release_files/a.txt')
  })

  it('skips directory entries', async () => {
    const zip = rawZip([
      { name: 'release_files/', data: '' },
      { name: 'release_files/a.txt', data: 'x' },
    ])
    const { manifest } = await extractBundle(zip, join(dir, 'out'))
    expect(manifest.files).toHaveLength(1)
  })
})

describe('extractBundle — refuses hostile archives', () => {
  async function expectRejected(zip: Buffer, matcher?: RegExp): Promise<void> {
    const promise = extractBundle(zip, join(dir, 'out'))
    await expect(promise).rejects.toThrow(AppError)
    if (matcher) await expect(promise).rejects.toThrow(matcher)
  }

  it('a path traversing out of the bundle', async () => {
    await expectRejected(rawZip([{ name: '../escaped.txt', data: 'x' }]), /Unsafe path/)
  })

  it('a deeper traversal', async () => {
    await expectRejected(
      rawZip([{ name: 'release_files/../../escaped.txt', data: 'x' }]),
      /Unsafe path/,
    )
  })

  it('a Windows-style traversal', async () => {
    await expectRejected(rawZip([{ name: '..\\escaped.txt', data: 'x' }]), /Unsafe path/)
  })

  it('an absolute path', async () => {
    await expectRejected(rawZip([{ name: '/etc/cron.d/evil', data: 'x' }]), /Unsafe path/)
  })

  it('a symlink', async () => {
    // 0o120777 is S_IFLNK. This is how a later innocent-looking write lands
    // outside the root.
    await expectRejected(
      rawZip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]),
      /symlink/,
    )
  })

  it('a symlink even when it is the second entry', async () => {
    await expectRejected(
      rawZip([
        { name: 'a.txt', data: 'fine' },
        { name: 'link', data: '../../etc', mode: 0o120777 },
      ]),
      /symlink/,
    )
  })

  it('a duplicate entry name', async () => {
    // The second write silently replaces what was validated as the first.
    await expectRejected(
      rawZip([
        { name: 'a.txt', data: 'first' },
        { name: 'a.txt', data: 'second' },
      ]),
      /more than once/,
    )
  })

  it('a Windows device name', async () => {
    await expectRejected(rawZip([{ name: 'release_files/con.txt', data: 'x' }]), /Unsafe path/)
  })

  it('an alternate data stream', async () => {
    await expectRejected(rawZip([{ name: 'notes.txt:hidden', data: 'x' }]), /Unsafe path/)
  })

  it('too many entries', async () => {
    process.env.AYA_MAX_BUNDLE_FILES = '3'
    const zip = rawZip(
      Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' })),
    )
    await expectRejected(zip, /entries; the limit is 3/)
  })

  it('an archive that expands past the cap', async () => {
    process.env.AYA_MAX_UNCOMPRESSED_BYTES = '100'
    const zip = rawZip([{ name: 'big.txt', data: 'A'.repeat(5_000) }])
    await expectRejected(zip)
  })

  it('a zip bomb — highly compressible content past the cap', async () => {
    process.env.AYA_MAX_UNCOMPRESSED_BYTES = '4096'
    // ~1 MiB of zeroes deflates to a few hundred bytes.
    const zip = rawZip([{ name: 'bomb.bin', data: Buffer.alloc(1024 * 1024, 0) }])
    await expectRejected(zip)
    // Nothing survived the refusal.
    await expect(stat(join(dir, 'out', 'bomb.bin'))).rejects.toThrow()
  })

  it('an upload larger than the accepted size', async () => {
    process.env.AYA_MAX_UPLOAD_BYTES = '10'
    await expectRejected(goodBundle(), /the limit is 10/)
  })

  it('data that is not a zip at all', async () => {
    await expectRejected(Buffer.from('this is not a zip'), /not a readable zip/)
  })

  it('an empty archive', async () => {
    await expectRejected(rawZip([]), /no files/)
  })

  it('an entry whose header lies about its size', async () => {
    const zip = rawZip([
      { name: 'a.txt', data: 'A'.repeat(10_000), declaredUncompressedSize: 5 },
    ])
    await expectRejected(zip)
  })
})

describe('packBundle', () => {
  it('produces a readable archive', async () => {
    const zip = await packBundle([
      { path: 'README.md', content: '# hello' },
      { path: 'release_files/a.txt', content: Buffer.from('data') },
    ])
    const { manifest, root } = await extractBundle(zip, join(dir, 'round-trip'))
    expect(manifest.files.map((f) => f.path)).toEqual(['README.md', 'release_files/a.txt'])
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# hello')
  })

  it('is byte-identical for identical input', async () => {
    // The delivery hash has to be a fingerprint of the content, not of the clock.
    const entries = [{ path: 'a.txt', content: 'same' }]
    const first = await packBundle(entries)
    await new Promise((r) => setTimeout(r, 20))
    const second = await packBundle(entries)
    expect(first.equals(second)).toBe(true)
  })

  it('does not depend on input ordering', async () => {
    const a = await packBundle([
      { path: 'a.txt', content: '1' },
      { path: 'b.txt', content: '2' },
    ])
    const b = await packBundle([
      { path: 'b.txt', content: '2' },
      { path: 'a.txt', content: '1' },
    ])
    expect(a.equals(b)).toBe(true)
  })

  it('refuses an unsafe path', async () => {
    await expect(packBundle([{ path: '../evil', content: 'x' }])).rejects.toThrow()
  })

  it('refuses an entry with neither content nor source', async () => {
    await expect(packBundle([{ path: 'a.txt' }])).rejects.toThrow(AppError)
  })
})
