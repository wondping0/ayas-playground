import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import type { Role, User } from '@/lib/core/types'
import { auditEntry, getStore } from '@/lib/store'

/**
 * Accounts.
 *
 * Passwords are scrypt-hashed with a per-user salt; nothing is ever stored in a
 * form that can be reversed. The comparison is constant-time.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MIN_PASSWORD = 10
const MAX_PASSWORD = 200

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false

  const salt = Buffer.from(parts[1]!, 'base64')
  const expected = Buffer.from(parts[2]!, 'base64')
  if (expected.length !== KEY_LENGTH) return false

  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return timingSafeEqual(derived, expected)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateCredentials(email: string, password: string): void {
  const normalized = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) {
    throw err.validation('That does not look like an email address.')
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw err.validation(`A password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`)
  }
}

export interface RegisterInput {
  email: string
  password: string
  name: string
  roles?: Role[]
}

export async function register(input: RegisterInput): Promise<User> {
  const store = getStore()
  validateCredentials(input.email, input.password)

  const name = input.name.trim()
  if (name.length === 0 || name.length > 80) {
    throw err.validation('A display name must be between 1 and 80 characters.')
  }

  // The first account is the administrator; there is nobody to grant it
  // otherwise, and a marketplace with no moderator is not usable.
  const isFirst = (await store.users.count()) === 0
  const roles: Role[] = isFirst ? ['buyer', 'seller', 'admin'] : (input.roles ?? ['buyer'])

  const user = await store.users.create({
    id: newId('user'),
    email: normalizeEmail(input.email),
    name,
    passwordHash: await hashPassword(input.password),
    roles,
    createdAt: new Date(),
  })

  await store.audit.append(
    auditEntry(user.id, 'user.registered', 'user', user.id, { roles }),
  )

  return user
}

/**
 * Check a login.
 *
 * A wrong email and a wrong password produce the same result and take
 * comparable time: the dummy hash below means a missing account still pays the
 * scrypt cost, so response timing does not reveal which addresses exist.
 */
const DUMMY_HASH =
  'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(KEY_LENGTH).toString('base64')

export async function authenticate(email: string, password: string): Promise<User | null> {
  const store = getStore()
  const user = await store.users.getByEmail(normalizeEmail(email))

  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok) return null

  return user
}

export async function grantRole(userId: string, role: Role, actor: string): Promise<User> {
  const store = getStore()
  const user = await store.users.get(userId)
  if (!user) throw err.notFound('User')
  if (user.roles.includes(role)) return user

  const updated = await store.users.update(userId, { roles: [...user.roles, role] })
  await store.audit.append(auditEntry(actor, 'user.role_granted', 'user', userId, { role }))
  return updated
}

export function hasRole(user: Pick<User, 'roles'>, role: Role): boolean {
  return user.roles.includes(role)
}
