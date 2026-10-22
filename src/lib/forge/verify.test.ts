import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseChallengeYaml } from '@/lib/core/bundle'
import { REDACTION } from '@/lib/core/flag'
import { FakeRunner, realisticRunner, runResult } from '../../../test/helpers/fake-runner'
import { STATIC_FLAG, goodBundle, goodBundleYaml, rawZip } from '../../../test/helpers/zip'
import { StubRunner } from './stub-runner'
import { verifyBundle } from './verify'

let dataDir: string

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'aya-verify-'))
  process.env.AYA_DATA_DIR = dataDir
})

afterEach(async () => {
  delete process.env.AYA_DATA_DIR
  await rm(dataDir, { recursive: true, force: true })
})

const spec = parseChallengeYaml(goodBundleYaml('generate'))

describe('the stub runner can never pass a verification', () => {
  it('returns unverified, not passed', async () => {
    const outcome = await verifyBundle({
      bundleData: goodBundle(),
      spec,
      runner: new StubRunner(),
    })
    expect(outcome.verdict).toBe('unverified')
    expect(outcome.message).toMatch(/not been executed/)
  })

  it('is turned away before the bundle is even read', async () => {
    // Garbage input still yields `unverified` rather than an error, because the
    // runner check happens first. Nothing about the bundle can change the verdict.
    const outcome = await verifyBundle({
      bundleData: Buffer.from('not a zip at all'),
      spec,
      runner: new StubRunner(),
    })
    expect(outcome.verdict).toBe('unverified')
  })
})

describe('verifyBundle — passing', () => {
  it('passes when the solver recovers the flag', async () => {
    const runner = realisticRunner()
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('passed')
    expect(outcome.message).toMatch(/Solved in/)
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('runs the generator before the solver', async () => {
    const runner = realisticRunner()
    await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(runner.runs).toHaveLength(2)
    expect(runner.runs[0]?.command.join(' ')).toContain('generate.py')
    expect(runner.runs[1]?.command.join(' ')).toContain('solve.py')
  })

  it('gives the generator the flag, and the solver nothing', async () => {
    // The whole point: if the solver were handed the flag, every bundle would
    // verify and the badge would mean nothing.
    const runner = realisticRunner()
    await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(runner.generatorRuns[0]?.env.FLAG).toMatch(/^ayactf\{[a-z2-7]{20}\}$/)
    expect(runner.solverRuns[0]?.env).toEqual({})
  })

  it('starts the generator in the writable mount, and the solver in the read-only one', async () => {
    // The fake runner writes to outDir whatever the workdir says, so this
    // assertion is the only thing standing between a working generator and an
    // EROFS on its first `open(..., "w")`.
    const runner = realisticRunner()
    await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(runner.generatorRuns[0]?.workdir).toBe('out')
    expect(runner.solverRuns[0]?.workdir ?? 'work').toBe('work')
  })

  it('uses a different ephemeral flag each time', async () => {
    const first = realisticRunner()
    const second = realisticRunner()
    await verifyBundle({ bundleData: goodBundle(), spec, runner: first })
    await verifyBundle({ bundleData: goodBundle(), spec, runner: second })

    expect(first.generatorRuns[0]?.env.FLAG).not.toBe(second.generatorRuns[0]?.env.FLAG)
  })

  it('mounts the generator’s output for the solver, not the uploaded files', async () => {
    // The solver in realisticRunner reads release_files/output.txt and echoes
    // what it finds. It only recovers the flag if the built file was assembled
    // into its work directory.
    const runner = realisticRunner()
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })
    expect(outcome.verdict).toBe('passed')
  })

  it('passes but warns when the flag goes to stderr', async () => {
    const runner = realisticRunner({
      solverStdout: () => 'working...\n',
      solverStderr: (flag) => flag,
    })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('passed')
    expect(outcome.message).toMatch(/printed to stderr/)
  })

  it('verifies a static bundle against its declared literal flag', async () => {
    // A static bundle's solver prints the flag baked into the handout, so
    // checking it against an ephemeral one would fail every static challenge.
    const staticSpec = parseChallengeYaml(goodBundleYaml('static'))
    const bundle = goodBundle({ flagMode: 'static', includeGenerator: false })
    const runner = new FakeRunner(async () => runResult({ stdout: `${STATIC_FLAG}\n` }))

    const outcome = await verifyBundle({ bundleData: bundle, spec: staticSpec, runner })

    expect(runner.generatorRuns).toHaveLength(0)
    expect(outcome.verdict).toBe('passed')
  })

  it('fails a static bundle whose solver prints something else', async () => {
    const staticSpec = parseChallengeYaml(goodBundleYaml('static'))
    const bundle = goodBundle({ flagMode: 'static', includeGenerator: false })
    const runner = new FakeRunner(async () => runResult({ stdout: 'ayactf{wrong}\n' }))

    const outcome = await verifyBundle({ bundleData: bundle, spec: staticSpec, runner })
    expect(outcome.verdict).toBe('failed')
  })

  it('scrubs a static bundle’s literal flag from the log', async () => {
    const staticSpec = parseChallengeYaml(goodBundleYaml('static'))
    const bundle = goodBundle({ flagMode: 'static', includeGenerator: false })
    const runner = new FakeRunner(async () => runResult({ stdout: `${STATIC_FLAG}\n` }))

    const outcome = await verifyBundle({ bundleData: bundle, spec: staticSpec, runner })
    expect(outcome.log).not.toContain(STATIC_FLAG)
  })
})

