/**
 * VoiceStudio — Landing, Sign In, Sign Up & Settings Pages
 * Drop-in companion to App.tsx / App.css
 * Usage: import { LandingPage, SignInPage, SignUpPage, SettingsPage } from './AuthAndLandingPages'
 */

import { useState } from 'react'

// ── Shared icon set (mirrors App.tsx icons) ──────────────────────────
const icons = {
  mic: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M16 9v1a6 6 0 0 1-12 0V9" /><line x1="10" y1="16" x2="10" y2="19" /><line x1="7" y1="19" x2="13" y2="19" /></svg>,
  bolt: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11 2L4 11h7l-2 7 9-10h-7l2-6z" /></svg>,
  assembly: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="8" width="4" height="4" rx="1" /><rect x="8" y="8" width="4" height="4" rx="1" /><rect x="14" y="8" width="4" height="4" rx="1" /><path d="M4 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" /><path d="M10 12v3" /></svg>,
  globe: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="8" /><path d="M2 10h16M10 2a12 12 0 0 1 0 16A12 12 0 0 1 10 2z" /></svg>,
  download: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3v10m-4-4 4 4 4-4" /><path d="M4 17h12" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l5 5 7-8" /></svg>,
  dark: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M17.5 12.5A7.5 7.5 0 0 1 7.5 2.5a7.5 7.5 0 1 0 10 10z" /></svg>,
  light: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="4" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" /></svg>,
  user: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="7" r="3.5" /><path d="M3 18c0-3.87 3.13-7 7-7s7 3.13 7 7" /></svg>,
  lock: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="9" width="12" height="9" rx="2" /><path d="M7 9V6a3 3 0 0 1 6 0v3" /></svg>,
  mail: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="16" height="12" rx="2" /><path d="M2 7l8 5 8-5" /></svg>,
  eye: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 10s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z" /><circle cx="10" cy="10" r="2.5" /></svg>,
  eyeOff: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3l14 14M10 4c4.4 0 8 5.3 8 6a9.7 9.7 0 0 1-2 2.9M6.5 6.3A9 9 0 0 0 2 10c0 .7 3.6 6 8 6a8.2 8.2 0 0 0 3.5-.8" /></svg>,
  edit: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11.5 5.5l3 3M4 14l1-4 8-8 3 3-8 8-4 1z" /></svg>,
  bell: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a6 6 0 0 1 6 6v3l2 2v1H2v-1l2-2V8a6 6 0 0 1 6-6z" /><path d="M8 17a2 2 0 0 0 4 0" /></svg>,
  shield: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" /></svg>,
  trash: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M8 6V4h4v2M7 6v10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6" /></svg>,
  chevronRight: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 4l6 6-6 6" /></svg>,
  info: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="8" /><line x1="10" y1="9" x2="10" y2="14" /><circle cx="10" cy="6.5" r="0.5" fill="currentColor" /></svg>,
  volume: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h3l4-4v12l-4-4H3V8z" /><path d="M14 7a4 4 0 0 1 0 6M17 4a9 9 0 0 1 0 12" /></svg>,
  keyboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="16" height="11" rx="2" /><path d="M5 9h1M8 9h1M11 9h1M14 9h1M5 13h10" /></svg>,
  api: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 6l-3 4 3 4M15 6l3 4-3 4M11 4l-2 12" /></svg>,
  close: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" /></svg>,
}

// ── LogoMark ─────────────────────────────────────────────────────────
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      borderRadius: size * 0.25,
      background: 'var(--accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, color: '#fff', fontWeight: 700, flexShrink: 0,
      boxShadow: '0 2px 6px rgba(201,100,66,0.35)',
    }}>🎙</div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════
interface LandingPageProps {
  onSignIn?: () => void
  onSignUp?: () => void
}

