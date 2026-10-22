import { singleton } from '@/lib/core/singleton'
import { AppError } from '@/lib/core/errors'

/**
 * Failed-login throttling.
 *
 * Two things need it. The obvious one is credential stuffing. The less obvious
 * one is that scrypt is expensive *by design*, so an unthrottled login endpoint
 * is a CPU exhaustion vector — an attacker does not need to guess a password to
 * take the server down with password guesses.
 *
 * Counted per source address **and** per username: an attacker spreading
 * attempts across a botnet defeats a per-IP limit, and one spreading across
 * accounts defeats a per-username limit. Neither alone is enough.
 *
 * In-memory, matching the rest of the zero-infra default. A multi-process
 * deployment would back it with Redis.
 */

const WINDOW_MS = 15 * 60 * 1000

interface Bucket {
  count: number
  resetAt: number
}

function buckets(): Map<string, Bucket> {
  return singleton('auth.rate-limit', () => new Map<string, Bucket>())
}

function maxAttempts(): number {
  const raw = process.env.AYA_LOGIN_MAX_ATTEMPTS
  const parsed = raw === undefined || raw === '' ? 5 : Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5
}

function hit(key: string, now: number): Bucket {
  const map = buckets()
  const existing = map.get(key)

  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + WINDOW_MS }
    map.set(key, fresh)
    return fresh
  }
  return existing
}

/** Throws when either bucket is exhausted. Call before verifying a password. */
export function assertLoginAllowed(ip: string, email: string, now = Date.now()): void {
  const limit = maxAttempts()

  for (const key of [`ip:${ip}`, `user:${email.trim().toLowerCase()}`]) {
    const bucket = hit(key, now)
    if (bucket.count >= limit) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000)
      throw new AppError(
        'rate_limited',
        `Too many failed sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`,
      )
    }
  }
}

export function recordFailedLogin(ip: string, email: string, now = Date.now()): void {
  for (const key of [`ip:${ip}`, `user:${email.trim().toLowerCase()}`]) {
    hit(key, now).count += 1
  }
}

/** A success clears both buckets — the person proved they are not guessing. */
export function clearLoginAttempts(ip: string, email: string): void {
  const map = buckets()
  map.delete(`ip:${ip}`)
  map.delete(`user:${email.trim().toLowerCase()}`)
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is trivially spoofed, which is exactly why the per-username
 * bucket exists: spoofing the header moves an attacker between IP buckets but
 * not between account buckets.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64)
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? 'unknown'
}
