import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/core/errors'
import {
  CONTAINER_OUT,
  CONTAINER_UID,
  CONTAINER_WORK,
  buildDockerArgs,
  buildDockerKillArgs,
  type DockerRunOptions,
} from './docker-args'

/**
 * This file is a security control.
 *
 * Every assertion below corresponds to a row in the control table in
 * .wondev/memory/security-guardrails.md. If a change here makes a test fail,
 * the question to answer is "which isolation property did I just drop?" — not
 * "how do I update the expectation?".
 */

const BASE: DockerRunOptions = {
  image: 'ayas-playground/runner-python-crypto:1',
  containerName: 'aya-run-abc123',
  workDir: '/data/runs/abc123/work',
  outDir: '/data/runs/abc123/out',
  command: ['python', '/work/solver/solve.py'],
  env: { FLAG: 'ayactf{abcdefghijklmnopqrst}' },
  memoryMb: 512,
  pidsLimit: 128,
  tmpfsMb: 64,
}

function build(overrides: Partial<DockerRunOptions> = {}): string[] {
  return buildDockerArgs({ ...BASE, ...overrides })
}

/** Assert `flag` appears immediately followed by `value`. */
function hasPair(args: string[], flag: string, value: string): boolean {
  return args.some((arg, i) => arg === flag && args[i + 1] === value)
}

describe('buildDockerArgs — required isolation controls', () => {
  const REQUIRED: Array<[label: string, flag: string, value: string]> = [
    ['no network', '--network', 'none'],
    ['read-only root filesystem', '--read-only', ''],
    ['non-root user', '--user', CONTAINER_UID],
    ['all capabilities dropped', '--cap-drop', 'ALL'],
    ['no privilege escalation', '--security-opt', 'no-new-privileges'],
    ['memory cap', '--memory', '512m'],
    ['swap disabled', '--memory-swap', '512m'],
    ['cpu cap', '--cpus', '1'],
    ['pid cap', '--pids-limit', '128'],
    ['bounded noexec tmpfs', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'],
    ['container removed after the run', '--rm', ''],
  ]

  it.each(REQUIRED)('sets %s', (_label, flag, value) => {
    const args = build()
    if (value === '') {
      expect(args).toContain(flag)
    } else {
      expect(hasPair(args, flag, value)).toBe(true)
    }
  })

  it('mounts the work directory read-only', () => {
    expect(
      hasPair(
        build(),
        '--mount',
        `type=bind,source=${BASE.workDir},target=${CONTAINER_WORK},readonly`,
      ),
    ).toBe(true)
  })

  it('mounts exactly one writable directory', () => {
    const args = build()
    const mounts = args.filter((a, i) => args[i - 1] === '--mount')
    expect(mounts).toHaveLength(2)
    const writable = mounts.filter((m) => !m.includes('readonly'))
    expect(writable).toEqual([`type=bind,source=${BASE.outDir},target=${CONTAINER_OUT}`])
  })

  it('mounts no host path other than the run directories', () => {
    const args = build()
    const sources = args
      .filter((a, i) => args[i - 1] === '--mount')
      .map((m) => /source=([^,]+)/.exec(m)?.[1])
    expect(sources).toEqual([BASE.workDir, BASE.outDir])
  })

  it('does not grant any capability back', () => {
    expect(build()).not.toContain('--cap-add')
  })

  it('never runs privileged, and never shares a host namespace', () => {
    const args = build().join(' ')
    expect(args).not.toContain('--privileged')
    expect(args).not.toContain('--pid host')
    expect(args).not.toContain('--ipc host')
    expect(args).not.toContain('--userns')
    expect(args).not.toContain('/var/run/docker.sock')
  })

  it('puts the image before the command, so command words cannot be read as flags', () => {
    const args = build({ command: ['python', '--version'] })
    const imageIndex = args.indexOf(BASE.image)
    expect(imageIndex).toBeGreaterThan(0)
    expect(args.slice(imageIndex + 1)).toEqual(['python', '--version'])
  })

  it('is deterministic for the same options', () => {
    expect(build()).toEqual(build())
  })
})

describe('buildDockerArgs — workdir', () => {
  it('defaults to the read-only work mount', () => {
    expect(hasPair(build(), '--workdir', CONTAINER_WORK)).toBe(true)
  })

  it('allows the writable out mount, for the generate step', () => {
    expect(hasPair(build({ workdir: CONTAINER_OUT }), '--workdir', CONTAINER_OUT)).toBe(true)
  })

  it.each([
    ['a host path', '/etc'],
    ['a traversal', '/work/../etc'],
    ['an option', '--privileged'],
    ['empty', ''],
  ])('rejects %s as a workdir', (_label, workdir) => {
    // Restricted to the two mount points so it can never become a host path.
    expect(() => build({ workdir } as unknown as Partial<DockerRunOptions>)).toThrow(AppError)
  })
})

describe('buildDockerArgs — environment', () => {
  it('passes env as separate argv entries', () => {
    expect(hasPair(build(), '--env', 'FLAG=ayactf{abcdefghijklmnopqrst}')).toBe(true)
  })

  it('orders env deterministically', () => {
    const a = build({ env: { ZULU: '1', ALPHA: '2' } })
    const b = build({ env: { ALPHA: '2', ZULU: '1' } })
    expect(a).toEqual(b)
  })

  it.each([
    ['lowercase', 'flag'],
    ['leading digit', '1FLAG'],
    ['a dash', 'MY-FLAG'],
    ['an equals sign', 'A=B'],
    ['a space', 'MY FLAG'],
    ['empty', ''],
  ])('rejects an env name with %s', (_label, key) => {
    expect(() => build({ env: { [key]: 'x' } })).toThrow(AppError)
  })

  it('rejects a control character in an env value', () => {
    expect(() => build({ env: { FLAG: 'a\nLD_PRELOAD=b' } })).toThrow(AppError)
  })
})

describe('buildDockerArgs — option injection', () => {
  it.each([
    ['work dir', { workDir: '--privileged' }],
    ['out dir', { outDir: '-v/:/host' }],
    ['image', { image: '--rm' }],
    ['container name', { containerName: '-it' }],
  ])('rejects an option-like %s', (_label, override) => {
    expect(() => build(override as Partial<DockerRunOptions>)).toThrow(AppError)
  })

  it.each([
    ['a comma', { workDir: '/data/a,readonly=false' }],
    ['an equals sign', { outDir: '/data/a=b' }],
  ])('rejects a mount path containing %s', (_label, override) => {
    // Either would be parsed as another `--mount` sub-option.
    expect(() => build(override as Partial<DockerRunOptions>)).toThrow(AppError)
  })

  it('rejects a control character in a path', () => {
    expect(() => build({ workDir: '/data/a\nb' })).toThrow(AppError)
  })

  it.each([
    ['an empty image', ''],
    ['a space in the image', 'my image'],
    ['a shell metacharacter', 'image;rm -rf /'],
    ['a quote', 'image"'],
  ])('rejects %s', (_label, image) => {
    expect(() => build({ image })).toThrow(AppError)
  })

  it('accepts a digest-pinned image', () => {
    expect(() => build({ image: `ayas/runner@sha256:${'a'.repeat(64)}` })).not.toThrow()
  })

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(64)],
    ['a slash', 'aya/run'],
    ['a leading dot', '.run'],
  ])('rejects a container name that is %s', (_label, containerName) => {
    expect(() => build({ containerName })).toThrow(AppError)
  })
})

