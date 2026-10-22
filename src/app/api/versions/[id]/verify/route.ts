import { NextResponse } from 'next/server'
import { assertOwnerOrAdmin, requireUser } from '@/lib/auth'
import { verifyVersion } from '@/lib/catalog'
import { err } from '@/lib/core/errors'
import { handle, json } from '@/lib/http/respond'
import { getStore } from '@/lib/store'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return handle(async () => {
    const user = await requireUser()
    const store = getStore()

    const version = await store.versions.get(params.id)
    if (!version) throw err.notFound('Version')

    const challenge = await store.challenges.get(version.challengeId)
    if (!challenge) throw err.notFound('Challenge')
    assertOwnerOrAdmin(user, challenge.sellerId)

    const verification = await verifyVersion(version.id, user.id)

    return json({
      verification: {
        id: verification.id,
        verdict: verification.verdict,
        message: verification.message,
        durationMs: verification.durationMs,
        runner: verification.runnerKind,
        log: verification.log,
      },
    })
  })
}
