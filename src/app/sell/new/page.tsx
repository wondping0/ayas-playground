import { redirect } from 'next/navigation'
import { UploadBundle } from '@/components/UploadBundle'
import { currentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Upload a bundle — Aya’s Playground' }

export default async function NewChallengePage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.roles.includes('seller')) redirect('/sell')

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <p className="eyebrow">Step one of two</p>
      <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">Upload a bundle</h1>
      <p className="mt-3 max-w-prose font-serif text-lg leading-relaxed text-muted">
        We run your solver against a freshly built copy before anything can go on sale. You will
        see the result immediately, including the output if it fails.
      </p>

      <section className="mt-10 border border-rule p-5">
        <h2 className="eyebrow">What a bundle looks like</h2>
        <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-muted">
{`challenge.yml         metadata — ctfcli-compatible, plus an aya: block
release_files/        the handout your players receive
server_files/
  generate.py         reads $FLAG, writes release_files/   (generate mode)
solver/solve.py       must print the flag to stdout
writeup.md            your explanation — delivered to the buyer`}
        </pre>
        <p className="mt-4 max-w-prose font-serif text-sm leading-relaxed text-muted">
          The generator is what makes a challenge worth reselling. With one, every buyer gets a
          different flag and a leak points at whoever leaked it. Without one, everybody gets the
          same flag and the first leak burns the challenge for good — so set{' '}
          <code className="font-mono text-ink">mode: generate</code> if you possibly can.
        </p>
      </section>

      <section className="mt-8 border border-rule p-5">
        <h2 className="eyebrow">Minimal challenge.yml</h2>
        <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-muted">
{`name: Shared Primes
author: your-handle
category: crypto
description: Two moduli generated in the same careless afternoon.
aya:
  scheme: rsa-weakness
  difficulty: medium
  flag:
    mode: generate
    format: "ayactf{%s}"
    generator: server_files/generate.py
  solver:
    entrypoint: solver/solve.py
    profile: python-crypto
    timeoutMs: 60000
  license: event`}
        </pre>
      </section>

      <UploadBundle />
    </div>
  )
}