describe('verifyBundle — failing', () => {
  it('fails when the solver does not print the flag', async () => {
    const runner = realisticRunner({ solverStdout: () => 'no idea\n' })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/did not print the flag/)
  })

  it('fails when the solver exits non-zero', async () => {
    const runner = realisticRunner({ solverResult: { status: 'failed', exitCode: 1 } })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/exited with code 1/)
  })

  it('fails on a solver timeout, and says how to raise it', async () => {
    const runner = realisticRunner({ solverResult: { status: 'timeout', exitCode: null } })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/did not finish within 30000 ms/)
    expect(outcome.message).toMatch(/aya\.solver\.timeoutMs/)
  })

  it('fails when the solver is killed for exceeding memory', async () => {
    const runner = realisticRunner({ solverResult: { status: 'oom', exitCode: 137 } })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/memory limit/)
  })

  it('fails when the generator exits non-zero', async () => {
    const runner = realisticRunner({ generatorResult: { status: 'failed', exitCode: 2 } })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/Build failed/)
  })

  it('fails when the generator writes nothing, and says where to write', async () => {
    const runner = realisticRunner({ generatorWritesNothing: true })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/wrote nothing/)
    expect(outcome.message).toMatch(/OUT_DIR/)
  })

  it('fails when the generator skips a declared release file', async () => {
    const runner = realisticRunner({ generatorWritesInstead: 'something-else.txt' })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/Missing: output\.txt/)
  })

  it('fails an incomplete bundle before running anything', async () => {
    const runner = realisticRunner()
    const outcome = await verifyBundle({
      bundleData: goodBundle({ includeWriteup: false }),
      spec,
      runner,
    })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.message).toMatch(/writeup\.md/)
    expect(runner.runs).toHaveLength(0)
  })

  it('reports an error, not a failure, when the sandbox is unreachable', async () => {
    // "We could not check" and "this challenge is broken" are different claims.
    const runner = new FakeRunner(async () => runResult(), false)
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('error')
    expect(outcome.message).toMatch(/not reachable/)
  })

  it('reports an error when the sandbox dies mid-run', async () => {
    const runner = realisticRunner({ solverResult: { status: 'unavailable', exitCode: null } })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })
    expect(outcome.verdict).toBe('error')
  })
})

describe('verifyBundle — the log never carries the flag', () => {
  it('scrubs a flag the solver printed', async () => {
    const runner = realisticRunner()
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.verdict).toBe('passed')
    expect(outcome.log).not.toMatch(/ayactf\{[a-z2-7]{20}\}/)
    expect(outcome.log).toContain(REDACTION)
  })

  it('scrubs a bare flag body printed without its wrapper', async () => {
    const runner = realisticRunner({
      solverStdout: (flag) => `body is ${flag.replace(/^ayactf\{|\}$/g, '')}\n${flag}\n`,
    })
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner })

    expect(outcome.log).not.toMatch(/[a-z2-7]{20}/)
  })

  it('scrubs the flag out of a failing build log too', async () => {
    const runner = realisticRunner({
      generatorResult: { status: 'failed', exitCode: 1 },
      solverStdout: () => '',
    })
    const failing = new FakeRunner(async (spec_) => {
      return runResult({
        status: 'failed',
        exitCode: 1,
        stderr: `crashed while encoding ${spec_.env.FLAG}`,
      })
    })
    void runner
    const outcome = await verifyBundle({ bundleData: goodBundle(), spec, runner: failing })

    expect(outcome.verdict).toBe('failed')
    expect(outcome.log).not.toMatch(/ayactf\{[a-z2-7]{20}\}/)
  })
})

describe('verifyBundle — hostile bundles', () => {
  it('refuses a bundle whose archive is unsafe, without running anything', async () => {
    const runner = realisticRunner()
    await expect(
      verifyBundle({
        bundleData: rawZip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]),
        spec,
        runner,
      }),
    ).rejects.toThrow(/symlink/)
    expect(runner.runs).toHaveLength(0)
  })
})
