#!/usr/bin/env node
/**
 * Seed a running server with the example challenges.
 *
 * Deliberately drives the real HTTP API rather than reaching into the store:
 * that way the seed exercises upload, sandbox verification, the publish gate,
 * and checkout exactly as a person would, and a broken route fails here rather
 * than in a demo.
 *
 *   npm run dev            # in one terminal, with AYA_RUNNER=docker
 *   node scripts/seed.mjs  # in another
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import yazl from 'yazl'

const BASE = process.env.AYA_BASE_URL ?? 'http://localhost:3000'
const here = dirname(fileURLToPath(import.meta.url))
const examplesDir = join(here, '..', 'examples')

const PASSWORD = 'correct-horse-battery-staple'

const ACCOUNTS = {
  admin: { email: 'admin@aya.test', name: 'Aya', seller: true },
  seller: { email: 'sella@aya.test', name: 'Sella Rahman', seller: true },
  buyer: { email: 'buya@aya.test', name: 'Buya Pratama', seller: false },
}

const LISTINGS = {
  'shared-primes': {
    price: 150_000,
    licenseType: 'event',
    summary:
      'Two moduli from the same careless generator run. Rewards recognising the scheme, not implementing anything.',
  },
  'many-time-pad': {
    price: 95_000,
    licenseType: 'event',
    summary:
      'One keystream, five messages, and a pangram you already know. A clean first taste of keystream reuse.',
  },
}

// --- tiny HTTP client with a cookie jar -------------------------------------

function makeClient() {
  let cookie = ''

  return async function call(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
      redirect: 'manual',
    })

    const set = response.headers.getSetCookie?.() ?? []
    for (const entry of set) {
      const pair = entry.split(';')[0]
      if (pair) cookie = pair
    }

    const text = await response.text()
    let body
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { raw: text.slice(0, 200) }
    }
    return { ok: response.ok, status: response.status, body }
  }
}

// --- zipping ----------------------------------------------------------------

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full, base)))
    else if (entry.isFile()) files.push(relative(base, full).split(sep).join('/'))
  }
  return files.sort()
}

async function zipDirectory(dir) {
  const zip = new yazl.ZipFile()
  for (const path of await walk(dir)) {
    zip.addBuffer(await readFile(join(dir, path)), path, { mtime: new Date(0), mode: 0o644 })
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    zip.outputStream.on('data', (chunk) => chunks.push(chunk))
    zip.outputStream.on('error', reject)
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.end()
  })
}

// --- steps ------------------------------------------------------------------

async function signIn(client, account) {
  const registered = await client('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, password: PASSWORD }),
  })
  if (registered.ok) return { created: true, user: registered.body.user }

  const loggedIn = await client('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: PASSWORD }),
  })
  if (!loggedIn.ok) {
    throw new Error(
      `Could not sign in as ${account.email}: ${loggedIn.body?.error?.message ?? loggedIn.status}`,
    )
  }
  return { created: false, user: loggedIn.body.user }
}

async function publishExample(client, name) {
  const dir = join(examplesDir, name)
  if (!(await stat(dir).catch(() => null))) {
    console.log(`  ! ${name}: no such example`)
    return null
  }

  const zip = await zipDirectory(dir)
  const form = new FormData()
  form.set('bundle', new Blob([zip], { type: 'application/zip' }), `${name}.zip`)

  const uploaded = await client('/api/challenges', { method: 'POST', body: form })
  if (!uploaded.ok) {
    console.log(`  ! ${name}: ${uploaded.body?.error?.message ?? uploaded.status}`)
    for (const issue of uploaded.body?.error?.details?.issues ?? []) {
      console.log(`      ${issue.path} — ${issue.message}`)
    }
    return null
  }

  const { challenge, version, verification } = uploaded.body
  console.log(
    `  + ${challenge.title}: verification ${verification.verdict} ` +
      `(${verification.runner}, ${verification.durationMs} ms)`,
  )
  if (verification.verdict !== 'passed') {
    console.log(`      ${verification.message}`)
    console.log('      Not published — the gate requires a passing verdict.')
    return null
  }

  const config = LISTINGS[name]
  const listed = await client('/api/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: version.id, ...config }),
  })
  if (!listed.ok) {
    console.log(`  ! ${name}: could not list — ${listed.body?.error?.message ?? listed.status}`)
    return null
  }

  const published = await client(`/api/listings/${listed.body.listing.id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!published.ok) {
    console.log(`  ! ${name}: could not publish — ${published.body?.error?.message ?? published.status}`)
    return null
  }

  console.log(`      published at /c/${published.body.listing.slug} — Rp ${config.price.toLocaleString('id-ID')}`)
  return published.body.listing
}

// --- run --------------------------------------------------------------------

const health = await fetch(BASE).catch(() => null)
if (!health) {
  console.error(`No server at ${BASE}. Start it with \`npm run dev\` first.`)
  process.exit(1)
}

console.log(`Seeding ${BASE}\n`)

console.log('Accounts')
const admin = makeClient()
const first = await signIn(admin, ACCOUNTS.admin)
console.log(`  ${first.created ? '+' : '·'} ${ACCOUNTS.admin.email} (${first.user.roles.join(', ')})`)

const seller = makeClient()
const sellerAccount = await signIn(seller, ACCOUNTS.seller)
console.log(`  ${sellerAccount.created ? '+' : '·'} ${ACCOUNTS.seller.email} (${sellerAccount.user.roles.join(', ')})`)

const buyer = makeClient()
const buyerAccount = await signIn(buyer, ACCOUNTS.buyer)
console.log(`  ${buyerAccount.created ? '+' : '·'} ${ACCOUNTS.buyer.email} (${buyerAccount.user.roles.join(', ')})`)

console.log('\nChallenges')
const published = []
for (const name of Object.keys(LISTINGS)) {
  const listing = await publishExample(seller, name)
  if (listing) published.push(listing)
}

console.log(`\n${published.length} listing(s) live.`)
console.log(`\nSign in at ${BASE}/login`)
console.log(`  buyer   ${ACCOUNTS.buyer.email} / ${PASSWORD}`)
console.log(`  seller  ${ACCOUNTS.seller.email} / ${PASSWORD}`)
console.log(`  admin   ${ACCOUNTS.admin.email} / ${PASSWORD}`)
