import { useState, useEffect, useRef } from 'react'
import { api } from './api'
import { icons } from './constants'
import { LogoMark } from './LandingPage'

// ═══════════════════════════════════════════════════════════════════
// GOOGLE SIGN-IN BUTTON
// ═══════════════════════════════════════════════════════════════════
function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
    if (!clientId || !ref.current) return

    function render() {
      // @ts-ignore — loaded via the <script> tag in index.html
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential: string }) => onCredential(resp.credential),
      })
      const width = Math.min(Math.max(ref.current?.offsetWidth ?? 360, 280), 400)
      // @ts-ignore
      window.google?.accounts.id.renderButton(ref.current, {
        theme: 'filled_black', size: 'large', width, shape: 'pill', text: 'continue_with',
      })
    }

    // @ts-ignore
    if (window.google?.accounts?.id) { render(); return }
    const interval = setInterval(() => {
      // @ts-ignore
      if (window.google?.accounts?.id) { render(); clearInterval(interval) }
    }, 100)
    return () => clearInterval(interval)
  }, [onCredential])

  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', margin: '6px 0', width: '100%', overflow: 'hidden', borderRadius: 999 }} />
}

function OrDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>OR</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SHARED AUTH SHELL (split-panel layout)
// ═══════════════════════════════════════════════════════════════════
function AuthShell({ children, visual }: { children: React.ReactNode; visual: React.ReactNode }) {
  return (
    <div className="auth-shell" style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      minHeight: '100svh',
    }}>
      {/* Left: form panel */}
      <div className="auth-panel" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '48px 56px', background: 'var(--bg)',
        justifyContent: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div className="auth-panel__glow" />
        <div className="auth-card">
          {children}
        </div>
      </div>

      {/* Right: visual panel */}
      <div className="auth-visual" style={{
        background: 'linear-gradient(145deg, #1a1208 0%, #2e1f0f 50%, #1a0e05 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 48, position: 'relative', overflow: 'hidden',
      }}>
        {/* Background pattern */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.08,
          backgroundImage: 'radial-gradient(circle at 30% 40%, rgba(201,100,66,0.8) 0%, transparent 50%), radial-gradient(circle at 75% 70%, rgba(201,100,66,0.4) 0%, transparent 45%)',
        }} />
        {visual}
      </div>
    </div>
  )
}

function AuthVisualContent() {
  return (
    <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
      <LogoMark size={52} />
      <h2 style={{
        fontFamily: 'var(--serif)', fontSize: 34, fontWeight: 400,
        color: '#fff', letterSpacing: '-0.8px', lineHeight: 1.2,
      }}>
        Your voice,<br /><span style={{ color: 'var(--accent-2)', fontStyle: 'italic' }}>amplified.</span>
      </h2>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', maxWidth: 280, lineHeight: 1.7 }}>
        Clone your voice once. Generate endless audio in 16 languages — right from your browser.
      </p>
      {/* Mini waveform */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 42, opacity: 0.7 }}>
        {Array.from({ length: 36 }, (_, i) => {
          const h = 6 + Math.abs(Math.sin(i * 0.42) * Math.cos(i * 0.17)) * 32
          return (
            <div key={i} style={{
              width: 3.5, height: h, borderRadius: 2,
              background: 'var(--accent)',
              opacity: 0.5 + Math.abs(Math.sin(i * 0.6)) * 0.5,
            }} />
          )
        })}
      </div>
      {/* Feature pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 300 }}>
        {['16 languages', 'Voice cloning', 'Timeline editor', 'WAV export'].map(tag => (
          <span key={tag} style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99,
            background: 'rgba(201,100,66,0.15)', color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(201,100,66,0.25)',
          }}>{tag}</span>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SIGN IN PAGE
// ═══════════════════════════════════════════════════════════════════
interface SignInPageProps {
  onSignIn?: (email: string, password: string) => Promise<void>
  onSignUp?: () => void
  onBack?: () => void
  onForgotPassword?: () => void
  onGoogleCredential?: (credential: string) => void
}

export function SignInPage({ onSignIn, onSignUp, onBack, onForgotPassword, onGoogleCredential }: SignInPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!email.trim() || !password) { setError('Please fill in all fields.'); return }
    setError(''); setLoading(true)
    try {
      if (onSignIn) {
        await onSignIn(email, password)
      }
    } catch (err: any) {
      setError(typeof err === 'string' ? err : 'Invalid email or password.')
    } finally { setLoading(false) }
  }

  return (
    <AuthShell visual={<AuthVisualContent />}>
      <div className="auth-brand" style={{ marginBottom: 40 }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: onBack ? 'pointer' : 'default', padding: 0 }} onClick={onBack}>
          <LogoMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Voxora</span>
        </button>
      </div>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-1)', letterSpacing: '-0.5px', marginBottom: 6 }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Sign in to your workspace to continue.
        </p>
      </div>

      {onGoogleCredential && (
        <>
          <GoogleButton onCredential={onGoogleCredential} />
          <OrDivider />
        </>
      )}

      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Email */}
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.mail}</span>
            <input
              className="full-input"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="you@example.com"
              style={{ paddingLeft: 35 }}
              autoFocus
            />
          </div>
        </div>

        {/* Password */}
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Password</label>
            <button
              type="button"
              style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: onForgotPassword ? 'pointer' : 'default', padding: 0 }}
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.lock}</span>
            <input
              className="full-input"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="••••••••"
              style={{ paddingLeft: 35, paddingRight: 38 }}
            />
            <button
              type="button"
              aria-label={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', width: 16, height: 16, padding: 0 }}
            >{showPw ? icons.eyeOff : icons.eye}</button>
          </div>
        </div>

        {error && (
          <div className="msg msg--err">{error}</div>
        )}

        <button
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '11px', fontSize: 14, marginTop: 4, justifyContent: 'center' }}
        >
          {loading ? <span className="spinner" /> : 'Sign in to workspace'}
        </button>
      </form>

      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
        Don't have an account?{' '}
        <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 }} onClick={onSignUp}>
          Create one free
        </button>
      </div>
    </AuthShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SIGN UP PAGE
