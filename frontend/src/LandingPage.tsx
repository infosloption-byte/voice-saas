import { useState, useRef, useEffect } from 'react'
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
const PRODUCT_LINKS = [
  { key: 'feature-studio',      label: 'Studio',      desc: 'Script editor & voice synthesis' },
  { key: 'feature-voices',      label: 'Voice Library', desc: '30+ voices + voice cloning' },
  { key: 'feature-translation', label: 'Translation', desc: 'AI scripts in 16 languages' },
  { key: 'feature-timeline',    label: 'Timeline',    desc: 'Multi-lane audio assembly' },
  { key: 'feature-audiobooks',  label: 'Audiobooks',  desc: 'Long-form audio production' },
]

function ProductsDropdown({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--text-2)', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
        }}
      >
        Products
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 10, height: 10, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          padding: 8, minWidth: 240, zIndex: 200,
          animation: 'modal-in 0.12s ease',
        }}>
          {PRODUCT_LINKS.map(item => (
            <button
              key={item.key}
              onClick={() => { setOpen(false); onNavigate?.(item.key) }}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 14px', borderRadius: 8, textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{item.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{item.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface LandingPageProps {
  onSignIn?: () => void
  onSignUp?: () => void
  onTryNow?: () => void
  onNavigate?: (page: string) => void
}

export function LandingPage({ onSignIn, onSignUp, onTryNow, onNavigate }: LandingPageProps) {
  const features = [
    {
      icon: icons.mic,
      title: 'Voice Cloning',
      desc: 'Record or upload a short sample and Voxora captures your voice. Every script you write is spoken in a voice that sounds unmistakably like you.',
    },
    {
      icon: icons.speaker,
      title: 'Studio Voice Library',
      desc: 'No sample to record? Choose from 30+ ready-made studio voices across genders and styles — generate professional audio in seconds.',
    },
    {
      icon: icons.globe,
      title: '16 Languages + Translation',
      desc: 'Write in one language and translate your whole script to another with one click. Generate natural speech in English, Spanish, French, Japanese, Arabic, Hindi, and more.',
    },
    {
      icon: icons.music,
      title: '9 Emotion Styles',
      desc: 'Shape the delivery — Natural, Cheerful, Dramatic, Whisper, Storytelling and more. Fine-tune expressiveness with advanced controls when you need precision.',
    },
    {
      icon: icons.upload,
      title: 'Audio → Script',
      desc: 'Upload existing audio and Voxora transcribes it into an editable script automatically, ready to re-voice, translate, or restyle.',
    },
    {
      icon: icons.profiles,
      title: 'Multi-Voice Scripts',
      desc: 'Assign different voices to different speakers in a single script. Perfect for dialogue, interviews, and character-driven narration.',
    },
    {
      icon: icons.assembly,
      title: 'Timeline Assembly',
      desc: 'Arrange, trim, and split clips across multiple lanes on a precision timeline. Layer silence, navigate with the minimap, and zoom right to the frame.',
    },
    {
      icon: icons.download,
      title: 'Lossless Export',
      desc: 'Export individual clips or your full assembled track as high-quality WAV. Your audio, ready for any platform.',
    },
    {
      icon: icons.projects,
      title: 'Project Workspaces',
      desc: 'Organise episodes, campaigns, or audiobooks into projects. Every script, clip, voice, and setting — saved in the cloud and synced everywhere.',
    },
  ]

  const steps = [
    { n: '1', title: 'Pick a voice', desc: 'Clone your own in seconds or choose from the studio library.' },
    { n: '2', title: 'Write or import', desc: 'Type a script, paste text, or upload audio to transcribe.' },
    { n: '3', title: 'Generate & assemble', desc: 'Synthesize, arrange on the timeline, and export your WAV.' },
  ]

  const testimonials = [
    { name: 'Maria K.', role: 'Podcast Producer', quote: 'I replaced my entire voiceover workflow. Three hours of re-recording became ten minutes.' },
    { name: 'James T.', role: 'YouTube Creator', quote: 'The timeline editor feels like a proper DAW. I\'m actually shipping videos faster now.' },
    { name: 'Priya S.', role: 'E-learning Author', quote: 'Multilingual versions of every lesson, translated and voiced from one script. Incredible.' },
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
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px', color: 'var(--text-1)' }}>Voxora</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
          background: 'var(--accent-lt)', color: 'var(--accent)',
          border: '1px solid var(--accent-mid)', marginLeft: 2
        }}>BETA</span>

        <div style={{ flex: 1 }} />

        <ProductsDropdown onNavigate={onNavigate} />
        <a href="#features" className="landing__nav-link" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none', fontWeight: 500 }}
          onClick={e => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }) }}>
          Features
        </a>
        <a href="#how" className="landing__nav-link" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none', fontWeight: 500 }}
          onClick={e => { e.preventDefault(); document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }) }}>
          How it works
        </a>
        <button
          onClick={() => onNavigate?.('pricing')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-2)', fontWeight: 500, padding: '4px 6px' }}
        >
          Pricing
        </button>
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
          AI voice studio · In your browser
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
          fontSize: 17, color: 'var(--text-2)', maxWidth: 580, lineHeight: 1.65,
          fontWeight: 400,
        }}>
          Voxora is a complete cloud voice studio. Clone your voice or pick a studio one,
          write or translate a script, shape the emotion, and assemble the final audio —
          all in your browser, nothing to install.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn--primary" style={{ padding: '11px 24px', fontSize: 14, gap: 7 }} onClick={onSignUp}>
            {icons.bolt} Start for free
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
            { val: '30+', label: 'Studio voices' },
            { val: '9', label: 'Emotion styles' },
            { val: '0', label: 'To install' },
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
            One platform. Script to final audio — without leaving your browser.
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

      {/* ── How it works ── */}
      <section id="how" className="landing__how" style={{ padding: '64px 48px', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{
            fontFamily: 'var(--serif)', fontSize: 'clamp(24px, 3.5vw, 36px)',
            fontWeight: 400, letterSpacing: '-0.6px', color: 'var(--text-1)',
          }}>From idea to audio in three steps</h2>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
          maxWidth: 880, margin: '0 auto',
        }} className="landing__how-grid">
          {steps.map(s => (
            <div key={s.n} style={{
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '24px 22px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 15, fontFamily: 'var(--serif)',
              }}>{s.n}</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-1)' }}>{s.title}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="landing__testimonials" style={{ padding: '64px 48px', background: 'var(--bg-2)' }}>
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
              background: 'var(--surface)', border: '1px solid var(--border)',
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
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
      }}>
        <h2 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(26px, 4vw, 42px)',
          fontWeight: 400, letterSpacing: '-0.8px', color: 'var(--text-1)', marginBottom: 14,
        }}>Ready to hear yourself?</h2>
        <p style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 28 }}>
          Start free in under two minutes — no credit card, no install.
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
          <span>Voxora</span>
        </div>
        <span>© {new Date().getFullYear()} Voxora — AI voice synthesis in the cloud</span>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {PRODUCT_LINKS.map(p => (
            <button key={p.key} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={() => onNavigate?.(p.key)}>{p.label}</button>
          ))}
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={() => onNavigate?.('pricing')}>Pricing</button>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignIn}>Sign in</button>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignUp}>Sign up</button>
        </div>
      </footer>
    </div>
  )
}
