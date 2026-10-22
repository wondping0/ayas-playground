import { NextResponse, type NextRequest } from 'next/server'

/**
 * Same-origin enforcement for state-changing API requests.
 *
 * Session cookies are `SameSite=strict`, which is the primary defence. This is
 * the second one, and it is cheap: a browser always sends `Origin` on a
 * cross-origin POST, so a mismatch is a forged request regardless of what the
 * cookie policy did.
 *
 * Verify-when-present: a request with no `Origin` (curl, a server-to-server
 * call) is allowed through, because rejecting those would break every
 * non-browser client without stopping any browser attack.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The Midtrans webhook is exempt. It is a server-to-server POST that carries no
 * `Origin`, and its authenticity comes from the signature check — which is a
 * stronger guarantee than an origin header could be.
 */
const EXEMPT = ['/api/payments/midtrans']

export function middleware(request: NextRequest): NextResponse {
  if (!MUTATING.has(request.method)) return NextResponse.next()
  if (EXEMPT.some((path) => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next()
  }

  const origin = request.headers.get('origin')
  if (!origin) return NextResponse.next()

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return forbidden()
  }

  // `host` is what the browser was actually talking to.
  const host = request.headers.get('host')
  if (host && originHost !== host) return forbidden()

  return NextResponse.next()
}

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: { code: 'forbidden', message: 'Cross-origin requests are not accepted here.' } },
    { status: 403 },
  )
}

export const config = {
  matcher: '/api/:path*',
}