// ═══════════════════════════════════════════════════════════════════
interface SignUpPageProps {
  onSignUp?: (name: string, email: string, password: string) => Promise<void>
  onSignIn?: () => void
  onBack?: () => void
  onTerms?: () => void
  onPrivacy?: () => void
  onAcceptableUse?: () => void
  onGoogleCredential?: (credential: string) => void
}

export function SignUpPage({ onSignUp, onSignIn, onBack, onTerms, onPrivacy, onAcceptableUse, onGoogleCredential }: SignUpPageProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)

  const pwStrength = password.length === 0 ? 0
    : password.length < 6 ? 1
    : password.length < 10 ? 2
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const strengthColor = ['', 'var(--err)', 'var(--warn)', 'var(--ok)', 'var(--ok)']

  async function handleSubmit() {
    if (!name.trim()) { setError('Please enter your name.'); return }
    if (!email.trim()) { setError('Please enter your email.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    if (!agreed) { setError('Please accept the terms to continue.'); return }
    setError(''); setLoading(true)
    try {
      if (onSignUp) {
        await onSignUp(name, email, password)
      }
    } catch (err: any) {
      setError(typeof err === 'string' ? err : 'Sign-up failed. Please try again.')
    } finally { setLoading(false) }
  }

  return (
    <AuthShell visual={<AuthVisualContent />}>
      <div className="auth-brand" style={{ marginBottom: 36 }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: onBack ? 'pointer' : 'default', padding: 0 }} onClick={onBack}>
          <LogoMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Voxora</span>
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-1)', letterSpacing: '-0.5px', marginBottom: 6 }}>
          Create your workspace
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Free forever. No credit card required.
        </p>
      </div>

      {onGoogleCredential && (
        <>
          <GoogleButton onCredential={onGoogleCredential} />
          <OrDivider />
        </>
      )}

      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {/* Name */}
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Full name</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.user}</span>
            <input className="full-input" type="text" value={name} onChange={e => { setName(e.target.value); setError('') }} placeholder="Alex Smith" style={{ paddingLeft: 35 }} autoFocus />
          </div>
        </div>

        {/* Email */}
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.mail}</span>
            <input className="full-input" type="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }} placeholder="you@example.com" style={{ paddingLeft: 35 }} />
          </div>
        </div>

        {/* Password */}
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Password</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.lock}</span>
            <input className="full-input" type={showPw ? 'text' : 'password'} value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="Min. 8 characters" style={{ paddingLeft: 35, paddingRight: 38 }} />
            <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', width: 16, height: 16, padding: 0 }}>
              {showPw ? icons.eyeOff : icons.eye}
            </button>
          </div>
          {/* Strength bar */}
          {password.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: n <= pwStrength ? strengthColor[pwStrength] : 'var(--border-2)', transition: 'background 0.2s' }} />
              ))}
              <span style={{ fontSize: 10.5, fontWeight: 600, color: strengthColor[pwStrength], marginLeft: 4 }}>{strengthLabel[pwStrength]}</span>
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Confirm password</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.lock}</span>
            <input className="full-input" type={showPw ? 'text' : 'password'} value={confirmPw}
              onChange={e => { setConfirmPw(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="Re-enter password" style={{ paddingLeft: 35, paddingRight: 38 }}
            />
            {confirmPw.length > 0 && (
              <span style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: password === confirmPw ? 'var(--ok)' : 'var(--err)' }}>
                {password === confirmPw ? icons.check : icons.close}
              </span>
            )}
          </div>
        </div>

        {/* Terms */}
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
          <input type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setError('') }} style={{ marginTop: 2 }} />
          I agree to the{' '}
          <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, padding: 0 }} onClick={onTerms}>Terms of Service</button>
          {' '}and{' '}
          <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, padding: 0 }} onClick={onPrivacy}>Privacy Policy</button>
        </label>

        <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5, padding: '8px 10px', borderRadius: 7, background: 'var(--surface-2, var(--surface))', border: '1px solid var(--border)' }}>
          🔒 <strong style={{ color: 'var(--text-2)' }}>Consent-only voice cloning.</strong>{' '}
          Voxora only clones your own voice, or voices you have explicit permission to use. Impersonation and deepfakes are prohibited under our{' '}
          <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11.5, padding: 0 }} onClick={onAcceptableUse ?? onTerms}>Acceptable Use Policy</button>.
        </div>

        {error && <div className="msg msg--err">{error}</div>}

        <button
          className="btn btn--primary"
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '11px', fontSize: 14, marginTop: 2, justifyContent: 'center' }}
        >
          {loading ? <span className="spinner" /> : 'Create my workspace'}
        </button>
      </form>

      <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
        Already have an account?{' '}
        <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 }} onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </AuthShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// FORGOT PASSWORD PAGE
