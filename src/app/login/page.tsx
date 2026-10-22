import { AuthForm } from '@/components/AuthForm'

export const metadata = { title: 'Sign in — Aya’s Playground' }

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">Sign in</h1>
      <AuthForm mode="login" />
    </div>
  )
}
