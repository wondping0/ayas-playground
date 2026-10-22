import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createListing } from '@/lib/catalog'
import { LICENSE_TYPES, type LicenseType } from '@/lib/core/license'
import { err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'

interface Body {
  versionId?: string
  price?: number
  licenseType?: string
  summary?: string
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const seller = await requireRole('seller')
    const body = await readJson<Body>(request)

    if (!body.versionId) throw err.validation('A version id is required.')
    if (typeof body.price !== 'number') throw err.validation('A price is required.')
    if (!LICENSE_TYPES.includes(body.licenseType as LicenseType)) {
      throw err.validation(`Licence must be one of: ${LICENSE_TYPES.join(', ')}.`)
    }

    const listing = await createListing({
      seller,
      versionId: body.versionId,
      price: body.price,
      licenseType: body.licenseType as LicenseType,
      summary: body.summary ?? '',
    })

    return json({ listing: { id: listing.id, slug: listing.slug, state: listing.state } }, 201)
  })
}
