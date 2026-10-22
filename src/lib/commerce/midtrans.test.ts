import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/core/errors'
import { rupiah } from '@/lib/core/money'
import {
  HttpMidtransClient,
  OfflineMidtransClient,
  assertValidSignature,
  computeSignature,
  getMidtransClient,
  mapTransactionStatus,
  offlinePaymentsAllowed,
  notificationAmount,
  parseNotification,
  signNotification,
  verifySignature,
  type MidtransNotification,
  type NotificationFields,
} from './midtrans'

const SERVER_KEY = 'SB-Mid-server-EXAMPLE'

function notification(overrides: Partial<NotificationFields> = {}): MidtransNotification {
  return signNotification(
    {
      order_id: 'AYA-ord_01',
      status_code: '200',
      gross_amount: '150000.00',
      transaction_status: 'settlement',
      payment_type: 'qris',
      ...overrides,
    },
    SERVER_KEY,
  )
}

describe('signature verification', () => {
  it('accepts a correctly signed notification', () => {
    expect(verifySignature(notification(), SERVER_KEY)).toBe(true)
  })

  it('uses the documented sha512 construction', () => {
    const expected = computeSignature('AYA-ord_01', '200', '150000.00', SERVER_KEY)
    expect(notification().signature_key).toBe(expected)
    expect(expected).toHaveLength(128)
  })

  it.each([
    ['the order id', { order_id: 'AYA-ord_02' }],
    ['the status code', { status_code: '201' }],
    ['the amount', { gross_amount: '1.00' }],
  ])('rejects a notification whose %s was altered after signing', (_label, tamper) => {
    const signed = notification()
    const tampered = { ...signed, ...tamper }
    expect(verifySignature(tampered, SERVER_KEY)).toBe(false)
  })

  it('rejects a signature from a different server key', () => {
    const signed = signNotification(
      {
        order_id: 'AYA-ord_01',
        status_code: '200',
        gross_amount: '150000.00',
        transaction_status: 'settlement',
      },
      'attacker-key',
    )
    expect(verifySignature(signed, SERVER_KEY)).toBe(false)
  })

  it.each([
    ['an empty signature', ''],
    ['a truncated signature', 'abc'],
    ['a signature of the wrong length', 'a'.repeat(127)],
    ['a signature of nearly the right length', 'a'.repeat(129)],
  ])('rejects %s without throwing', (_label, signature_key) => {
    const tampered = { ...notification(), signature_key: signature_key || 'x' }
    expect(() => verifySignature(tampered, SERVER_KEY)).not.toThrow()
    expect(verifySignature(tampered, SERVER_KEY)).toBe(false)
  })

  it('accepts an uppercase signature', () => {
    const signed = notification()
    const upper = { ...signed, signature_key: signed.signature_key.toUpperCase() }
    expect(verifySignature(upper, SERVER_KEY)).toBe(true)
  })

  it('throws a typed error when asserted', () => {
    const tampered = { ...notification(), order_id: 'other' }
    expect(() => assertValidSignature(tampered, SERVER_KEY)).toThrow(AppError)
    try {
      assertValidSignature(tampered, SERVER_KEY)
    } catch (error) {
      expect((error as AppError).code).toBe('payment_signature_invalid')
      expect((error as AppError).status).toBe(401)
    }
  })

  it('signs the amount string verbatim', () => {
    // Midtrans signs "150000.00", not 150000. Normalising before hashing
    // produces a signature that never matches.
    expect(notificationAmount(rupiah(150_000))).toBe('150000.00')
    const withDecimals = notification({ gross_amount: '150000.00' })
    const withoutDecimals = { ...withDecimals, gross_amount: '150000' }
    expect(verifySignature(withoutDecimals, SERVER_KEY)).toBe(false)
  })
})

describe('parseNotification', () => {
  it('accepts a well-formed body and keeps unknown fields', () => {
    const parsed = parseNotification({ ...notification(), merchant_id: 'G123' })
    expect(parsed.order_id).toBe('AYA-ord_01')
    expect((parsed as Record<string, unknown>).merchant_id).toBe('G123')
  })

  it.each([
    ['a missing order id', { order_id: undefined }],
    ['a missing signature', { signature_key: undefined }],
    ['a missing transaction status', { transaction_status: undefined }],
    ['a numeric amount', { gross_amount: 150000 }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseNotification({ ...notification(), ...override })).toThrow(AppError)
  })

  it.each([null, undefined, 'string', 42, []])('rejects a non-object body: %s', (body) => {
    expect(() => parseNotification(body)).toThrow(AppError)
  })
})

