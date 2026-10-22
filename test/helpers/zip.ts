import { deflateRawSync } from 'node:zlib'

/**
 * A raw ZIP writer for tests.
 *
 * Deliberately not yazl: yazl validates entry names, so it cannot produce the
 * traversal, symlink, or duplicate-name archives that extraction has to defend
 * against. Testing that defence requires being able to build the attack.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = -1
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

export interface RawZipEntry {
  name: string
  data: Buffer | string
  /** Unix mode. `0o120777` marks a symlink. */
  mode?: number
  /** Override the declared uncompressed size, to simulate a lying header. */
  declaredUncompressedSize?: number
  /** Store instead of deflate. */
  store?: boolean
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

export function rawZip(entries: readonly RawZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const store = entry.store ?? false
    const body = store ? data : deflateRawSync(data)
    const method = store ? 0 : 8
    const uncompressed = entry.declaredUncompressedSize ?? data.length
    const crc = crc32(data)
    const mode = entry.mode ?? 0o100644

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x21, 12) // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(uncompressed, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(0x031e, 4) // made by: unix, zip 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(uncompressed, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE((mode << 16) >>> 0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuffer, eocd])
}

/** A minimal well-formed crypto bundle, for tests that need a valid one. */
export interface BundleOptions {
  flagMode?: 'static' | 'substitute' | 'generate'
  includeSolver?: boolean
  includeWriteup?: boolean
  includeGenerator?: boolean
  extraFiles?: RawZipEntry[]
  challengeYaml?: string
}

/** The literal flag a `static` example bundle declares. */
export const STATIC_FLAG = 'ayactf{staticflagbakedin}'

export function goodBundleYaml(mode: BundleOptions['flagMode'] = 'generate'): string {
  const flagBlock =
    mode === 'generate'
      ? '    mode: generate\n    generator: server_files/generate.py'
      : mode === 'substitute'
        ? '    mode: substitute\n    substituteIn: ["release_files/hint.txt"]'
        : '    mode: static'
  // A static bundle must declare its literal flag: there is nothing to
  // generate, so that is the only thing verification can check against.
  const flags = mode === 'static' ? `flags:\n  - ${STATIC_FLAG}\n` : ''
  return `name: Shared Primes
author: aya
category: crypto
description: Two moduli generated carelessly.
value: 300
${flags}aya:
  scheme: rsa-weakness
  difficulty: easy
  flag:
${flagBlock}
    format: "ayactf{%s}"
  solver:
    entrypoint: solver/solve.py
    profile: python-crypto
    timeoutMs: 30000
  license: event
`
}

export function goodBundle(options: BundleOptions = {}): Buffer {
  const mode = options.flagMode ?? 'generate'
  const entries: RawZipEntry[] = [
    { name: 'challenge.yml', data: options.challengeYaml ?? goodBundleYaml(mode) },
    { name: 'release_files/output.txt', data: 'n = 1234\nc = 5678\n' },
  ]
  if (mode === 'substitute') {
    entries.push({ name: 'release_files/hint.txt', data: 'the flag is {{FLAG}}' })
  }
  if (options.includeGenerator ?? mode === 'generate') {
    entries.push({
      name: 'server_files/generate.py',
      data: 'import os\nopen("output.txt","w").write(os.environ["FLAG"])\n',
    })
  }
  if (options.includeSolver ?? true) {
    entries.push({ name: 'solver/solve.py', data: 'print(open("/work/release_files/output.txt").read())\n' })
  }
  if (options.includeWriteup ?? true) {
    entries.push({ name: 'writeup.md', data: '# Solution\n\nFactor with gcd.\n' })
  }
  entries.push(...(options.extraFiles ?? []))
  return rawZip(entries)
}
