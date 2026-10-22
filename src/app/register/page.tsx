import { AuthForm } from '@/components/AuthForm'

export const metadata = { title: 'Create an account — Aya’s Playground' }

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <p className="eyebrow">Buy, sell, or both</p>
      <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">Create an account</h1>
      <p className="mt-3 font-serif leading-relaxed text-muted">
        You need one to buy a challenge, because every copy is generated for a specific person.
      </p>
      <AuthForm mode="register" />
    </div>
  )
}
