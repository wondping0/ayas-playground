import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RELEASE_DIR, generatorPath, type ChallengeSpec } from '@/lib/core/bundle'
import { AppError } from '@/lib/core/errors'
import { CONTAINER_OUT, CONTAINER_WORK } from './docker-args'
import type { RunResult, SandboxRunner } from './runner'

/**
 * Producing the release files for a given flag.
 *
 * One of the three callers of the sandbox. `static` and `substitute` need no
 * execution; `generate` does, which is what puts this on the fulfilment path.
 * See decisions/0003-flag-modes.
 */

export const FLAG_TOKEN = '{{FLAG}}'

/** Files above this are not scanned for the substitution token. */
const MAX_SUBSTITUTE_BYTES = 5 * 1024 * 1024

export interface BuildRequest {
  /** Extracted bundle, as uploaded. Mounted read-only. */
  bundleDir: string
  /** Where the built release files are written. Must exist and be empty. */
  targetDir: string
  spec: ChallengeSpec
  flag: string
  runner: SandboxRunner
  runId: string
  timeoutMs?: number
}

export interface BuildResult {
  ok: boolean
  /** null when the mode needed no sandbox. */
  run: RunResult | null
  message: string
  /** Relative paths written into targetDir. */
  producedFiles: string[]
}

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(join(dir, entry.name), rel)))
    } else if (entry.isFile()) {
      out.push(rel)
    }
  }
  return out.sort()
}

async function copyReleaseFiles(bundleDir: string, targetDir: string): Promise<void> {
  const source = join(bundleDir, RELEASE_DIR)
  try {
    await stat(source)
  } catch {
    throw new AppError('bundle_invalid', `The bundle has no ${RELEASE_DIR}/ directory.`)
  }
  await cp(source, targetDir, { recursive: true })
}

export async function buildRelease(request: BuildRequest): Promise<BuildResult> {
  const { bundleDir, targetDir, spec, flag, runner, runId } = request
  const mode = spec.aya.flag.mode

  if (mode === 'static') {
    await copyReleaseFiles(bundleDir, targetDir)
    return {
      ok: true,
      run: null,
      message: 'Static bundle — release files copied unchanged.',
      producedFiles: await listFilesRecursive(targetDir),
    }
  }

  if (mode === 'substitute') {
    await copyReleaseFiles(bundleDir, targetDir)

    const declared = spec.aya.flag.substituteIn ?? []
    // Only release files matter for what the buyer receives; a declared server
    // file is substituted in place for the generator's benefit, not shipped.
    const releaseTargets = declared
      .filter((p) => p.startsWith(`${RELEASE_DIR}/`))
      .map((p) => p.slice(`${RELEASE_DIR}/`.length))

    let substituted = 0
    for (const relative of releaseTargets) {
      const path = join(targetDir, relative)
      const info = await stat(path).catch(() => null)
      if (!info) {
        return {
          ok: false,
          run: null,
          message: `Declared substitution target "${RELEASE_DIR}/${relative}" is missing.`,
          producedFiles: await listFilesRecursive(targetDir),
        }
      }
      if (info.size > MAX_SUBSTITUTE_BYTES) {
        return {
          ok: false,
          run: null,
          message: `"${RELEASE_DIR}/${relative}" is too large to substitute into.`,
          producedFiles: await listFilesRecursive(targetDir),
        }
      }
      const content = await readFile(path, 'utf8')
      if (!content.includes(FLAG_TOKEN)) {
        return {
          ok: false,
          run: null,
          message: `"${RELEASE_DIR}/${relative}" was declared as a substitution target but contains no ${FLAG_TOKEN}.`,
          producedFiles: await listFilesRecursive(targetDir),
        }
      }
      await writeFile(path, content.split(FLAG_TOKEN).join(flag), 'utf8')
      substituted += 1
    }

    if (substituted === 0) {
      return {
        ok: false,
        run: null,
        message: `Flag mode is "substitute" but no ${RELEASE_DIR}/ file was listed in aya.flag.substituteIn.`,
        producedFiles: await listFilesRecursive(targetDir),
      }
    }

    return {
      ok: true,
      run: null,
      message: `Substituted the flag into ${substituted} file(s).`,
      producedFiles: await listFilesRecursive(targetDir),
    }
  }

  // --- generate ------------------------------------------------------------
  // The generator runs with the bundle read-only at /work and the empty target
  // as its working directory, so an ordinary `open('output.txt', 'w')` lands
  // where it should without the author knowing anything about the sandbox.
  const generator = generatorPath(spec)
  const run = await runner.run({
    profile: spec.aya.solver.profile,
    workDir: bundleDir,
    outDir: targetDir,
    command: ['python', `${CONTAINER_WORK}/${generator}`],
    env: { FLAG: flag, OUT_DIR: CONTAINER_OUT },
    timeoutMs: request.timeoutMs ?? spec.aya.solver.timeoutMs,
    runId,
    // Without this the generator starts in the read-only mount and its first
    // write fails with EROFS.
    workdir: 'out',
  })

  const producedFiles = await listFilesRecursive(targetDir)

  if (run.status !== 'ok' || run.exitCode !== 0) {
    return {
      ok: false,
      run,
      message:
        run.status === 'unavailable'
          ? 'No sandbox available, so the generator did not run.'
          : `The generator exited with ${run.status} (code ${run.exitCode ?? 'killed'}).`,
      producedFiles,
    }
  }

  if (producedFiles.length === 0) {
    return {
      ok: false,
      run,
      message: `The generator exited cleanly but wrote nothing. It must write its release files into $OUT_DIR (${CONTAINER_OUT}), which is its working directory.`,
      producedFiles,
    }
  }

  return {
    ok: true,
    run,
    message: `The generator produced ${producedFiles.length} release file(s).`,
    producedFiles,
  }
}

/**
 * Every release file the original bundle declared must exist after a build.
 *
 * A generator that writes only some of them produces a challenge that is broken
 * in a way neither the seller nor the buyer would notice until players did.
 */
export async function missingDeclaredReleaseFiles(
  bundleDir: string,
  targetDir: string,
): Promise<string[]> {
  const expected = await listFilesRecursive(join(bundleDir, RELEASE_DIR))
  const produced = new Set(await listFilesRecursive(targetDir))
  return expected.filter((path) => !produced.has(path))
}
