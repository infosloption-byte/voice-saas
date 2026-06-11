import { useState, useEffect } from 'react'
import { api } from './api'
import { toast, subscribeToast, type ToastItem } from './toast'
import { AdminPage } from './AdminPage'
import type { User } from './types'
import './App.css'

// ── Toast container (standalone, mirrored from App.tsx) ────────────
function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  useEffect(() => subscribeToast(t => {
    setToasts(prev => [...prev, t])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000)
  }), [])
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      display: 'flex', flexDirection: 'column', gap: 8,
      zIndex: 9999, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} className={`msg msg--${t.kind}`} style={{
          pointerEvents: 'all', animation: 'modal-in 0.2s ease',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <span style={{ flex: 1, fontSize: 13 }}>{t.msg}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'inherit', opacity: 0.5, padding: '0 2px', fontSize: 16 }}
            onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  )
}

// ── Admin login form ───────────────────────────────────────────────
function AdminLogin({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // CSRF cookie first
      await fetch('/sanctum/csrf-cookie', { credentials: 'include' })
      const res = await api.post('/login', { email, password }) as { user: User }
      if (!res.user.is_admin) {
        // Log out immediately — not an admin
        await api.post('/logout', {}).catch(() => {})
        setError('This account does not have admin access.')
        return
      }
      onLogin(res.user)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setError(msg ?? 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 32, boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: 'var(--accent)',
            color: '#fff', fontSize: 22, fontWeight: 900, display: 'flex',
            alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px',
          }}>V</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-1)' }}>Voxora Admin</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Sign in with your admin account</div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              className="full-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              className="full-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="msg msg--err" style={{ fontSize: 12.5, padding: '8px 12px' }}>{error}</div>
          )}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading}
            style={{ marginTop: 4, justifyContent: 'center' }}
          >
            {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Sign in to Admin'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── AdminApp root ─────────────────────────────────────────────────
export function AdminApp() {
  const [user, setUser]       = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('vo_dark')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Apply dark mode class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  // Check existing session on mount
  useEffect(() => {
    api.get('/user')
      .then(u => {
        const userData = u as User
        if (userData.is_admin) setUser(userData)
        else setUser(null)
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  async function signOut() {
    await api.post('/logout', {}).catch(() => {})
    setUser(null)
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  return (
    <div className={darkMode ? 'dark' : ''} style={{ minHeight: '100svh', background: 'var(--bg)' }}>
      {/* Standalone topbar */}
      {user && (
        <div style={{
          height: 48, display: 'flex', alignItems: 'center', padding: '0 20px',
          borderBottom: '1px solid var(--border)', background: 'var(--bg)',
          gap: 12, position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 6, background: 'var(--accent)',
              color: '#fff', fontSize: 13, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>V</div>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>Voxora</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 2 }}>/ Admin</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{user.name} · {user.role === 'super_admin' ? '⭐ Super Admin' : '🛡 Admin'}</span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => { setDarkMode(v => { localStorage.setItem('vo_dark', String(!v)); return !v }) }}
            title="Toggle dark mode"
            style={{ fontSize: 11 }}
          >
            {darkMode ? '☀ Light' : '☾ Dark'}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={signOut}
            style={{ fontSize: 11, color: 'var(--err)' }}
          >
            Sign out
          </button>
        </div>
      )}

      {/* Content */}
      {user
        ? <AdminPage user={user} standalone />
        : <AdminLogin onLogin={setUser} />
      }

      <ToastContainer />
    </div>
  )
}
