import { secrets } from '@/lib/core/config'
import { AppError } from '@/lib/core/errors'
import type { Role } from '@/lib/core/types'

/**
 * Stateless session tokens.
 *
 * Signed with Web Crypto rather than `node:crypto` so the identical verify runs
 * in Edge middleware and in a Node route handler. Revoking everything means
 * rotating AYA_AUTH_SECRET; per-session revocation would need a store, which
 * the zero-infra default does not have.
 */

export const SESSION_COOKIE = 'aya_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionClaims {
  userId: string
  email: string
  name: string
  roles: Role[]
  expiresAt: number
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  // Allocated rather than `Uint8Array.from`, so the buffer type is a plain
  // ArrayBuffer — Web Crypto's BufferSource will not accept ArrayBufferLike.
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secrets.auth()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function createSession(
  claims: Omit<SessionClaims, 'expiresAt'>,
  now = Date.now(),
): Promise<string> {
  const payload: SessionClaims = { ...claims, expiresAt: now + SESSION_TTL_MS }
  const body = base64url(encoder.encode(JSON.stringify(payload)))
  const signature = base64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', await key(), encoder.encode(body))),
  )
  return `${body}.${signature}`
}

/**
 * Verify a token, or return null.
 *
 * Returns null rather than throwing for every failure mode, because a missing
 * or stale cookie is the ordinary case for a logged-out visitor, not an error
 * worth an exception.
 */
export async function readSession(
  token: string | undefined | null,
  now = Date.now(),
): Promise<SessionClaims | null> {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts as [string, string]

  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await key(),
      fromBase64url(signature),
      encoder.encode(body),
    )
  } catch {
    return null
  }
  if (!valid) return null

  let claims: SessionClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionClaims
  } catch {
    return null
  }

  if (typeof claims?.userId !== 'string' || typeof claims?.expiresAt !== 'number') return null
  if (claims.expiresAt <= now) return null
  if (!Array.isArray(claims.roles)) return null

  return claims
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }
}

export function requireSession(claims: SessionClaims | null): SessionClaims {
  if (!claims) throw new AppError('unauthenticated', 'Sign in to continue.')
  return claims
}