// ═══════════════════════════════════════════════════════════════════
export function ForgotPasswordPage({ onBack }: { onBack?: () => void }) {
  const [email, setEmail]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit() {
    if (!email.trim()) { setError('Please enter your email address.'); return }
    setError(''); setLoading(true)
    try {
      await api.post('/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send reset link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell visual={<AuthVisualContent />}>
      <div className="auth-brand" style={{ marginBottom: 40 }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: onBack ? 'pointer' : 'default', padding: 0 }} onClick={onBack}>
          <LogoMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Voxora</span>
        </button>
      </div>

      {sent ? (
        <div>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--ok-lt)', border: '1px solid rgba(59,125,99,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <span style={{ width: 24, height: 24, color: 'var(--ok)' }}>{icons.mail}</span>
          </div>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 400, color: 'var(--text-1)', letterSpacing: '-0.5px', marginBottom: 10 }}>
            Check your email
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 24 }}>
            If <strong>{email}</strong> has an account with us, we've sent a password reset link.
            The link expires in 60 minutes.
          </p>
          <button className="btn btn--ghost" onClick={onBack} style={{ gap: 6 }}>
            {icons.back} Back to sign in
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-1)', letterSpacing: '-0.5px', marginBottom: 6 }}>
              Reset your password
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              Enter your email and we'll send you a reset link.
            </p>
          </div>

          <form onSubmit={e => { e.preventDefault(); handleSubmit() }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', width: 15, height: 15, display: 'flex' }}>{icons.mail}</span>
                <input
                  className="full-input"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  placeholder="you@example.com"
                  style={{ paddingLeft: 35 }}
                  autoFocus
                />
              </div>
            </div>

            {error && <div className="msg msg--err">{error}</div>}

            <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}
              style={{ width: '100%', padding: '11px', fontSize: 14, marginTop: 4, justifyContent: 'center' }}>
              {loading ? <span className="spinner" /> : 'Send reset link'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
            Remember your password?{' '}
            <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 }} onClick={onBack}>
              Sign in
            </button>
          </div>
        </>
      )}
    </AuthShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// RESET PASSWORD PAGE
// ═══════════════════════════════════════════════════════════════════
export function ResetPasswordPage({ token, email: initialEmail, onSuccess, onBack }: {
  token: string
  email: string
  onSuccess?: () => void
  onBack?: () => void
}) {
  const [email, setEmail]       = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit() {
    if (!password || !confirm) { setError('Please fill in all fields.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setError(''); setLoading(true)
    try {
      await api.post('/reset-password', {
        token,
        email: email.trim(),
        password,
        password_confirmation: confirm,
      })
      onSuccess?.()
    } catch (e: any) {
      setError(e?.message ?? 'Reset failed. The link may have expired — request a new one.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell visual={<AuthVisualContent />}>
      <div className="auth-brand" style={{ marginBottom: 40 }}>
        <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: onBack ? 'pointer' : 'default', padding: 0 }} onClick={onBack}>
          <LogoMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Voxora</span>
        </button>
      </div>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-1)', letterSpacing: '-0.5px', marginBottom: 6 }}>
          Set a new password
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Choose a strong password for your account.
        </p>
      </div>

      <form onSubmit={e => { e.preventDefault(); handleSubmit() }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
          <input className="full-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>New password</label>
          <input className="full-input" type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }} placeholder="Min. 8 characters" />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Confirm new password</label>
          <input className="full-input" type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setError('') }} placeholder="Re-enter password" />
        </div>

        {error && <div className="msg msg--err">{error}</div>}

        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}
          style={{ width: '100%', padding: '11px', fontSize: 14, marginTop: 4, justifyContent: 'center' }}>
          {loading ? <span className="spinner" /> : 'Reset password'}
        </button>
      </form>
    </AuthShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS PAGE