describe('buildDockerArgs — resource limits', () => {
  it.each([
    ['memoryMb below the floor', { memoryMb: 8 }],
    ['fractional memoryMb', { memoryMb: 512.5 }],
    ['zero pidsLimit', { pidsLimit: 0 }],
    ['negative pidsLimit', { pidsLimit: -1 }],
    ['zero tmpfsMb', { tmpfsMb: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(() => build(override as Partial<DockerRunOptions>)).toThrow(AppError)
  })

  it('keeps memory and memory-swap equal at any size', () => {
    for (const memoryMb of [16, 128, 512, 4096]) {
      const args = build({ memoryMb })
      expect(hasPair(args, '--memory', `${memoryMb}m`)).toBe(true)
      expect(hasPair(args, '--memory-swap', `${memoryMb}m`)).toBe(true)
    }
  })
})

describe('buildDockerArgs — command', () => {
  it('rejects an empty command', () => {
    expect(() => build({ command: [] })).toThrow(AppError)
  })

  it('rejects a control character in a command argument', () => {
    expect(() => build({ command: ['python', 'a\0b'] })).toThrow(AppError)
  })
})

describe('buildDockerKillArgs', () => {
  it('sends SIGKILL, not a polite stop', () => {
    expect(buildDockerKillArgs('aya-run-abc123')).toEqual([
      'kill',
      '--signal',
      'KILL',
      'aya-run-abc123',
    ])
  })

  it('validates the container name', () => {
    expect(() => buildDockerKillArgs('-it')).toThrow(AppError)
    expect(() => buildDockerKillArgs('a b')).toThrow(AppError)
  })
})
