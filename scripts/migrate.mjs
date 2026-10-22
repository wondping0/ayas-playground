#!/usr/bin/env node
/**
 * Apply src/lib/store/schema.sql to DATABASE_URL.
 *
 * Idempotent — the schema is written with IF NOT EXISTS throughout — so this is
 * safe to run on every deploy and safe to run twice.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pg = require('pg')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const sql = await readFile(join(here, '..', 'src', 'lib', 'store', 'schema.sql'), 'utf8')

const pool = new pg.Pool({ connectionString: url })
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('Schema applied.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Migration failed:', error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