describe('provider selection fails closed', () => {
  const original = { env: process.env.AYA_ENV, key: process.env.MIDTRANS_SERVER_KEY }

  afterEach(() => {
    process.env.AYA_ENV = original.env
    process.env.MIDTRANS_SERVER_KEY = original.key
  })

  it('uses the offline client in development when no key is set', () => {
    process.env.AYA_ENV = 'development'
    delete process.env.MIDTRANS_SERVER_KEY
    expect(getMidtransClient()).toBeInstanceOf(OfflineMidtransClient)
    expect(offlinePaymentsAllowed()).toBe(true)
  })

  it('refuses to run in production without a key', () => {
    // The alternative — falling back to the offline client — is a free
    // checkout, because /api/payments/offline asks this function whether it is
    // allowed to exist.
    process.env.AYA_ENV = 'production'
    delete process.env.MIDTRANS_SERVER_KEY
    expect(() => getMidtransClient()).toThrow(/Refusing to accept payments/)
    expect(offlinePaymentsAllowed()).toBe(false)
  })

  it('never allows offline payments in production, even with a key', () => {
    process.env.AYA_ENV = 'production'
    process.env.MIDTRANS_SERVER_KEY = 'Mid-server-REAL'
    expect(getMidtransClient()).toBeInstanceOf(HttpMidtransClient)
    expect(offlinePaymentsAllowed()).toBe(false)
  })

  it('uses the real client as soon as a non-placeholder key is configured', () => {
    process.env.AYA_ENV = 'development'
    process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-ACTUALKEY'
    expect(getMidtransClient()).toBeInstanceOf(HttpMidtransClient)
    expect(offlinePaymentsAllowed()).toBe(false)
  })
})

describe('mapTransactionStatus', () => {
  it.each([
    ['settlement', undefined, 'paid'],
    ['capture', 'accept', 'paid'],
    ['capture', 'deny', 'failed'],
    ['deny', undefined, 'failed'],
    ['failure', undefined, 'failed'],
    ['cancel', undefined, 'cancelled'],
    ['expire', undefined, 'expired'],
    ['refund', undefined, 'refunded'],
    ['partial_refund', undefined, 'refunded'],
  ])('maps %s/%s to %s', (transaction_status, fraud_status, expected) => {
    const mapping = mapTransactionStatus(notification({ transaction_status, fraud_status }))
    expect(mapping.target).toBe(expected)
  })

  it('leaves a pending transaction alone', () => {
    const mapping = mapTransactionStatus(notification({ transaction_status: 'pending' }))
    expect(mapping.target).toBeNull()
    expect(mapping.needsReview).toBe(false)
  })

  it('holds a fraud-challenged capture for review rather than delivering', () => {
    // Treating `challenge` as paid delivers a challenge for money that can
    // still be clawed back.
    const mapping = mapTransactionStatus(
      notification({ transaction_status: 'capture', fraud_status: 'challenge' }),
    )
    expect(mapping.target).toBeNull()
    expect(mapping.needsReview).toBe(true)
  })

  it('holds a capture with no fraud status for review', () => {
    const mapping = mapTransactionStatus(notification({ transaction_status: 'capture' }))
    expect(mapping.target).toBeNull()
    expect(mapping.needsReview).toBe(true)
  })

  it('flags an unrecognised status instead of guessing', () => {
    const mapping = mapTransactionStatus(
      notification({ transaction_status: 'something_new_midtrans_added' }),
    )
    expect(mapping.target).toBeNull()
    expect(mapping.needsReview).toBe(true)
  })

  it('is case-insensitive about the status', () => {
    expect(mapTransactionStatus(notification({ transaction_status: 'SETTLEMENT' })).target).toBe(
      'paid',
    )
    expect(
      mapTransactionStatus(
        notification({ transaction_status: 'Capture', fraud_status: 'ACCEPT' }),
      ).target,
    ).toBe('paid')
  })
})
