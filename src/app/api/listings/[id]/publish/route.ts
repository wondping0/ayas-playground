import { NextResponse } from 'next/server'
import { assertOwnerOrAdmin, requireUser } from '@/lib/auth'
import { delistListing, publishListing } from '@/lib/catalog'
import { err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'
import { getStore } from '@/lib/store'

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return handle(async () => {
    const user = await requireUser()
    const listing = await getStore().listings.get(params.id)
    if (!listing) throw err.notFound('Listing')
    assertOwnerOrAdmin(user, listing.sellerId)

    const body = await readJson<{ action?: string; reason?: string }>(request)

    // The publish gate lives in the catalog plane; this handler only decides
    // who is allowed to ask.
    const updated =
      body.action === 'delist'
        ? await delistListing(listing.id, user.id, body.reason ?? 'Delisted by owner.')
        : await publishListing(listing.id, user.id)

    return json({ listing: { id: updated.id, slug: updated.slug, state: updated.state } })
  })
}
