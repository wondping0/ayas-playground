import type { RunResult, RunSpec, SandboxRunner } from './runner'

/**
 * The no-Docker fallback.
 *
 * It exists so `npm run dev` and the test suite work on a machine without
 * Docker. It executes nothing, and it **can never produce a passing
 * verification** — verify() checks `runner.kind` before it looks at any result,
 * so there is no value this class could return that would earn a badge.
 *
 * See decisions/0004-sandbox-isolation.
 */
export class StubRunner implements SandboxRunner {
  readonly kind = 'stub' as const

  async available(): Promise<boolean> {
    // Honest: it is reachable, but it cannot verify anything.
    return false
  }

  async run(spec: RunSpec): Promise<RunResult> {
    return {
      status: 'unavailable',
      exitCode: null,
      stdout: '',
      stderr:
        'No sandbox available. AYA_RUNNER is "stub", so seller code was not executed and ' +
        `nothing was proven about this challenge (${spec.command[0] ?? 'no command'}).`,
      durationMs: 0,
      truncated: false,
    }
  }
}
