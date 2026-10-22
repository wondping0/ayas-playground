import { AppError } from './errors'

/**
 * Path safety for untrusted archive entries.
 *
 * A bundle is a zip uploaded by a stranger, and the first thing that touches it
 * is extraction — before any sandbox is involved. Every check here runs against
 * the entry name *as read from the archive*, before a single byte is written.
 *
 * This runs on Windows as well as Linux, so the Windows-specific rules are not
 * optional: a `CON` or `a:b` entry is harmless on Linux and is a device handle
 * or an alternate data stream on Windows.
 */

const MAX_PATH_LENGTH = 200
const MAX_SEGMENTS = 12

/** Windows device names, which resolve regardless of directory or extension. */
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export class UnsafePathError extends AppError {
  constructor(path: string, reason: string) {
    super('bundle_unsafe_archive', `Unsafe path in bundle: ${reason}`, {
      details: { path: path.slice(0, MAX_PATH_LENGTH), reason },
    })
    this.name = 'UnsafePathError'
  }
}

/**
 * Normalize an archive entry to a safe relative POSIX path, or throw.
 *
 * Returns the normalized path; callers must use the returned value rather than
 * the input, since normalization is part of the check.
 */
export function normalizeBundlePath(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UnsafePathError(String(raw), 'empty path')
  }
  if (raw.length > MAX_PATH_LENGTH) {
    throw new UnsafePathError(raw, `longer than ${MAX_PATH_LENGTH} characters`)
  }
  if (raw.includes('\0')) {
    throw new UnsafePathError(raw, 'contains a null byte')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) {
    throw new UnsafePathError(raw, 'contains a control character')
  }

  // Treat backslash as a separator rather than a literal, so a Windows-authored
  // archive cannot smuggle `..\..` past a check that only looks for `../`.
  const unified = raw.replace(/\\/g, '/')

  if (unified.startsWith('/')) {
    throw new UnsafePathError(raw, 'absolute path')
  }
  if (/^[A-Za-z]:/.test(unified)) {
    throw new UnsafePathError(raw, 'drive-letter path')
  }

  const segments = unified.split('/').filter((s) => s !== '' && s !== '.')

  if (segments.length === 0) {
    throw new UnsafePathError(raw, 'resolves to nothing')
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new UnsafePathError(raw, `deeper than ${MAX_SEGMENTS} directories`)
  }

  for (const segment of segments) {
    if (segment === '..') {
      throw new UnsafePathError(raw, 'traverses outside the bundle')
    }
    if (segment.includes(':')) {
      throw new UnsafePathError(raw, 'contains a colon (alternate data stream)')
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      // Windows silently strips these, so `evil.txt.` and `evil.txt` collide.
      throw new UnsafePathError(raw, 'segment ends with a dot or space')
    }
    if (WINDOWS_RESERVED.test(segment)) {
      throw new UnsafePathError(raw, `reserved device name "${segment}"`)
    }
    if (segment.length > 100) {
      throw new UnsafePathError(raw, 'segment longer than 100 characters')
    }
  }

  return segments.join('/')
}

export function isSafeBundlePath(raw: string): boolean {
  try {
    normalizeBundlePath(raw)
    return true
  } catch {
    return false
  }
}

/**
 * Confirm a resolved absolute path is still inside its root.
 *
 * The lexical check above is the primary control; this is the second one, run
 * after resolution, because a symlink created earlier in the same extraction
 * can make a lexically-innocent path land outside the root.
 */
export function assertWithinRoot(root: string, resolved: string): void {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedTarget = resolved.replace(/\\/g, '/')
  const isInside =
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  if (!isInside) {
    throw new UnsafePathError(resolved, 'resolves outside the bundle root')
  }
}
