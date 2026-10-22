import { cn, formatDate, formatDuration } from '@/lib/ui/cn'

/**
 * The trust artifact.
 *
 * A buyer cannot read the challenge, so this receipt is the whole basis for
 * believing it works. It is deliberately shaped like a certificate rather than
 * a badge: a badge is a claim, a receipt says who checked, when, and how long
 * it took.
 */

export interface VerificationReceiptProps {
  verified: { at: string; durationMs: number } | null
  profile?: string
  variant?: 'inline' | 'block'
  className?: string
}

export function VerificationReceipt({
  verified,
  profile,
  variant = 'block',
  className,
}: VerificationReceiptProps) {
  if (!verified) {
    return (
      <p
        className={cn(
          'font-mono text-eyebrow uppercase text-muted',
          variant === 'block' && 'border border-dashed border-rule px-3 py-2',
          className,
        )}
      >
        Not verified
      </p>
    )
  }

  if (variant === 'inline') {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 font-mono text-eyebrow uppercase text-verify', className)}
      >
        <Seal />
        Verified
      </span>
    )
  }

  return (
    <div className={cn('border border-verify/35 bg-verify/[0.06] px-4 py-3', className)}>
      <p className="flex items-center gap-2 font-mono text-eyebrow uppercase text-verify">
        <Seal />
        Solved by our sandbox
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-muted">Checked</dt>
        <dd className="tnum">{formatDate(verified.at)}</dd>
        <dt className="text-muted">Solve time</dt>
        <dd className="tnum">{formatDuration(verified.durationMs)}</dd>
        {profile && (
          <>
            <dt className="text-muted">Environment</dt>
            <dd>{profile}</dd>
          </>
        )}
      </dl>
      <p className="mt-3 border-t border-verify/20 pt-2 font-serif text-xs leading-relaxed text-muted">
        We built this challenge with a throwaway flag and ran the author&rsquo;s solver against
        it, without giving the solver the flag. It recovered it. Solve time measures our
        sandbox, not difficulty.
      </p>
    </div>
  )
}

function Seal() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <path
        d="M6 0.5 7.3 3.2 10.2 3.6 8.1 5.7 8.6 8.6 6 7.2 3.4 8.6 3.9 5.7 1.8 3.6 4.7 3.2Z"
        fill="currentColor"
      />
    </svg>
  )
}
