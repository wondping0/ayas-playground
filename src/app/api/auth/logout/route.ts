import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

export async function POST(request: Request): Promise<NextResponse> {
  cookies().delete(SESSION_COOKIE)
  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
}
