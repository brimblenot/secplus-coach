'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        const from = params.get('from') || '/'
        router.replace(from)
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Incorrect password')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 360, background: 'var(--bg-2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: 28,
      }}>
        <div style={{
          fontFamily: 'IBM Plex Mono, monospace', fontSize: 18, fontWeight: 600,
          color: 'var(--text)', marginBottom: 6,
        }}>
          Security+ Coach
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
          Enter your password to continue
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 15,
            padding: '11px 13px', fontFamily: 'IBM Plex Sans, sans-serif',
          }}
        />

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10, fontFamily: 'IBM Plex Mono, monospace' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            width: '100%', marginTop: 16, padding: '11px', background: 'var(--green)',
            color: '#04140f', border: 'none', borderRadius: 'var(--radius)',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 600,
            cursor: loading || !password ? 'default' : 'pointer', opacity: loading || !password ? 0.5 : 1,
          }}
        >
          {loading ? 'Checking…' : 'Enter →'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