export function LandingPage({ onSignIn, onSignUp }: LandingPageProps) {
  const features = [
    {
      icon: icons.mic,
      title: 'Voice Cloning',
      desc: 'Capture your voice in seconds. XTTS-powered synthesis that sounds unmistakably like you — across any script.',
    },
    {
      icon: icons.assembly,
      title: 'Timeline Assembly',
      desc: 'Drag, trim, and arrange audio clips on a precision timeline. Layer silence, adjust volume, and export in one click.',
    },
    {
      icon: icons.globe,
      title: '16 Languages',
      desc: 'Speak to a global audience. Generate natural-sounding speech in English, Spanish, French, Japanese, and more.',
    },
    {
      icon: icons.bolt,
      title: 'Fast Synthesis',
      desc: 'Local inference means no cloud latency. Your scripts become audio in moments, privately, on your own machine.',
    },
    {
      icon: icons.download,
      title: 'Lossless Export',
      desc: 'Export individual clips or full assembled tracks as high-quality WAV. Your audio, your ownership.',
    },
    {
      icon: icons.assembly,
      title: 'Project Workspaces',
      desc: 'Organise episodes, campaigns, or audiobooks into projects. Every script, clip, and profile — right where you left it.',
    },
  ]

  const testimonials = [
    { name: 'Maria K.', role: 'Podcast Producer', quote: 'I replaced my entire voiceover workflow. Three hours of re-recording became ten minutes.' },
    { name: 'James T.', role: 'YouTube Creator', quote: 'The timeline editor feels like a proper DAW. I\'m actually shipping videos faster now.' },
    { name: 'Priya S.', role: 'E-learning Author', quote: 'Multilingual versions of every lesson, all from one recording session. Incredible.' },
  ]

  return (
    <div className="landing" style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Nav ── */}
      <nav className="landing__nav" style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 48px', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 50,
        backdropFilter: 'blur(8px)',
      }}>
        <LogoMark size={30} />
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px', color: 'var(--text-1)' }}>VoiceStudio</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
          background: 'var(--accent-lt)', color: 'var(--accent)',
          border: '1px solid var(--accent-mid)', marginLeft: 2
        }}>BETA</span>

        <div style={{ flex: 1 }} />

        <a href="#features" className="landing__nav-link" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none', fontWeight: 500 }}
          onClick={e => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }) }}>
          Features
        </a>
        <button className="btn btn--ghost" style={{ fontSize: 13 }} onClick={onSignIn}>Sign in</button>
        <button className="btn btn--primary" style={{ fontSize: 13 }} onClick={onSignUp}>Get started</button>
      </nav>

      {/* ── Hero ── */}
      <section className="landing__hero" style={{
        padding: '80px 48px 64px', textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
        background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          fontSize: 11.5, fontWeight: 600, color: 'var(--accent)',
          background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)',
          borderRadius: 99, padding: '4px 12px', letterSpacing: 0.3,
          textTransform: 'uppercase',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'blink 2.5s infinite' }} />
          Local AI · No cloud · Your voice
        </div>

        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(38px, 6vw, 68px)',
          fontWeight: 400, color: 'var(--text-1)', lineHeight: 1.12,
          letterSpacing: '-1.5px', maxWidth: 820,
        }}>
          Your voice. Every script.<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Any language.</span>
        </h1>

        <p style={{
          fontSize: 17, color: 'var(--text-2)', maxWidth: 560, lineHeight: 1.65,
          fontWeight: 400,
        }}>
          VoiceStudio lets you clone your voice once and generate professional audio for podcasts,
          videos, and e-learning — entirely on your own machine.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn--primary" style={{ padding: '11px 24px', fontSize: 14, gap: 7 }} onClick={onSignUp}>
            {icons.bolt} Start for free
          </button>
          <button className="btn btn--ghost" style={{ padding: '11px 24px', fontSize: 14 }} onClick={onSignIn}>
            Sign in to your workspace
          </button>
        </div>

        {/* Waveform illustration */}
        <div className="landing__hero-wave" style={{
          width: '100%', maxWidth: 680, height: 64, marginTop: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
          opacity: 0.5,
        }}>
          {Array.from({ length: 80 }, (_, i) => {
            const h = 8 + Math.abs(Math.sin(i * 0.38 + 1) * Math.cos(i * 0.13)) * 48
            return (
              <div key={i} style={{
                width: 3, height: h, borderRadius: 2,
                background: 'var(--accent)',
                opacity: 0.4 + Math.abs(Math.sin(i * 0.5)) * 0.6,
                animation: `barFloat${i % 5} ${1.8 + (i % 7) * 0.2}s ease-in-out infinite`,
                animationDelay: `${(i % 8) * 0.12}s`,
              }} />
            )
          })}
        </div>

        {/* Stats row */}
        <div className="landing__hero-stats" style={{ display: 'flex', gap: 40, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { val: '16', label: 'Languages' },
            { val: '100%', label: 'Local & private' },
            { val: '< 5s', label: 'Synthesis time' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 400, color: 'var(--text-1)', lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="landing__features" style={{ padding: '64px 48px', background: 'var(--bg-2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{
            fontFamily: 'var(--serif)', fontSize: 'clamp(26px, 4vw, 40px)',
            fontWeight: 400, letterSpacing: '-0.8px', color: 'var(--text-1)',
          }}>Everything you need to produce studio-quality audio</h2>
          <p style={{ fontSize: 15, color: 'var(--text-2)', marginTop: 10 }}>
            One tool. Script to final audio — without leaving your browser.
          </p>
        </div>

        <div className="landing__features-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 960, margin: '0 auto',
        }}>
          {features.map(f => (
            <div key={f.title} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '22px 20px',
              display: 'flex', flexDirection: 'column', gap: 10,
              transition: 'box-shadow 0.15s, border-color 0.15s',
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'none'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 9,
                background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
              }}>
                <div style={{ width: 18, height: 18 }}>{f.icon}</div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>{f.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="landing__testimonials" style={{ padding: '64px 48px', background: 'var(--bg)' }}>
        <h2 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(22px, 3vw, 34px)',
          textAlign: 'center', fontWeight: 400, letterSpacing: '-0.5px',
          color: 'var(--text-1)', marginBottom: 36,
        }}>Loved by creators</h2>
        <div className="landing__testimonials-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
          maxWidth: 900, margin: '0 auto',
        }}>
          {testimonials.map(t => (
            <div key={t.name} style={{
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '20px',
            }}>
              <p style={{
                fontFamily: 'var(--serif)', fontStyle: 'italic',
                fontSize: 14.5, color: 'var(--text-1)', lineHeight: 1.65,
                marginBottom: 14,
              }}>"{t.quote}"</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--accent)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12,
                }}>{t.name[0]}</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="landing__cta" style={{
        padding: '64px 48px', textAlign: 'center',
        background: 'var(--bg-2)', borderTop: '1px solid var(--border)',
      }}>
        <h2 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(26px, 4vw, 42px)',
          fontWeight: 400, letterSpacing: '-0.8px', color: 'var(--text-1)', marginBottom: 14,
        }}>Ready to hear yourself?</h2>
        <p style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 28 }}>
          Set up takes under two minutes. No account required to try.
        </p>
        <button className="btn btn--primary" style={{ padding: '12px 28px', fontSize: 15 }} onClick={onSignUp}>
          Create your workspace →
        </button>
      </section>

      {/* ── Footer ── */}
      <footer className="landing__footer" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 48px', borderTop: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={18} />
          <span>VoiceStudio</span>
        </div>
        <span>© {new Date().getFullYear()} — Local AI voice synthesis</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignIn}>Sign in</button>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignUp}>Sign up</button>
        </div>
      </footer>
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
        display: 'flex', flexDirection: 'column',
        padding: '48px 56px', background: 'var(--bg)',
        justifyContent: 'center',
      }}>
        {children}
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
        Clone your voice once. Generate endless audio in 16 languages — privately, on your machine.
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
        {['16 languages', 'Local & private', 'Timeline editor', 'WAV export'].map(tag => (
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
}

export function SignInPage({ onSignIn, onSignUp, onBack }: SignInPageProps) {
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
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>VoiceStudio</span>
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
            <button style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
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
}

export function SignUpPage({ onSignUp, onSignIn, onBack }: SignUpPageProps) {
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
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>VoiceStudio</span>
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
            <button onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', width: 16, height: 16, padding: 0 }}>
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
          <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>Terms of Service</button>
          {' '}and{' '}
          <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>Privacy Policy</button>
        </label>

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
// SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════
type SettingsSection = 'profile' | 'account' | 'audio' | 'appearance' | 'notifications' | 'api' | 'danger'

interface SettingsPageProps {
  darkMode?: boolean
  onToggleDark?: () => void
  onSignOut?: () => void
  user?: { name: string; email: string }
}

export function SettingsPage({ darkMode = false, onToggleDark, onSignOut, user = { name: 'Alex Smith', email: 'alex@example.com' } }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('profile')
  const [saved, setSaved] = useState(false)

  const navItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Profile', icon: icons.user },
    { id: 'account', label: 'Account & Security', icon: icons.shield },
    { id: 'audio', label: 'Audio & Synthesis', icon: icons.volume },
    { id: 'appearance', label: 'Appearance', icon: icons.light },
    { id: 'notifications', label: 'Notifications', icon: icons.bell },
    { id: 'api', label: 'API & Engine', icon: icons.api },
    { id: 'danger', label: 'Danger Zone', icon: icons.trash },
  ]

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div className="topbar" style={{ borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={22} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>Settings</span>
        </div>
        <div style={{ flex: 1 }} />
        {saved && (
          <div className="msg msg--ok" style={{ padding: '5px 12px', width: 'auto', display: 'flex', alignItems: 'center', gap: 6, animation: 'modal-in 0.18s ease' }}>
            <span style={{ width: 14, height: 14 }}>{icons.check}</span> Changes saved
          </div>
        )}
      </div>

      <div className="settings-layout" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1 }}>
        {/* Sidebar nav */}
        <div className="settings-nav" style={{
          borderRight: '1px solid var(--border)', padding: '16px 8px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item settings-nav-item ${section === item.id ? 'nav-item--active' : ''}`}
              onClick={() => setSection(item.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 15, height: 15, flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn btn--ghost" style={{ fontSize: 12.5, width: '100%', justifyContent: 'flex-start', color: 'var(--err)', gap: 7, padding: '7px 10px', marginTop: 8 }} onClick={onSignOut}>
            Sign out
          </button>
        </div>

        {/* Content */}
        <div className="settings-content" style={{ padding: '32px 40px', maxWidth: 640 }}>
          {section === 'profile' && <ProfileSettings user={user} onSave={handleSave} />}
          {section === 'account' && <AccountSettings onSave={handleSave} />}
          {section === 'audio' && <AudioSettings onSave={handleSave} />}
          {section === 'appearance' && <AppearanceSettings darkMode={darkMode} onToggleDark={onToggleDark} onSave={handleSave} />}
          {section === 'notifications' && <NotificationSettings onSave={handleSave} />}
          {section === 'api' && <ApiSettings onSave={handleSave} />}
          {section === 'danger' && <DangerSettings onSignOut={onSignOut} />}
        </div>
      </div>
    </div>
  )
}

// ── Settings sub-sections ────────────────────────────────────────────

function SettingsHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px', marginBottom: 4 }}>{title}</h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{desc}</p>
    </div>
  )
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingBottom: 20, borderBottom: '1px solid var(--border-3)', marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11,
        background: checked ? 'var(--accent)' : 'var(--border-2)',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.18s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        transition: 'left 0.18s',
      }} />
    </button>
  )
}

