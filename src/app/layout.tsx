import type { Metadata } from 'next'
import { Archivo, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import { SiteHeader } from '@/components/SiteHeader'
import { currentUser } from '@/lib/auth'
import './globals.css'

/**
 * Three faces, three jobs: Archivo carries the interface, Source Serif carries
 * prose a person actually reads, JetBrains Mono carries every figure and every
 * byte. Nothing borrows another's job.
 */
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "Aya's Playground — cryptography CTF challenges",
  description:
    'A marketplace for cryptography CTF challenges. Every listing has been solved by a sandbox before it goes on sale.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null)

  return (
    <html lang="en" className={`${archivo.variable} ${sourceSerif.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <SiteHeader
          user={user ? { name: user.name, roles: user.roles } : null}
        />
        <main id="main">{children}</main>
        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-shelf flex-col gap-2 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Aya&rsquo;s Playground — licensed challenges. Order-specific flags for
              re-flaggable bundles.
            </p>
            <p className="font-mono text-eyebrow uppercase">Cryptography only, for now</p>
          </div>
        </footer>
      </body>
    </html>
  )
}
