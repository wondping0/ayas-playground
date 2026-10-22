import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { issueDownloadLink, redeemDownload } from '@/lib/commerce'
import { handle, json } from '@/lib/http/respond'

/**
 * Two steps on one route.
 *
 * Without a token, issue one. With a token, redeem it and stream the bytes.
 * Splitting them means the link that appears in a page is short-lived and
 * counted, rather than the page itself being the capability.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return handle(async () => {
    const user = await requireUser()
    const token = new URL(request.url).searchParams.get('token')

    if (!token) {
      const link = await issueDownloadLink(params.id, user)
      return json({
        token: link.token,
        expiresAt: link.expiresAt.toISOString(),
        remaining: link.remaining,
        sizeBytes: link.sizeBytes,
      })
    }

    const payload = await redeemDownload(token, user)

    return new NextResponse(new Uint8Array(payload.data), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(payload.data.length),
        'Content-Disposition': `attachment; filename="${payload.filename}"`,
        // A paid artifact must never sit in a shared cache.
        'Cache-Control': 'private, no-store',
      },
    }) as NextResponse
  })
}
