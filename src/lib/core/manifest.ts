import { createHash } from 'node:crypto'

/**
 * The file listing of a bundle, and the hash that a verification binds to.
 */

export interface BundleFile {
  /** Normalized, relative, POSIX. See safe-path.ts. */
  path: string
  size: number
  sha256: string
}

export interface BundleManifest {
  files: readonly BundleFile[]
  totalBytes: number
  /** Content hash of the whole bundle. */
  bundleHash: string
}

export function hashBytes(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Hash the bundle as a *set of paths and contents*, so the hash is stable
 * across archive ordering, timestamps, and compression settings — none of which
 * change what the challenge is.
 *
 * A verification records this hash. If the bundle changes, the hash changes,
 * the verification no longer matches, and the listing unpublishes. That chain
 * only works if the hash covers paths as well as contents: swapping two files'
 * names changes the challenge without changing any file's bytes.
 */
export function computeBundleHash(files: readonly BundleFile[]): string {
  const hash = createHash('sha256')
  hash.update('aya.bundle.v1\n')
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const file of sorted) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\n')
  }
  return hash.digest('hex')
}

export function buildManifest(files: readonly BundleFile[]): BundleManifest {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    files: sorted,
    totalBytes: sorted.reduce((sum, f) => sum + f.size, 0),
    bundleHash: computeBundleHash(sorted),
  }
}

/** Files under a directory prefix, e.g. `release_files/`. */
export function filesUnder(manifest: BundleManifest, prefix: string): readonly BundleFile[] {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`
  return manifest.files.filter((f) => f.path.startsWith(normalized))
}

export function hasFile(manifest: BundleManifest, path: string): boolean {
  return manifest.files.some((f) => f.path === path)
}

/**
 * What a buyer sees before purchasing: names and sizes, never contents.
 *
 * Server files, the solver, and the writeup are excluded outright — their
 * *existence* is signalled separately, but a filename like
 * `server_files/generate_rsa_with_shared_prime.py` gives the challenge away.
 */
export function publicFileManifest(
  manifest: BundleManifest,
): Array<{ path: string; size: number }> {
  return manifest.files
    .filter((f) => f.path.startsWith('release_files/'))
    .map((f) => ({ path: f.path.slice('release_files/'.length), size: f.size }))
}
