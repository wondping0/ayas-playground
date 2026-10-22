import { cookies } from 'next/headers'
import { AppError, err } from '@/lib/core/errors'
import type { Role, User } from '@/lib/core/types'
import { getStore } from '@/lib/store'
import { SESSION_COOKIE, readSession, type SessionClaims } from './session'

/**
 * Route guards.
 *
 * The session cookie carries claims, but authorization always re-reads the
 * user: roles can be revoked, and a token minted before the revocation would
 * otherwise keep working for its full seven days.
 */

export async function currentClaims(): Promise<SessionClaims | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  return readSession(token)
}

export async function currentUser(): Promise<User | null> {
  const claims = await currentClaims()
  if (!claims) return null
  return getStore().users.get(claims.userId)
}

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw err.unauthenticated()
  return user
}

export async function requireRole(role: Role): Promise<User> {
  const user = await requireUser()
  if (!user.roles.includes(role)) {
    throw new AppError('forbidden', `This needs the "${role}" role.`)
  }
  return user
}

export async function requireAdmin(): Promise<User> {
  return requireRole('admin')
}

/** The owner of a resource, or an admin. */
export function assertOwnerOrAdmin(user: User, ownerId: string): void {
  if (user.id !== ownerId && !user.roles.includes('admin')) {
    throw err.forbidden('You do not have access to this.')
  }
}
