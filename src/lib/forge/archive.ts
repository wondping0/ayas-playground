import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { bundleLimits } from '@/lib/core/config'
import { AppError } from '@/lib/core/errors'
import { buildManifest, type BundleFile, type BundleManifest } from '@/lib/core/manifest'
import { assertWithinRoot, normalizeBundlePath } from '@/lib/core/safe-path'

/**
 * Archive handling.
 *
 * An uploaded bundle is a zip from a stranger, and extraction happens *before*
 * any sandbox exists — so this is a security boundary in its own right, not a
 * utility. Every check runs against the entry as read from the central
 * directory, before a byte is written.
 *
 * See the archive rules in .wondev/memory/security-guardrails.md.
 */

const UNIX_MODE_MASK = 0o170000
const UNIX_SYMLINK = 0o120000

function unsafe(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('bundle_unsafe_archive', message, details ? { details } : {})
}

function openZip(data: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        rejectPromise(new AppError('bundle_invalid', 'The upload is not a readable zip archive.'))
        return
      }
      resolvePromise(zipfile)
    })
  })
}

function isDirectoryEntry(entry: yauzl.Entry): boolean {
  return entry.fileName.endsWith('/')
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const unixMode = entry.externalFileAttributes >>> 16
  return (unixMode & UNIX_MODE_MASK) === UNIX_SYMLINK
}

/** Hashes and counts bytes as they stream past, so nothing is buffered twice. */
class Measure extends Transform {
  private readonly hash = createHash('sha256')
  bytes = 0

  constructor(private readonly cap: number) {
    super()
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error) => void,
  ): void {
    this.bytes += chunk.length
    if (this.bytes > this.cap) {
      // The header lied about uncompressed size. Stop at the cap rather than
      // discovering the real size by filling the disk.
      done(unsafe('A bundle entry is larger than its declared size.'))
      return
    }
    this.hash.update(chunk)
    this.push(chunk)
    done()
  }

  digest(): string {
    return this.hash.digest('hex')
  }
}

export interface ExtractedBundle {
  manifest: BundleManifest
  /** Absolute path of the directory the bundle was written to. */
  root: string
}

/**
 * Extract an uploaded zip into `destDir`, safely.
 *
 * Returns a manifest of what landed. The caller gets normalized paths and can
 * rely on every one of them being inside `destDir`.
 */
export async function extractBundle(data: Buffer, destDir: string): Promise<ExtractedBundle> {
  const maxUpload = bundleLimits.maxUploadBytes()
  const maxUncompressed = bundleLimits.maxUncompressedBytes()
  const maxFiles = bundleLimits.maxFiles()

  if (data.length > maxUpload) {
    throw new AppError(
      'bundle_too_large',
      `The upload is ${data.length} bytes; the limit is ${maxUpload}.`,
    )
  }

  const root = resolve(destDir)
  await mkdir(root, { recursive: true })

  const zipfile = await openZip(data)

  if (zipfile.entryCount > maxFiles) {
    zipfile.close()
    throw unsafe(`The archive has ${zipfile.entryCount} entries; the limit is ${maxFiles}.`, {
      entryCount: zipfile.entryCount,
      limit: maxFiles,
    })
  }

  const files: BundleFile[] = []
  const seen = new Set<string>()
  let declaredTotal = 0
  let writtenTotal = 0

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const fail = (error: unknown) => {
      zipfile.close()
      rejectPromise(error)
    }

    // yauzl rejects traversal and absolute names itself, before an entry is
    // ever emitted. That is a second line of defence, not a replacement for
    // normalizeBundlePath — but when it fires first, the refusal should still
    // be reported as the path problem it is rather than as a corrupt file.
    zipfile.on('error', (error: Error) => {
      const message = error?.message ?? ''
      fail(
        /path|filename/i.test(message)
          ? unsafe(`Unsafe path in bundle: ${message}`, { reason: message })
          : new AppError('bundle_invalid', 'The zip archive is corrupt.'),
      )
    })
    zipfile.on('end', () => resolvePromise())

    zipfile.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        try {
          if (isDirectoryEntry(entry)) {
            zipfile.readEntry()
            return
          }

          // A symlink is how a lexically-innocent path lands outside the root.
          if (isSymlinkEntry(entry)) {
            throw unsafe(`The archive contains a symlink: ${entry.fileName}`, {
              path: entry.fileName,
            })
          }

          const path = normalizeBundlePath(entry.fileName)

          if (seen.has(path)) {
            // Two entries writing the same path: the second silently replaces
            // what was validated as the first. Refuse rather than pick one.
            throw unsafe(`The archive contains "${path}" more than once.`, { path })
          }
          seen.add(path)

          declaredTotal += entry.uncompressedSize
          if (declaredTotal > maxUncompressed) {
            throw unsafe(
              `The archive expands to more than ${maxUncompressed} bytes.`,
              { limit: maxUncompressed },
            )
          }

          const target = resolve(join(root, path))
          assertWithinRoot(root, target)
          await mkdir(dirname(target), { recursive: true })

          const remaining = maxUncompressed - writtenTotal
          const measure = new Measure(remaining)

          const readStream = await new Promise<NodeJS.ReadableStream>((res, rej) => {
            zipfile.openReadStream(entry, (error, stream) => {
              if (error || !stream) {
                rej(new AppError('bundle_invalid', `Could not read "${path}" from the archive.`))
                return
              }
              res(stream)
            })
          })

          await pipeline(readStream, measure, createWriteStream(target))

          writtenTotal += measure.bytes
          files.push({ path, size: measure.bytes, sha256: measure.digest() })

          zipfile.readEntry()
        } catch (error) {
          // A stream-level failure (a lying size header, a truncated entry)
          // arrives as a plain Error. It is still a bad archive, not a bug.
          fail(
            error instanceof AppError
              ? error
              : new AppError('bundle_invalid', 'The archive could not be read.', { cause: error }),
          )
        }
      })()
    })

    zipfile.readEntry()
  })

  if (files.length === 0) {
    throw new AppError('bundle_invalid', 'The archive contains no files.')
  }

  return { manifest: buildManifest(files), root }
}

export interface PackEntry {
  path: string
  /** Either raw content, or a path on disk to read from. */
  content?: Buffer | string
  sourcePath?: string
}

/**
 * Build the zip a buyer downloads.
 *
 * Timestamps are pinned so two deliveries of the same challenge with the same
 * flag produce byte-identical archives — which is what makes the delivery hash
 * meaningful as a fingerprint rather than a function of the clock.
 */
export async function packBundle(entries: readonly PackEntry[]): Promise<Buffer> {
  // `async` matters: the validation below throws, and a caller awaiting this
  // should get a rejected promise rather than a synchronous throw.
  const zip = new yazl.ZipFile()
  const mtime = new Date(0)

  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const path = normalizeBundlePath(entry.path)
    if (entry.sourcePath !== undefined) {
      zip.addFile(entry.sourcePath, path, { mtime, mode: 0o644 })
    } else if (entry.content !== undefined) {
      const buffer = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content)
      zip.addBuffer(buffer, path, { mtime, mode: 0o644 })
    } else {
      throw new AppError('internal', `Pack entry "${path}" has neither content nor sourcePath.`)
    }
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('error', rejectPromise)
    zip.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)))
    zip.end()
  })
}
