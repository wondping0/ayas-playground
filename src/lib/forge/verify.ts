import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { RELEASE_DIR, staticFlag, validateBundleStructure, type ChallengeSpec } from '@/lib/core/bundle'
import { ephemeralFlag, scrubFlags } from '@/lib/core/flag'
import type { Verdict } from '@/lib/core/types'
import { extractBundle } from './archive'
import { buildRelease, missingDeclaredReleaseFiles } from './build'
import { CONTAINER_WORK } from './docker-args'
import type { SandboxRunner } from './runner'
import { withWorkspace } from './workspace'

/**
 * Proving a challenge is solvable.
 *
 * The whole marketplace rests on this: a buyer cannot read a crypto challenge
 * before purchase without spoiling it, so "Verified solvable" is the only
 * quality signal they have that is not somebody's opinion.
 */

export interface VerifyRequest {
  bundleData: Buffer
  spec: ChallengeSpec
  runner: SandboxRunner
  runId?: string
}

export interface VerifyOutcome {
  verdict: Verdict
  durationMs: number
  /** Flag-scrubbed. Shown to the seller; never to a buyer. */
  log: string
  message: string
}

function outcome(
  verdict: Verdict,
  message: string,
  log = '',
  durationMs = 0,
): VerifyOutcome {
  return { verdict, message, log, durationMs }
}

export async function verifyBundle(request: VerifyRequest): Promise<VerifyOutcome> {
  const { bundleData, spec, runner } = request

  // The structural guarantee that keeps the badge honest: a non-Docker runner
  // is turned away here, before any result value is examined. There is nothing
  // the stub runner could return that would reach the pass/fail logic below.
  if (runner.kind !== 'docker') {
    return outcome(
      'unverified',
      'No sandbox is configured, so this challenge has not been executed. ' +
        'Set AYA_RUNNER=docker to verify it.',
    )
  }

  if (!(await runner.available())) {
    return outcome(
      'error',
      'The sandbox is configured but Docker is not reachable. Nothing was executed.',
    )
  }

  return withWorkspace(async (workspace) => {
    const bundleDir = join(workspace.workDir, 'bundle')
    const releaseDir = join(workspace.outDir, 'release')
    const verifyDir = join(workspace.root, 'verify')
    const solverOut = join(workspace.root, 'solver-out')

    await mkdir(releaseDir, { recursive: true })
    await mkdir(solverOut, { recursive: true })

    const { manifest } = await extractBundle(bundleData, bundleDir)

    const issues = validateBundleStructure(spec, manifest)
    if (issues.length > 0) {
      return outcome(
        'failed',
        `The bundle is incomplete: ${issues.map((i) => `${i.path} — ${i.message}`).join('; ')}`,
      )
    }

    // A static bundle's solver prints the flag baked into the handout, so
    // verifying it against an ephemeral one would fail every time. Only a
    // re-flaggable bundle gets a throwaway flag.
    const flag = staticFlag(spec) ?? ephemeralFlag(spec.aya.flag.format)

    const build = await buildRelease({
      bundleDir,
      targetDir: releaseDir,
      spec,
      flag,
      runner,
      runId: `${workspace.runId}b`,
      timeoutMs: spec.aya.solver.timeoutMs,
    })

    if (!build.ok) {
      return outcome(
        'failed',
        `Build failed. ${build.message}`,
        scrubFlags(`${build.run?.stdout ?? ''}\n${build.run?.stderr ?? ''}`.trim(), [flag]),
        build.run?.durationMs ?? 0,
      )
    }

    const missing = await missingDeclaredReleaseFiles(bundleDir, releaseDir)
    if (missing.length > 0) {
      return outcome(
        'failed',
        `The build did not produce every declared release file. Missing: ${missing.join(', ')}.`,
        scrubFlags(build.run?.stdout ?? '', [flag]),
        build.run?.durationMs ?? 0,
      )
    }

    // The solver must see the *built* challenge, not the uploaded one.
    await cp(bundleDir, verifyDir, { recursive: true })
    await rm(join(verifyDir, RELEASE_DIR), { recursive: true, force: true })
    await cp(releaseDir, join(verifyDir, RELEASE_DIR), { recursive: true })

    // The solver is deliberately NOT given the flag. It has to recover it from
    // the challenge — handing it over would make every bundle "verifiable".
    const run = await runner.run({
      profile: spec.aya.solver.profile,
      workDir: verifyDir,
      outDir: solverOut,
      command: ['python', `${CONTAINER_WORK}/${spec.aya.solver.entrypoint}`],
      env: {},
      timeoutMs: spec.aya.solver.timeoutMs,
      runId: `${workspace.runId}s`,
    })

    const log = scrubFlags(
      [run.stdout, run.stderr].filter(Boolean).join('\n--- stderr ---\n'),
      [flag],
    )
    const totalMs = (build.run?.durationMs ?? 0) + run.durationMs

    switch (run.status) {
      case 'timeout':
        return outcome(
          'failed',
          `The solver did not finish within ${spec.aya.solver.timeoutMs} ms. ` +
            'Raise aya.solver.timeoutMs if it genuinely needs longer.',
          log,
          totalMs,
        )
      case 'oom':
        return outcome(
          'failed',
          'The solver exceeded the memory limit and was killed.',
          log,
          totalMs,
        )
      case 'unavailable':
        return outcome('error', 'The sandbox became unavailable mid-run.', log, totalMs)
      case 'error':
        return outcome('error', 'The sandbox failed to run the solver.', log, totalMs)
      default:
        break
    }

    if (run.exitCode !== 0) {
      return outcome(
        'failed',
        `The solver exited with code ${run.exitCode}. Its output is below.`,
        log,
        totalMs,
      )
    }

    const inStdout = run.stdout.includes(flag)
    const inStderr = run.stderr.includes(flag)

    if (!inStdout && !inStderr) {
      return outcome(
        'failed',
        'The solver ran cleanly but did not print the flag. It must recover the flag from the ' +
          'challenge and print it to stdout — it is not given the flag.',
        log,
        totalMs,
      )
    }

    if (!inStdout) {
      return outcome(
        'passed',
        `Solved in ${totalMs} ms. Note: the flag was printed to stderr, not stdout — ` +
          'move it to stdout so other tooling can read it.',
        log,
        totalMs,
      )
    }

    return outcome('passed', `Solved in ${totalMs} ms.`, log, totalMs)
  }, request.runId)
}
