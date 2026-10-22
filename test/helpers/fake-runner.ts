import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RunResult, RunSpec, SandboxRunner } from '@/lib/forge/runner'

/**
 * A sandbox runner that reports `kind: 'docker'` without running Docker.
 *
 * It exists to exercise the pass/fail logic in verify() and fulfill(), which
 * the real StubRunner deliberately cannot reach. Tests that assert the stub
 * *cannot* pass use StubRunner itself, not this.
 */
export class FakeRunner implements SandboxRunner {
  readonly kind = 'docker' as const
  readonly runs: RunSpec[] = []

  constructor(
    private readonly handler: (spec: RunSpec) => Promise<RunResult>,
    private readonly isAvailable = true,
  ) {}

  async available(): Promise<boolean> {
    return this.isAvailable
  }

  async run(spec: RunSpec): Promise<RunResult> {
    // Recorded verbatim, including `workdir` — a caller that forgets it would
    // otherwise pass here and fail against real Docker with EROFS.
    this.runs.push({ ...spec, env: { ...spec.env }, command: [...spec.command] })
    return this.handler(spec)
  }

  /** Runs whose command targets the generator. */
  get generatorRuns(): RunSpec[] {
    return this.runs.filter((r) => r.command.some((c) => c.includes('generate')))
  }

  /** Runs whose command targets the solver. */
  get solverRuns(): RunSpec[] {
    return this.runs.filter((r) => r.command.some((c) => c.includes('solve')))
  }
}

export function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: 'ok',
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 5,
    truncated: false,
    ...overrides,
  }
}

function isGenerator(spec: RunSpec): boolean {
  return spec.command.some((c) => c.includes('generate'))
}

export interface RealisticOptions {
  /** What the solver prints. Defaults to the recovered flag. */
  solverStdout?: (recoveredFlag: string) => string
  solverStderr?: (recoveredFlag: string) => string
  solverResult?: Partial<RunResult>
  generatorResult?: Partial<RunResult>
  /** Skip writing output.txt, to simulate a generator that produces nothing. */
  generatorWritesNothing?: boolean
  /** Write a different filename, to simulate a missing declared release file. */
  generatorWritesInstead?: string
}

/**
 * A runner that behaves like a working crypto challenge: the generator writes
 * the flag into a release file, and the solver reads that file back out.
 *
 * Simulating both halves is what makes the test cover the assembly step —
 * that the solver is handed the *built* bundle rather than the uploaded one.
 */
export function realisticRunner(options: RealisticOptions = {}): FakeRunner {
  return new FakeRunner(async (spec) => {
    if (isGenerator(spec)) {
      if (!options.generatorWritesNothing) {
        const name = options.generatorWritesInstead ?? 'output.txt'
        const target = join(spec.outDir, name)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, `ciphertext for ${spec.env.FLAG ?? 'MISSING'}\n`, 'utf8')
      }
      return runResult(options.generatorResult)
    }

    // The solver reads the built release files, exactly as the real one would.
    const recovered = await readFile(join(spec.workDir, 'release_files', 'output.txt'), 'utf8')
      .then((text) => /ayactf\{[a-z2-7]+\}|[A-Za-z0-9_]+\{[^}]+\}/.exec(text)?.[0] ?? '')
      .catch(() => '')

    return runResult({
      stdout: options.solverStdout?.(recovered) ?? `${recovered}\n`,
      stderr: options.solverStderr?.(recovered) ?? '',
      ...options.solverResult,
    })
  })
}
