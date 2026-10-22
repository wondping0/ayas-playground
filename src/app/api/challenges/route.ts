import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { submitBundle, verifyVersion } from '@/lib/catalog'
import { bundleLimits } from '@/lib/core/config'
import { err } from '@/lib/core/errors'
import { handle, json } from '@/lib/http/respond'

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const seller = await requireRole('seller')

    const form = await request.formData().catch(() => null)
    if (!form) throw err.validation('Send the bundle as multipart form data.')

    const file = form.get('bundle')
    if (!(file instanceof File)) throw err.validation('Attach a .zip bundle as "bundle".')

    const limit = bundleLimits.maxUploadBytes()
    if (file.size > limit) {
      throw err.validation(`That bundle is ${file.size} bytes; the limit is ${limit}.`)
    }

    const challengeId = form.get('challengeId')
    const data = Buffer.from(await file.arrayBuffer())

    const result = await submitBundle({
      seller,
      data,
      ...(typeof challengeId === 'string' && challengeId ? { challengeId } : {}),
    })

    // Verification is the point of submitting, so it runs immediately rather
    // than waiting for a second click that a seller would have to know about.
    const verification = await verifyVersion(result.version.id, seller.id)

    return json(
      {
        challenge: { id: result.challenge.id, title: result.challenge.title, slug: result.challenge.slug },
        version: { id: result.version.id, ordinal: result.version.ordinal, bundleHash: result.version.bundleHash },
        verification: {
          verdict: verification.verdict,
          message: verification.message,
          durationMs: verification.durationMs,
          runner: verification.runnerKind,
        },
      },
      201,
    )
  })
}
