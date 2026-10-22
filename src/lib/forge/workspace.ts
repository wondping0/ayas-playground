import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { newId } from '@/lib/core/ids'
import { artifactsRoot, bundlesRoot, dataRoot, runsRoot } from '@/lib/core/paths'

/**
 * Per-run scratch directories.
 *
 * Every sandbox run gets a fresh pair of directories under a dedicated root and
 * loses them afterwards, on the success, failure, and timeout paths alike. A
 * run directory that outlives its run is a place for the next tenant's code to
 * find the previous tenant's flag.
 */

export interface Workspace {
  runId: string
  root: string
  /** Mounted read-only at /work. */
  workDir: string
  /** Mounted read-write at /out. */
  outDir: string
  dispose(): Promise<void>
}

export { artifactsRoot, bundlesRoot, dataRoot, runsRoot }

export async function createWorkspace(runId = newId('run')): Promise<Workspace> {
  const root = join(runsRoot(), runId)
  const workDir = join(root, 'work')
  const outDir = join(root, 'out')

  await mkdir(workDir, { recursive: true })
  await mkdir(outDir, { recursive: true })

  return {
    runId,
    root,
    workDir,
    outDir,
    async dispose() {
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    },
  }
}

/** Run `fn` with a workspace, disposing of it whatever happens. */
export async function withWorkspace<T>(
  fn: (workspace: Workspace) => Promise<T>,
  runId?: string,
): Promise<T> {
  const workspace = await createWorkspace(runId)
  try {
    return await fn(workspace)
  } finally {
    await workspace.dispose()
  }
}

export async function ensureStorageDirs(): Promise<void> {
  await mkdir(runsRoot(), { recursive: true })
  await mkdir(artifactsRoot(), { recursive: true })
  await mkdir(bundlesRoot(), { recursive: true })
}
