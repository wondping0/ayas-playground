import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, createSession, register, sessionCookieOptions } from '@/lib/auth'
import { isProduction } from '@/lib/core/config'
import { handle, json, readJson } from '@/lib/http/respond'

interface Body {
  email?: string
  password?: string
  name?: string
  seller?: boolean
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const body = await readJson<Body>(request)

    const user = await register({
      email: body.email ?? '',
      password: body.password ?? '',
      name: body.name ?? '',
      roles: body.seller ? ['buyer', 'seller'] : ['buyer'],
    })

    const token = await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    })
    cookies().set(SESSION_COOKIE, token, sessionCookieOptions(isProduction()))

    return json({ user: { id: user.id, name: user.name, roles: user.roles } }, 201)
  })
}
