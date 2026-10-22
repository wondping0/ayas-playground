import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/core/errors'
import { setSingleton } from '@/lib/core/singleton'
import {
  assertLoginAllowed,
  clearLoginAttempts,
  clientAddress,
  recordFailedLogin,
} from './rate-limit'

beforeEach(() => {
  setSingleton('auth.rate-limit', null)
  process.env.AYA_LOGIN_MAX_ATTEMPTS = '3'
})

afterEach(() => {
  delete process.env.AYA_LOGIN_MAX_ATTEMPTS
  setSingleton('auth.rate-limit', null)
})

describe('assertLoginAllowed', () => {
  it('allows attempts below the limit', () => {
    for (let i = 0; i < 3; i++) {
      expect(() => assertLoginAllowed('1.1.1.1', 'a@b.test')).not.toThrow()
      recordFailedLogin('1.1.1.1', 'a@b.test')
    }
  })

  it('blocks once the limit is reached', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'a@b.test')
    expect(() => assertLoginAllowed('1.1.1.1', 'a@b.test')).toThrow(AppError)
  })

  it('blocks an attacker who rotates the source address', () => {
    // Per-IP alone would let a botnet through; the per-account bucket does not.
    for (let i = 0; i < 3; i++) recordFailedLogin(`10.0.0.${i}`, 'victim@b.test')
    expect(() => assertLoginAllowed('10.0.0.99', 'victim@b.test')).toThrow(AppError)
  })

  it('blocks an attacker who rotates the account', () => {
    // Per-account alone would let a spray through; the per-IP bucket does not.
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', `user${i}@b.test`)
    expect(() => assertLoginAllowed('1.1.1.1', 'someone-else@b.test')).toThrow(AppError)
  })

  it('does not block an unrelated person', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'a@b.test')
    expect(() => assertLoginAllowed('2.2.2.2', 'c@d.test')).not.toThrow()
  })

  it('treats an address differing only in case or spacing as the same account', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'A@B.test')
    expect(() => assertLoginAllowed('9.9.9.9', '  a@b.TEST ')).toThrow(AppError)
  })

  it('clears both buckets on a successful sign-in', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'a@b.test')
    clearLoginAttempts('1.1.1.1', 'a@b.test')
    expect(() => assertLoginAllowed('1.1.1.1', 'a@b.test')).not.toThrow()
  })

  it('lets the window lapse', () => {
    const start = 1_000_000
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'a@b.test', start)
    expect(() => assertLoginAllowed('1.1.1.1', 'a@b.test', start)).toThrow(AppError)
    expect(() =>
      assertLoginAllowed('1.1.1.1', 'a@b.test', start + 16 * 60 * 1000),
    ).not.toThrow()
  })

  it('reports a retry time rather than a bare refusal', () => {
    for (let i = 0; i < 3; i++) recordFailedLogin('1.1.1.1', 'a@b.test')
    expect(() => assertLoginAllowed('1.1.1.1', 'a@b.test')).toThrow(/Try again in \d+ minutes/)
  })
})

describe('clientAddress', () => {
  it('reads the first hop of x-forwarded-for', () => {
    const request = new Request('http://x/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    })
    expect(clientAddress(request)).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientAddress(new Request('http://x/', { headers: { 'x-real-ip': '198.51.100.4' } }))).toBe(
      '198.51.100.4',
    )
    expect(clientAddress(new Request('http://x/'))).toBe('unknown')
  })

  it('bounds the length of a hostile header', () => {
    const request = new Request('http://x/', { headers: { 'x-forwarded-for': 'a'.repeat(5_000) } })
    expect(clientAddress(request).length).toBeLessThanOrEqual(64)
  })
})
