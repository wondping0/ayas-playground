import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { maturePayouts, pendingReleases, releasePayout } from '@/lib/commerce'
import { err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'

export async function GET(): Promise<NextResponse> {
  return handle(async () => {
    await requireAdmin()
    return json({ balances: await pendingReleases() })
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const admin = await requireAdmin()
    const body = await readJson<{ action?: string; sellerId?: string; amount?: number; reference?: string }>(
      request,
    )

    if (body.action === 'mature') {
      // Normally a scheduled job; exposed here so an operator can run it.
      return json({ matured: await maturePayouts() })
    }

    if (!body.sellerId) throw err.validation('A seller id is required.')
    if (typeof body.amount !== 'number') throw err.validation('An amount is required.')

    const release = await releasePayout({
      sellerId: body.sellerId,
      amount: body.amount,
      reference: body.reference ?? '',
      admin,
    })

    return json({ release: { id: release.id, amount: release.amount } }, 201)
  })
}
