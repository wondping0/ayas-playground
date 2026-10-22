import { isAbsolute, join, resolve } from 'node:path'
import { storageConfig } from './config'

/**
 * Where the app keeps things on disk.
 *
 * Lives in `core` because both the store (blobs) and the forge (run
 * directories) need it, and a plane never imports another plane.
 */

export function dataRoot(): string {
  const configured = storageConfig.dataDir()
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
}

/** Sandbox scratch. Everything here is transient. */
export function runsRoot(): string {
  return join(dataRoot(), 'runs')
}

/** Uploaded challenge bundles, keyed by version. */
export function bundlesRoot(): string {
  return join(dataRoot(), 'bundles')
}

/** Built per-order deliverables. */
export function artifactsRoot(): string {
  return join(dataRoot(), 'artifacts')
}