function ProfileSettings({ user, onSave }: { user: { name: string; email: string }; onSave: () => void }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [bio, setBio] = useState('')

  return (
    <div>
      <SettingsHeading title="Profile" desc="Your public identity within VoiceStudio." />

      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, padding: '16px', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {name[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{email}</div>
          <button className="btn btn--ghost btn--sm" style={{ gap: 5, fontSize: 12 }}>{icons.edit} Change avatar</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Full name</label>
          <input className="full-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
          <input className="full-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Bio <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <textarea className="full-input" value={bio} onChange={e => setBio(e.target.value)}
            rows={3} placeholder="Podcaster, narrator, creator…"
            style={{ resize: 'vertical', lineHeight: 1.6 }} />
        </div>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save profile</button>
    </div>
  )
}

function AccountSettings({ onSave }: { onSave: () => void }) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [twoFa, setTwoFa] = useState(false)
  const [sessions, setSessions] = useState(true)

  return (
    <div>
      <SettingsHeading title="Account & Security" desc="Manage your password and security settings." />

      <SettingsRow label="Two-factor authentication" hint="Add an extra layer of security to your account.">
        <Toggle checked={twoFa} onChange={setTwoFa} />
      </SettingsRow>

      <SettingsRow label="Active sessions" hint="Automatically sign out from inactive sessions.">
        <Toggle checked={sessions} onChange={setSessions} />
      </SettingsRow>

      <div style={{ marginTop: 4, marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 14 }}>Change password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Current password</label>
            <input className="full-input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>New password</label>
            <input className="full-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Confirm new password</label>
            <input className="full-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
          </div>
        </div>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6, marginTop: 8 }}>{icons.check} Update security</button>
    </div>
  )
}

