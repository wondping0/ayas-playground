'use client'

import { useEffect, useState } from 'react'
import { cipherPlate, scrambleRow } from '@/lib/catalog/plate'
import { cn } from '@/lib/ui/cn'

/**
 * The sealed goods.
 *
 * On mount the glyphs cycle briefly and then lock — the page's one orchestrated
 * motion. Under `prefers-reduced-motion` it renders locked immediately, and
 * with JavaScript off it is simply the final plate, because the rows are
 * computed deterministically rather than fetched.
 */

export interface CipherPlateProps {
  seed: string
  scheme: string
  rows?: number
  width?: number
  size?: 'sm' | 'lg'
  className?: string
}

const SETTLE_TICKS = 6
const TICK_MS = 55

export function CipherPlate({
  seed,
  scheme,
  rows = 6,
  width = 30,
  size = 'sm',
  className,
}: CipherPlateProps) {
  const plate = cipherPlate(seed, scheme, rows, width)
  const [tick, setTick] = useState(SETTLE_TICKS)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    setTick(0)
    let current = 0
    const timer = setInterval(() => {
      current += 1
      setTick(current)
      if (current >= SETTLE_TICKS) clearInterval(timer)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [seed, scheme])

  const settled = tick >= SETTLE_TICKS

  return (
    <figure
      className={cn(
        'relative select-none overflow-hidden border border-ink/15 bg-ink text-paper',
        size === 'lg' ? 'p-4' : 'p-3',
        className,
      )}
      aria-label={`Sealed ${scheme} challenge, shown as ${plate.shape}`}
    >
      <pre
        aria-hidden="true"
        className={cn(
          'font-mono leading-[1.35] text-paper/55',
          size === 'lg' ? 'text-[0.8125rem]' : 'text-plate',
        )}
      >
        {plate.rows
          .map((row, index) =>
            settled || index * 1 < tick ? row : scrambleRow(row, tick, `${seed}${index}`),
          )
          .join('\n')}
      </pre>

      <figcaption className="mt-3 flex items-center justify-between gap-3 border-t border-paper/15 pt-2">
        <span className="font-mono text-eyebrow uppercase text-paper">Sealed</span>
        <span className="font-mono text-eyebrow uppercase text-paper/70">{plate.shape}</span>
      </figcaption>
    </figure>
  )
}
