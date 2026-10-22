import { spawn } from 'node:child_process'
import { runnerConfig } from '@/lib/core/config'
import {
  CONTAINER_OUT,
  CONTAINER_WORK,
  buildDockerArgs,
  buildDockerKillArgs,
} from './docker-args'
import type { RunResult, RunSpec, SandboxRunner } from './runner'

/**
 * Runs seller code in a hardened container.
 *
 * The isolation itself lives in docker-args.ts. What this file adds is the two
 * things a container cannot be trusted to do for itself: bound its output, and
 * stop when told.
 */

const DOCKER = 'docker'
const KILL_GRACE_MS = 5_000
const AVAILABILITY_TIMEOUT_MS = 5_000

/** Accumulates output up to a cap and then stops, rather than growing. */
class CappedBuffer {
  private chunks: Buffer[] = []
  private length = 0
  truncated = false

  constructor(private readonly cap: number) {}

  push(chunk: Buffer): void {
    if (this.length >= this.cap) {
      this.truncated = true
      return
    }
    const remaining = this.cap - this.length
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining))
      this.length = this.cap
      this.truncated = true
      return
    }
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

function containerNameFor(runId: string): string {
  // runId is server-generated (`run_<ulid>`); lowercase it and strip anything
  // outside the container-name charset rather than trusting its shape here.
  return `aya-${runId.replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase()}`.slice(0, 63)
}

export class DockerRunner implements SandboxRunner {
  readonly kind = 'docker' as const

  async available(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(DOCKER, ['version', '--format', '{{.Server.Version}}'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(false)
      }, AVAILABILITY_TIMEOUT_MS)
      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })
    })
  }

  async run(spec: RunSpec): Promise<RunResult> {
    const containerName = containerNameFor(spec.runId)
    const maxOutput = runnerConfig.maxOutputBytes()

    const args = buildDockerArgs({
      image: runnerConfig.image(spec.profile),
      containerName,
      workDir: spec.workDir,
      outDir: spec.outDir,
      command: spec.command,
      env: spec.env,
      memoryMb: runnerConfig.memoryMb(),
      pidsLimit: runnerConfig.pidsLimit(),
      tmpfsMb: runnerConfig.tmpfsMb(),
      workdir: spec.workdir === 'out' ? CONTAINER_OUT : CONTAINER_WORK,
    })

    const startedAt = Date.now()
    const stdout = new CappedBuffer(maxOutput)
    const stderr = new CappedBuffer(maxOutput)

    return new Promise<RunResult>((resolve) => {
      const child = spawn(DOCKER, args, { stdio: ['ignore', 'pipe', 'pipe'] })

      let timedOut = false
      let settled = false

      const finish = (result: Omit<RunResult, 'durationMs' | 'truncated'>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(graceTimer)
        resolve({
          ...result,
          durationMs: Date.now() - startedAt,
          truncated: stdout.truncated || stderr.truncated,
        })
      }

      // The timeout is enforced here, on the host. A container that ignores a
      // stop signal, or one whose process is wedged in a syscall, still dies.
      const timer = setTimeout(() => {
        timedOut = true
        spawn(DOCKER, buildDockerKillArgs(containerName), {
          stdio: ['ignore', 'ignore', 'ignore'],
        }).on('error', () => {
          /* the grace timer below is the backstop */
        })
      }, spec.timeoutMs)

      // If `docker kill` itself fails or hangs, stop waiting on the client.
      let graceTimer: NodeJS.Timeout = setTimeout(() => {
        /* replaced below */
      }, 0)
      clearTimeout(graceTimer)
      graceTimer = setTimeout(
        () => {
          child.kill('SIGKILL')
          finish({
            status: 'timeout',
            exitCode: null,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          })
        },
        spec.timeoutMs + KILL_GRACE_MS,
      )

      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

      child.on('error', (error) => {
        // Docker is not installed or not on PATH. Distinct from a failed run:
        // nothing has been proven about the challenge.
        finish({
          status: 'unavailable',
          exitCode: null,
          stdout: stdout.toString(),
          stderr: `${stderr.toString()}\n${error.message}`.trim(),
        })
      })

      child.on('close', (code) => {
        if (timedOut) {
          finish({
            status: 'timeout',
            exitCode: code,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          })
          return
        }
        if (code === 0) {
          finish({ status: 'ok', exitCode: 0, stdout: stdout.toString(), stderr: stderr.toString() })
          return
        }
        // 137 is SIGKILL. We did not send it (timedOut is false), so the
        // kernel OOM killer did — the container exceeded its memory cap.
        finish({
          status: code === 137 ? 'oom' : 'failed',
          exitCode: code,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        })
      })
    })
  }
}
