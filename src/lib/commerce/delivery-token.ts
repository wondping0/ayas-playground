import { createHmac, timingSafeEqual } from 'node:crypto'
import { secrets } from '@/lib/core/config'
import { AppError } from '@/lib/core/errors'

/**
 * Short-lived, signed download links.
 *
 * The artifact is a paid deliverable, so its URL is a capability: anyone
 * holding it can download. Signing it means the server need not keep a table of
 * live links, and expiring it bounds how long a leaked URL is worth anything.
 */

const SEPARATOR = '.'

function sign(payload: string): string {
  return createHmac('sha256', secrets.auth()).update('aya.download.v1').update(payload).digest('base64url')
}

export function signDownloadToken(deliveryId: string, expiresAt: Date): string {
  const payload = `${deliveryId}${SEPARATOR}${expiresAt.getTime()}`
  return `${payload}${SEPARATOR}${sign(payload)}`
}

export interface DownloadClaim {
  deliveryId: string
  expiresAt: Date
}

/**
 * Verify a token.
 *
 * Signature first, expiry second: checking expiry on an unverified token would
 * let a caller learn whether a forged token's timestamp was in range.
 */
export function verifyDownloadToken(token: string, now = new Date()): DownloadClaim {
  const parts = token.split(SEPARATOR)
  if (parts.length !== 3) {
    throw new AppError('forbidden', 'Malformed download token.')
  }

  const [deliveryId, expiryText, signature] = parts as [string, string, string]
  const expected = sign(`${deliveryId}${SEPARATOR}${expiryText}`)

  if (signature.length !== expected.length) {
    throw new AppError('forbidden', 'Invalid download token.')
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new AppError('forbidden', 'Invalid download token.')
  }

  const expiresAtMs = Number(expiryText)
  if (!Number.isFinite(expiresAtMs)) {
    throw new AppError('forbidden', 'Invalid download token.')
  }
  if (expiresAtMs <= now.getTime()) {
    throw new AppError('delivery_expired', 'This download link has expired. Request a new one.')
  }

  return { deliveryId, expiresAt: new Date(expiresAtMs) }
}
