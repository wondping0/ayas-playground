/**
 * Licences.
 *
 * The terms are *snapshotted onto the order* at purchase. A seller who later
 * changes what they offer must never retroactively change what somebody has
 * already bought, so nothing downstream reads the licence off the listing.
 */

export const LICENSE_TYPES = ['practice', 'event', 'unlimited'] as const
export type LicenseType = (typeof LICENSE_TYPES)[number]

export interface LicenseDefinition {
  type: LicenseType
  name: string
  /** One line, shown on the listing card. */
  summary: string
  grants: readonly string[]
  restrictions: readonly string[]
}

export const LICENSES: Record<LicenseType, LicenseDefinition> = {
  practice: {
    type: 'practice',
    name: 'Personal practice',
    summary: 'Solve it yourself. Not for running an event.',
    grants: [
      'Use the challenge privately, for your own learning.',
      'Modify it for your own use.',
    ],
    restrictions: [
      'Do not deploy it in any competition, training, or event with other participants.',
      'Do not redistribute the challenge, its solution, or its writeup.',
    ],
  },
  event: {
    type: 'event',
    name: 'Single event',
    summary: 'Run it at one named event, unlimited players.',
    grants: [
      'Deploy the challenge at one named event, for its duration.',
      'Unlimited participants at that event.',
      'Publish a solution or writeup after the event ends.',
    ],
    restrictions: [
      'One event only. A second event needs a second licence.',
      'Do not redistribute the source bundle to participants.',
    ],
  },
  unlimited: {
    type: 'unlimited',
    name: 'Unlimited events',
    summary: 'Run it at any number of your own events, forever.',
    grants: [
      'Deploy the challenge at any number of events run by the purchasing organisation.',
      'Unlimited participants.',
      'Modify and translate it.',
      'Publish solutions or writeups.',
    ],
    restrictions: [
      'Do not resell, sublicense, or list the challenge on another marketplace.',
      'The licence covers the purchasing organisation, not its clients.',
    ],
  },
}

/** The immutable record written onto an order. */
export interface LicenseTerms {
  type: LicenseType
  name: string
  summary: string
  grants: readonly string[]
  restrictions: readonly string[]
  /** Version of the terms text, so a change is visible in old orders. */
  termsVersion: string
}

export const TERMS_VERSION = '2026-09-02'

export function snapshotLicense(type: LicenseType): LicenseTerms {
  const def = LICENSES[type]
  return {
    type: def.type,
    name: def.name,
    summary: def.summary,
    grants: [...def.grants],
    restrictions: [...def.restrictions],
    termsVersion: TERMS_VERSION,
  }
}

export interface LicenseTextInput {
  terms: LicenseTerms
  challengeTitle: string
  sellerName: string
  buyerName: string
  orderId: string
  purchasedAt: Date
}

/** The `LICENSE.txt` shipped inside every delivered bundle. */
export function renderLicenseText(input: LicenseTextInput): string {
  const { terms } = input
  const lines: string[] = [
    "Aya's Playground — challenge licence",
    '='.repeat(40),
    '',
    `Challenge:  ${input.challengeTitle}`,
    `Author:     ${input.sellerName}`,
    `Licensed to:${' '.repeat(1)} ${input.buyerName}`,
    `Order:      ${input.orderId}`,
    `Purchased:  ${input.purchasedAt.toISOString()}`,
    `Licence:    ${terms.name} (terms ${terms.termsVersion})`,
    '',
    'You may:',
    ...terms.grants.map((g) => `  - ${g}`),
    '',
    'You may not:',
    ...terms.restrictions.map((r) => `  - ${r}`),
    '',
    'This copy is watermarked.',
    'The flag in this bundle was generated for this order and no other. If it',
    'appears somewhere it should not, it identifies this purchase.',
    '',
  ]
  return lines.join('\n')
}
