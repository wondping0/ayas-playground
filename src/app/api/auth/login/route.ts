import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, authenticate, createSession, sessionCookieOptions } from '@/lib/auth'
import {
  assertLoginAllowed,
  clearLoginAttempts,
  clientAddress,
  recordFailedLogin,
} from '@/lib/auth/rate-limit'
import { isProduction } from '@/lib/core/config'
import { AppError } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const body = await readJson<{ email?: string; password?: string }>(request)
    const email = body.email ?? ''
    const ip = clientAddress(request)

    // Checked before the password is verified: scrypt is expensive on purpose,
    // so an unthrottled attempt is a CPU cost as well as a guess.
    assertLoginAllowed(ip, email)

    const user = await authenticate(email, body.password ?? '')
    if (!user) {
      recordFailedLogin(ip, email)
      // Deliberately does not say which half was wrong.
      throw new AppError('unauthenticated', 'That email and password do not match an account.')
    }

    clearLoginAttempts(ip, email)

    const token = await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    })
    cookies().set(SESSION_COOKIE, token, sessionCookieOptions(isProduction()))

    return json({ user: { id: user.id, name: user.name, roles: user.roles } })
  })
}
