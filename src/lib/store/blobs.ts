import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { artifactsRoot, bundlesRoot } from '@/lib/core/paths'
import { AppError } from '@/lib/core/errors'
import { assertWithinRoot } from '@/lib/core/safe-path'

/**
 * Blob storage for uploaded bundles and built artifacts.
 *
 * Keys are server-generated (they are ids), but they are checked against their
 * root anyway: a key that reached here from a request body would otherwise be
 * a path traversal, and "it can't happen today" is not a control.
 */

const KEY = /^[A-Za-z0-9_\-.]{1,120}$/

function pathFor(root: string, key: string): string {
  if (!KEY.test(key)) {
    throw new AppError('validation_failed', `Invalid storage key: ${key}`)
  }
  const target = resolve(join(root, key))
  assertWithinRoot(resolve(root), target)
  return target
}

async function put(root: string, key: string, data: Buffer): Promise<string> {
  const target = pathFor(root, key)
  await mkdir(root, { recursive: true })
  await writeFile(target, data)
  return key
}

async function get(root: string, key: string, what: string): Promise<Buffer> {
  try {
    return await readFile(pathFor(root, key))
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError('not_found', `${what} is no longer available.`, { cause })
  }
}

export function bundleKey(versionId: string): string {
  return `${versionId}.zip`
}

export function artifactKey(orderId: string): string {
  return `${orderId}.zip`
}

export const bundles = {
  put: (key: string, data: Buffer) => put(bundlesRoot(), key, data),
  get: (key: string) => get(bundlesRoot(), key, 'The challenge bundle'),
  remove: async (key: string) => {
    await rm(pathFor(bundlesRoot(), key), { force: true })
  },
}

export const artifacts = {
  put: (key: string, data: Buffer) => put(artifactsRoot(), key, data),
  get: (key: string) => get(artifactsRoot(), key, 'The download'),
  remove: async (key: string) => {
    await rm(pathFor(artifactsRoot(), key), { force: true })
  },
}