function AudioSettings({ onSave }: { onSave: () => void }) {
  const [defaultLang, setDefaultLang] = useState('en')
  const [defaultSpeed, setDefaultSpeed] = useState(1.0)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [autoGain, setAutoGain] = useState(true)
  const [defaultGain, setDefaultGain] = useState(0.85)

  const languages = [
    { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
    { code: 'ja', label: 'Japanese' }, { code: 'zh', label: 'Chinese' },
  ]

  return (
    <div>
      <SettingsHeading title="Audio & Synthesis" desc="Default settings for voice synthesis and recording." />

      <SettingsRow label="Default language" hint="Used when creating new scripts.">
        <select className="full-input" value={defaultLang} onChange={e => setDefaultLang(e.target.value)} style={{ width: 160, padding: '6px 10px' }}>
          {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </SettingsRow>

      <SettingsRow label="Default speech speed" hint={`${defaultSpeed.toFixed(1)}× — affects all new scripts`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0.5" max="2" step="0.05" value={defaultSpeed}
            onChange={e => setDefaultSpeed(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{defaultSpeed.toFixed(1)}×</span>
        </div>
      </SettingsRow>

      <SettingsRow label="Browser noise suppression" hint="Reduces background noise during recording.">
        <Toggle checked={noiseSuppression} onChange={setNoiseSuppression} />
      </SettingsRow>

      <SettingsRow label="Auto gain control" hint="Normalises microphone input level automatically.">
        <Toggle checked={autoGain} onChange={setAutoGain} />
      </SettingsRow>

      <SettingsRow label="Default recording gain" hint={`Microphone amplification level — ${defaultGain.toFixed(2)}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0.1" max="2" step="0.05" value={defaultGain}
            onChange={e => setDefaultGain(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{defaultGain.toFixed(2)}</span>
        </div>
      </SettingsRow>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save audio settings</button>
    </div>
  )
}

function AppearanceSettings({ darkMode, onToggleDark, onSave }: { darkMode?: boolean; onToggleDark?: () => void; onSave: () => void }) {
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div>
      <SettingsHeading title="Appearance" desc="Customise how VoiceStudio looks and feels." />

      <SettingsRow label="Dark mode" hint="Switch between light and dark interface themes.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 15, height: 15, color: 'var(--text-3)' }}>{darkMode ? icons.dark : icons.light}</span>
          <Toggle checked={!!darkMode} onChange={() => onToggleDark?.()} />
        </div>
      </SettingsRow>

      <SettingsRow label="Layout density" hint="Controls spacing throughout the interface.">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDensity(d)}
              className={density === d ? 'btn btn--primary btn--sm' : 'btn btn--ghost btn--sm'}
              style={{ fontSize: 12, textTransform: 'capitalize' }}
            >{d}</button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Collapsed sidebar" hint="Hides text labels in the sidebar navigation.">
        <Toggle checked={sidebarCollapsed} onChange={setSidebarCollapsed} />
      </SettingsRow>

      <div style={{ margin: '20px 0', padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-3)', marginBottom: 10 }}>Preview</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎙</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Sample project</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>4 scripts · 2 voice profiles</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--accent-lt)', color: 'var(--accent)', border: '1px solid var(--accent-mid)', fontWeight: 600 }}>Active</span>
          </div>
        </div>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save appearance</button>
    </div>
  )
}

function NotificationSettings({ onSave }: { onSave: () => void }) {
  const [synth, setSynth] = useState(true)
  const [export_, setExport] = useState(true)
  const [errors, setErrors] = useState(true)
  const [updates, setUpdates] = useState(false)

  return (
    <div>
      <SettingsHeading title="Notifications" desc="Choose when VoiceStudio should alert you." />

      <SettingsRow label="Synthesis complete" hint="Notify when a script has finished generating audio.">
        <Toggle checked={synth} onChange={setSynth} />
      </SettingsRow>
      <SettingsRow label="Export complete" hint="Notify when a timeline export has finished.">
        <Toggle checked={export_} onChange={setExport} />
      </SettingsRow>
      <SettingsRow label="Engine errors" hint="Alert if the local XTTS engine encounters a problem.">
        <Toggle checked={errors} onChange={setErrors} />
      </SettingsRow>
      <SettingsRow label="Product updates" hint="Occasional announcements about new features.">
        <Toggle checked={updates} onChange={setUpdates} />
      </SettingsRow>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save preferences</button>
    </div>
  )
}

function ApiSettings({ onSave }: { onSave: () => void }) {
  const [endpoint, setEndpoint] = useState('http://localhost:8000')
  const [timeout, setTimeout_] = useState(30)
  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState('vs_live_xxxxxxxxxxxxxxxxxxxxx')

  return (
    <div>
      <SettingsHeading title="API & Engine" desc="Configure the connection to your local XTTS engine." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Engine endpoint</label>
          <input className="full-input" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://localhost:8000" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>The URL where your XTTS backend is running.</span>
        </div>

        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Request timeout (seconds)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min="5" max="120" step="5" value={timeout}
              onChange={e => setTimeout_(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 36 }}>{timeout}s</span>
          </div>
        </div>

        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>API key <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <div style={{ position: 'relative' }}>
            <input className="full-input" type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, paddingRight: 38 }} />
            <button onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', width: 16, height: 16, padding: 0 }}>
              {showKey ? icons.eyeOff : icons.eye}
            </button>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 20 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 2px var(--ok-lt)', animation: 'blink 2.5s infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--ok)', fontWeight: 500 }}>Engine connected</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>XTTS v2.0.3</span>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save connection</button>
    </div>
  )
}

function DangerSettings({ onSignOut }: { onSignOut?: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState('')

  return (
    <div>
      <SettingsHeading title="Danger Zone" desc="Irreversible actions — proceed with caution." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Sign out */}
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Sign out of all devices</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Revoke all active sessions across every device.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }} onClick={onSignOut}>
              Sign out all
            </button>
          </div>
        </div>

        {/* Clear audio */}
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Clear all cached audio</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Removes all stored audio blobs from IndexedDB. Scripts are unaffected.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }}>
              Clear cache
            </button>
          </div>
        </div>

        {/* Delete account */}
        <div style={{ padding: 16, border: '1px solid rgba(192,57,43,0.25)', borderRadius: 'var(--radius-lg)', background: 'var(--err-lt)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--err)', marginBottom: 4 }}>Delete account</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>
            This will permanently delete your account, all projects, scripts, voice profiles, and audio. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input className="full-input" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)}
              placeholder='Type "delete" to confirm'
              style={{ flex: 1, borderColor: 'rgba(192,57,43,0.35)' }} />
            <button className="btn btn--danger btn--sm" disabled={confirmDelete !== 'delete'} style={{ flexShrink: 0 }}>
              {icons.trash} Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DEMO — wires all pages together (remove in production)
// ═══════════════════════════════════════════════════════════════════
type DemoPage = 'landing' | 'signin' | 'signup' | 'settings'

export default function Demo() {
  const [page, setPage] = useState<DemoPage>('landing')
  const [darkMode, setDarkMode] = useState(false)

  return (
    <>
      {/* Page switcher (dev only) */}
      <div style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
        display: 'flex', gap: 6, background: 'var(--surface)', padding: '6px 8px',
        borderRadius: 'var(--radius)', border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {(['landing', 'signin', 'signup', 'settings'] as DemoPage[]).map(p => (
          <button key={p} className={`btn btn--sm ${page === p ? 'btn--primary' : 'btn--ghost'}`}
            style={{ fontSize: 11, textTransform: 'capitalize' }} onClick={() => setPage(p)}>{p}</button>
        ))}
      </div>

      {page === 'landing' && (
        <LandingPage onSignIn={() => setPage('signin')} onSignUp={() => setPage('signup')} />
      )}
      {page === 'signin' && (
        <SignInPage onSignIn={() => setPage('settings')} onSignUp={() => setPage('signup')} onBack={() => setPage('landing')} />
      )}
      {page === 'signup' && (
        <SignUpPage onSignUp={() => setPage('settings')} onSignIn={() => setPage('signin')} onBack={() => setPage('landing')} />
      )}
      {page === 'settings' && (
        <SettingsPage darkMode={darkMode} onToggleDark={() => setDarkMode(v => !v)} onSignOut={() => setPage('landing')} />
      )}
    </>
  )
}