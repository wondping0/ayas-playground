import { NextResponse } from 'next/server'
import { isAppError, toAppError } from '@/lib/core/errors'

/**
 * The response boundary.
 *
 * Route handlers validate input, call a plane, and shape a response — no
 * business logic. This is where a thrown AppError becomes a status code, and
 * where anything else becomes a generic 500 with the original kept server-side.
 */

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (thrown) {
    const error = toAppError(thrown)

    if (!isAppError(thrown)) {
      // An unexpected throw is a bug. Log it loudly; return nothing useful.
      console.error('[unhandled]', thrown)
    }

    return NextResponse.json(error.toJSON(), { status: error.status })
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return {} as T
  }
}
