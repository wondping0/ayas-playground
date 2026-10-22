import type { SandboxProfile } from '@/lib/core/bundle'

/**
 * The sandbox contract.
 *
 * Build, verify, and fulfill are three callers of this one primitive. Anything
 * that executes seller code goes through here — see the boundary rule in
 * .wondev/memory/architecture.md.
 */

export interface RunSpec {
  profile: SandboxProfile
  /** Host directory mounted read-only at /work. */
  workDir: string
  /** Host directory mounted read-write at /out. */
  outDir: string
  /** argv inside the container. First element is the executable. */
  command: string[]
  /** Injected into the container environment. Values are never logged. */
  env: Record<string, string>
  timeoutMs: number
  /** Correlates the run with its container and its log lines. */
  runId: string
  /**
   * Which mount the process starts in. Defaults to `work`, which is read-only.
   *
   * The `generate` step needs `out`, so an author's ordinary
   * `open('output.txt', 'w')` lands in the writable mount. Expressed as a
   * choice between the two mounts rather than a path, so a caller cannot ask
   * for somewhere neither of them is.
   */
  workdir?: 'work' | 'out'
}

export const RUN_STATUSES = ['ok', 'failed', 'timeout', 'oom', 'unavailable', 'error'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export interface RunResult {
  status: RunStatus
  /** null when the process was killed rather than exiting. */
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  /** True when output hit the byte cap and was cut. */
  truncated: boolean
}

export interface SandboxRunner {
  readonly kind: 'docker' | 'stub'
  run(spec: RunSpec): Promise<RunResult>
  /** Whether the runner can actually execute. Checked before publishing. */
  available(): Promise<boolean>
}

export function isSuccess(result: RunResult): boolean {
  return result.status === 'ok' && result.exitCode === 0
}
