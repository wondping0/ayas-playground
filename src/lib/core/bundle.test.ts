import { describe, expect, it } from 'vitest'
import { AppError } from './errors'
import { buildManifest, type BundleFile } from './manifest'
import {
  generatorPath,
  isReflaggable,
  parseChallengeYaml,
  staticFlag,
  validateBundleStructure,
} from './bundle'

function file(path: string, size = 100): BundleFile {
  return { path, size, sha256: 'a'.repeat(64) }
}

const GOOD_YAML = `
name: Shared Primes
author: aya
category: crypto
description: Two moduli were generated carelessly.
value: 300
tags: [rsa, gcd]
aya:
  scheme: rsa-weakness
  difficulty: easy
  flag:
    mode: generate
    format: "ayactf{%s}"
    generator: server_files/generate.py
  solver:
    entrypoint: solver/solve.py
    profile: python-crypto
    timeoutMs: 30000
  license: event
`

const FULL_MANIFEST = buildManifest([
  file('challenge.yml'),
  file('release_files/output.txt'),
  file('server_files/generate.py'),
  file('solver/solve.py'),
  file('writeup.md'),
])

describe('parseChallengeYaml', () => {
  it('parses a well-formed bundle spec', () => {
    const spec = parseChallengeYaml(GOOD_YAML)
    expect(spec.name).toBe('Shared Primes')
    expect(spec.aya.scheme).toEqual(['rsa-weakness'])
    expect(spec.aya.flag.mode).toBe('generate')
    expect(spec.aya.solver.timeoutMs).toBe(30_000)
  })

  it('normalizes a single scheme to an array', () => {
    expect(parseChallengeYaml(GOOD_YAML).aya.scheme).toEqual(['rsa-weakness'])
  })

  it('applies solver defaults when the block is absent', () => {
    const spec = parseChallengeYaml(`
name: x
author: a
category: crypto
description: d
aya:
  scheme: classical
  difficulty: easy
  flag: { mode: static }
`)
    expect(spec.aya.solver.entrypoint).toBe('solver/solve.py')
    expect(spec.aya.solver.profile).toBe('python-crypto')
    expect(spec.aya.solver.timeoutMs).toBe(60_000)
    expect(spec.aya.flag.format).toBe('ayactf{%s}')
  })

  it('carries unknown ctfcli fields through untouched', () => {
    const spec = parseChallengeYaml(`${GOOD_YAML}\nhealthcheck: ./check.sh\nnext: 42\n`)
    expect((spec as Record<string, unknown>).healthcheck).toBe('./check.sh')
    expect((spec as Record<string, unknown>).next).toBe(42)
  })

  describe('rejects', () => {
    it('a literal flag in a dynamic mode', () => {
      const yaml = `${GOOD_YAML}\nflags:\n  - ayactf{real_flag_here}\n`
      expect(() => parseChallengeYaml(yaml)).toThrow(/only allowed with flag mode "static"/)
    })

    it('but allows a literal flag in static mode', () => {
      const yaml = `
name: x
author: a
category: crypto
description: d
flags:
  - ayactf{legacy}
aya:
  scheme: classical
  difficulty: easy
  flag: { mode: static }
`
      expect(() => parseChallengeYaml(yaml)).not.toThrow()
    })

    it('invalid YAML', () => {
      expect(() => parseChallengeYaml('name: [unclosed')).toThrow(AppError)
    })

    it('a YAML scalar rather than a mapping', () => {
      expect(() => parseChallengeYaml('just a string')).toThrow(/must be a YAML mapping/)
    })

    it('a YAML list', () => {
      expect(() => parseChallengeYaml('- a\n- b')).toThrow(/must be a YAML mapping/)
    })

    it('a missing aya block', () => {
      expect(() =>
        parseChallengeYaml('name: x\nauthor: a\ncategory: crypto\ndescription: d'),
      ).toThrow(/failed validation/)
    })

    it('an unknown flag mode', () => {
      const yaml = GOOD_YAML.replace('mode: generate', 'mode: teleport')
      expect(() => parseChallengeYaml(yaml)).toThrow(/failed validation/)
    })

    it('an unsafe path in the generator field', () => {
      const yaml = GOOD_YAML.replace(
        'generator: server_files/generate.py',
        'generator: ../../etc/passwd',
      )
      expect(() => parseChallengeYaml(yaml)).toThrow(/failed validation/)
    })

    it('an invalid flag format', () => {
      const yaml = GOOD_YAML.replace('format: "ayactf{%s}"', 'format: "no-placeholder"')
      expect(() => parseChallengeYaml(yaml)).toThrow(/failed validation/)
    })

    it('an unknown key inside the aya block', () => {
      expect(() => parseChallengeYaml(`${GOOD_YAML}  backdoor: true\n`)).toThrow(
        /failed validation/,
      )
    })

    it('a solver timeout beyond the cap', () => {
      const yaml = GOOD_YAML.replace('timeoutMs: 30000', 'timeoutMs: 999999999')
      expect(() => parseChallengeYaml(yaml)).toThrow(/failed validation/)
    })

    it('an oversized document', () => {
      expect(() => parseChallengeYaml('x'.repeat(300 * 1024))).toThrow(/larger than 256 KiB/)
    })

    it('a YAML alias bomb', () => {
      const bomb = [
        'name: x',
        'author: a',
        'category: crypto',
        'description: d',
        'a: &a ["x","x","x","x","x","x","x","x","x"]',
        'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
        'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
        'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
        'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      ].join('\n')
      expect(() => parseChallengeYaml(bomb)).toThrow(AppError)
    })
  })
})

describe('validateBundleStructure', () => {
  const spec = parseChallengeYaml(GOOD_YAML)

  it('passes a complete bundle', () => {
    expect(validateBundleStructure(spec, FULL_MANIFEST)).toEqual([])
  })

  it('requires a writeup', () => {
    const manifest = buildManifest(FULL_MANIFEST.files.filter((f) => f.path !== 'writeup.md'))
    const issues = validateBundleStructure(spec, manifest)
    expect(issues.map((i) => i.path)).toContain('writeup.md')
  })

  it('requires the declared solver to exist', () => {
    const manifest = buildManifest(
      FULL_MANIFEST.files.filter((f) => f.path !== 'solver/solve.py'),
    )
    expect(validateBundleStructure(spec, manifest).map((i) => i.path)).toContain('solver/solve.py')
  })

  it('requires at least one release file', () => {
    const manifest = buildManifest(
      FULL_MANIFEST.files.filter((f) => !f.path.startsWith('release_files/')),
    )
    expect(validateBundleStructure(spec, manifest).map((i) => i.path)).toContain('release_files/')
  })

  it('requires the generator to exist in generate mode', () => {
    const manifest = buildManifest(
      FULL_MANIFEST.files.filter((f) => f.path !== 'server_files/generate.py'),
    )
    const issues = validateBundleStructure(spec, manifest)
    expect(issues.some((i) => i.message.includes('generator script does not exist'))).toBe(true)
  })

  it('rejects a generator outside server_files/', () => {
    const outside = parseChallengeYaml(
      GOOD_YAML.replace('generator: server_files/generate.py', 'generator: release_files/gen.py'),
    )
    const manifest = buildManifest([...FULL_MANIFEST.files, file('release_files/gen.py')])
    const issues = validateBundleStructure(outside, manifest)
    expect(issues.some((i) => i.message.includes('never delivered to players'))).toBe(true)
  })

  it('rejects a solver outside solver/', () => {
    const outside = parseChallengeYaml(
      GOOD_YAML.replace('entrypoint: solver/solve.py', 'entrypoint: release_files/solve.py'),
    )
    const manifest = buildManifest([...FULL_MANIFEST.files, file('release_files/solve.py')])
    const issues = validateBundleStructure(outside, manifest)
    expect(issues.some((i) => i.message.includes('must live under solver/'))).toBe(true)
  })

  it('requires substituteIn targets in substitute mode', () => {
    const sub = parseChallengeYaml(`
name: x
author: a
category: crypto
description: d
aya:
  scheme: classical
  difficulty: easy
  flag: { mode: substitute }
`)
    const issues = validateBundleStructure(sub, FULL_MANIFEST)
    expect(issues.map((i) => i.path)).toContain('aya.flag.substituteIn')
  })

  it('rejects a category that is not enabled', () => {
    const web = parseChallengeYaml(GOOD_YAML.replace('category: crypto', 'category: web'))
    const issues = validateBundleStructure(web, FULL_MANIFEST)
    expect(issues.map((i) => i.path)).toContain('category')
  })

  it('requires declared files: entries to exist', () => {
    const withFiles = parseChallengeYaml(`${GOOD_YAML}\nfiles:\n  - release_files/missing.txt\n`)
    const issues = validateBundleStructure(withFiles, FULL_MANIFEST)
    expect(issues.map((i) => i.path)).toContain('release_files/missing.txt')
  })
})

describe('static bundles', () => {
  const withFlag = (flags: string) =>
    parseChallengeYaml(`
name: x
author: a
category: crypto
description: d
${flags}aya:
  scheme: classical
  difficulty: easy
  flag: { mode: static }
`)

  it('reads a bare-string flag', () => {
    const spec = withFlag('flags:\n  - ayactf{legacy}\n')
    expect(staticFlag(spec)).toBe('ayactf{legacy}')
    expect(isReflaggable(spec)).toBe(false)
  })

  it('reads an object-form flag, as ctfcli allows', () => {
    const spec = withFlag('flags:\n  - {content: "ayactf{legacy}", type: static}\n')
    expect(staticFlag(spec)).toBe('ayactf{legacy}')
  })

  it('requires a literal flag — there is nothing else to verify against', () => {
    const issues = validateBundleStructure(withFlag(''), FULL_MANIFEST)
    expect(issues.map((i) => i.path)).toContain('flags')
  })

  it('accepts a static bundle that declares one', () => {
    const issues = validateBundleStructure(
      withFlag('flags:\n  - ayactf{legacy}\n'),
      FULL_MANIFEST,
    )
    expect(issues).toEqual([])
  })

  it('returns null for a re-flaggable bundle', () => {
    const spec = parseChallengeYaml(GOOD_YAML)
    expect(staticFlag(spec)).toBeNull()
    expect(isReflaggable(spec)).toBe(true)
  })
})

describe('generatorPath', () => {
  it('defaults when unset', () => {
    const spec = parseChallengeYaml(`
name: x
author: a
category: crypto
description: d
aya:
  scheme: classical
  difficulty: easy
  flag: { mode: generate }
`)
    expect(generatorPath(spec)).toBe('server_files/generate.py')
  })

  it('uses the declared path when set', () => {
    expect(generatorPath(parseChallengeYaml(GOOD_YAML))).toBe('server_files/generate.py')
  })
})
