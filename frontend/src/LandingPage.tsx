import { useState } from 'react'
import { icons } from './constants'

export function LogoMark({ size = 28 }: { size?: number }) {
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
  onTryNow?: () => void
}

export function LandingPage({ onSignIn, onSignUp, onTryNow }: LandingPageProps) {
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
        <button className="btn btn--primary" style={{ fontSize: 13 }} onClick={onSignUp}>Subscribe</button>
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
            {icons.bolt} Subscribe & Get Full Access
          </button>
          <button className="btn btn--ghost" style={{ padding: '11px 24px', fontSize: 14 }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <button
          onClick={onTryNow}
          style={{
            marginTop: 4, background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--text-3)',
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          Try it first — no account needed →
        </button>

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