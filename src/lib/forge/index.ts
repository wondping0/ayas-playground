import { runnerConfig } from '@/lib/core/config'
import { setSingleton, singleton } from '@/lib/core/singleton'
import { DockerRunner } from './docker-runner'
import type { SandboxRunner } from './runner'
import { StubRunner } from './stub-runner'

export type { RunResult, RunSpec, RunStatus, SandboxRunner } from './runner'
export { isSuccess } from './runner'
export { buildRelease, missingDeclaredReleaseFiles, FLAG_TOKEN } from './build'
export { verifyBundle, type VerifyOutcome, type VerifyRequest } from './verify'
export { fulfillOrder, deliveredChallengeYaml, type FulfillResult } from './fulfill'
export { extractBundle, packBundle, type PackEntry } from './archive'
export { getQueue, setQueue, InProcessQueue, backoffMs, type JobQueue } from './queue'
export {
  artifactsRoot,
  bundlesRoot,
  createWorkspace,
  dataRoot,
  ensureStorageDirs,
  runsRoot,
  withWorkspace,
} from './workspace'

const RUNNER_KEY = 'forge.runner'

export function getRunner(): SandboxRunner {
  return singleton<SandboxRunner>(RUNNER_KEY, () =>
    runnerConfig.kind() === 'docker' ? new DockerRunner() : new StubRunner(),
  )
}

/** Tests and scripts only. */
export function setRunner(next: SandboxRunner | null): void {
  setSingleton(RUNNER_KEY, next)
}
