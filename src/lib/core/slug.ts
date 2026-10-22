/**
 * URL slugs.
 *
 * Slugs come from seller-supplied titles and end up in paths, so the output
 * charset is narrow by construction rather than by filtering afterwards.
 */

const MAX_LENGTH = 60

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    // Drop combining marks so "Éé" becomes "ee" rather than disappearing.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '')

  return base.length > 0 ? base : 'challenge'
}

/** Append a short discriminator until `isTaken` says the slug is free. */
export async function uniqueSlug(
  desired: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(desired)
  if (!(await isTaken(base))) return base

  for (let n = 2; n <= 50; n++) {
    const candidate = `${base}-${n}`
    if (!(await isTaken(candidate))) return candidate
  }

  // Falling back to randomness beats looping forever or throwing at a seller
  // whose title happens to collide fifty times.
  return `${base}-${Math.floor(Date.now() % 100_000).toString(36)}`
}
