import { useState, useRef, useEffect } from 'react'
import { icons } from './constants'
import './landing.css'

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <div className="vox-logo" style={{ width: size, height: size, fontSize: size * 0.5, borderRadius: size * 0.3 }}>🎙</div>
  )
}

// ── Shared product links (used by nav dropdown + footer) ──────────
export const PRODUCT_LINKS = [
  { key: 'feature-studio',      label: 'Studio',        desc: 'Script editor & voice synthesis', icon: icons.scripts },
  { key: 'feature-voices',      label: 'Voice Library', desc: '30+ voices + voice cloning',      icon: icons.mic },
  { key: 'feature-translation', label: 'Translation',   desc: 'AI scripts in 16 languages',       icon: icons.globe },
  { key: 'feature-timeline',    label: 'Timeline',      desc: 'Multi-lane audio assembly',        icon: icons.assembly },
  { key: 'feature-audiobooks',  label: 'Audiobooks',    desc: 'Long-form audio production',        icon: icons.music },
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
      <button className="vox-nav-link" onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        Products
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
          style={{ width: 10, height: 10, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="vox-dropdown">
          {PRODUCT_LINKS.map(item => (
            <button key={item.key} className="vox-dropdown-item" onClick={() => { setOpen(false); onNavigate?.(item.key) }}>
              <span className="vox-dropdown-ic">{item.icon}</span>
              <span>
                <div className="vox-dropdown-title">{item.label}</div>
                <div className="vox-dropdown-desc">{item.desc}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Reusable marketing nav (exported for feature pages) ───────────
export function VoxNav({ onSignIn, onSignUp, onNavigate, current }: {
  onSignIn?: () => void; onSignUp?: () => void
  onNavigate?: (page: string) => void; current?: string
}) {
  return (
    <nav className="vox-nav">
      <button className="vox-brand" onClick={() => onNavigate?.('landing')}>
        <LogoMark size={30} />
        <span className="vox-brand-name">Voxora</span>
        <span className="vox-pill-beta">BETA</span>
      </button>
      <div style={{ flex: 1 }} />
      <div className="vox-nav-hide" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ProductsDropdown onNavigate={onNavigate} />
        <button className="vox-nav-link" onClick={() => onNavigate?.('pricing')}>Pricing</button>
      </div>
      <button className="vox-btn vox-btn--ghost" style={{ padding: '8px 16px', fontSize: 13.5 }} onClick={onSignIn}>Sign in</button>
      <button className="vox-btn vox-btn--primary" style={{ padding: '8px 18px', fontSize: 13.5 }} onClick={onSignUp}>Get started</button>
    </nav>
  )
}

// ── Reusable footer (exported for feature pages) ──────────────────
export function VoxFooter({ onSignIn, onSignUp, onNavigate }: {
  onSignIn?: () => void; onSignUp?: () => void; onNavigate?: (page: string) => void
}) {
  return (
    <footer className="vox-footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LogoMark size={20} />
        <span style={{ fontWeight: 600, color: 'var(--vx-text-2)' }}>Voxora</span>
        <span style={{ marginLeft: 8 }}>© {new Date().getFullYear()} — AI voice synthesis in the cloud</span>
      </div>
      <div className="vox-footer-links">
        {PRODUCT_LINKS.map(p => (
          <button key={p.key} onClick={() => onNavigate?.(p.key)}>{p.label}</button>
        ))}
        <button onClick={() => onNavigate?.('pricing')}>Pricing</button>
        <button onClick={onSignIn}>Sign in</button>
        <button onClick={onSignUp}>Sign up</button>
      </div>
    </footer>
  )
}

// ═══════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════
interface LandingPageProps {
  onSignIn?: () => void
  onSignUp?: () => void
  onTryNow?: () => void
  onNavigate?: (page: string) => void
}

export function LandingPage({ onSignIn, onSignUp, onTryNow, onNavigate }: LandingPageProps) {
  const features = [
    { icon: icons.mic,      title: 'Voice Cloning',          desc: 'Record or upload a short sample and Voxora captures your voice. Every script is spoken in a voice that sounds unmistakably like you.' },
    { icon: icons.speaker,  title: 'Studio Voice Library',   desc: 'No sample to record? Choose from 30+ ready-made studio voices across genders and styles — pro audio in seconds.' },
    { icon: icons.globe,    title: '16 Languages + Translate', desc: 'Write in one language and translate your whole script to another with one click. Natural speech in English, Spanish, Japanese, Arabic, Hindi and more.' },
    { icon: icons.music,    title: '9 Emotion Styles',       desc: 'Shape the delivery — Natural, Cheerful, Dramatic, Whisper, Storytelling and more. Fine-tune expressiveness with advanced controls.' },
    { icon: icons.upload,   title: 'Audio → Script',         desc: 'Upload existing audio and Voxora transcribes it into an editable script automatically — ready to re-voice, translate, or restyle.' },
    { icon: icons.profiles, title: 'Multi-Voice Scripts',    desc: 'Assign different voices to different speakers in one script. Perfect for dialogue, interviews, and character narration.' },
    { icon: icons.assembly, title: 'Timeline Assembly',      desc: 'Arrange, trim, and split clips across multiple lanes on a precision timeline. Layer silence, navigate with the minimap, zoom to the frame.' },
    { icon: icons.download, title: 'Lossless Export',        desc: 'Export individual clips or your full assembled track as high-quality WAV. Your audio, ready for any platform.' },
    { icon: icons.projects, title: 'Project Workspaces',     desc: 'Organise episodes, campaigns, or audiobooks into projects. Every script, clip, voice and setting saved in the cloud and synced everywhere.' },
  ]

  const steps = [
    { n: '1', title: 'Pick a voice',         desc: 'Clone your own in seconds or choose from the studio library.' },
    { n: '2', title: 'Write or import',      desc: 'Type a script, paste text, or upload audio to transcribe.' },
    { n: '3', title: 'Generate & assemble',  desc: 'Synthesize, arrange on the timeline, and export your WAV.' },
  ]

  const testimonials = [
    { name: 'Maria K.', role: 'Podcast Producer',  quote: 'I replaced my entire voiceover workflow. Three hours of re-recording became ten minutes.' },
    { name: 'James T.', role: 'YouTube Creator',   quote: 'The timeline editor feels like a proper DAW. I\'m actually shipping videos faster now.' },
    { name: 'Priya S.', role: 'E-learning Author', quote: 'Multilingual versions of every lesson, translated and voiced from one script. Incredible.' },
  ]

  return (
    <div className="vox">
      <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} current="landing" />

      {/* ── Hero ── */}
      <section className="vox-hero">
        <span className="vox-eyebrow"><span className="vox-eyebrow-dot" /> AI voice studio · In your browser</span>

        <h1 className="vox-h1">
          Your voice. Every script.<br />
          <span className="vox-grad-text">Any language.</span>
        </h1>

        <p className="vox-lead">
          Voxora is a complete cloud voice studio. Clone your voice or pick a studio one,
          write or translate a script, shape the emotion, and assemble the final audio —
          all in your browser, nothing to install.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 32 }}>
          <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
            <span className="vox-btn-icon">{icons.bolt}</span> Start for free
          </button>
          <button className="vox-btn vox-btn--ghost vox-btn--lg" onClick={onTryNow}>
            Try without an account →
          </button>
        </div>

        {/* Animated waveform */}
        <div className="vox-wave">
          {Array.from({ length: 84 }, (_, i) => {
            const h = 8 + Math.abs(Math.sin(i * 0.38 + 1) * Math.cos(i * 0.13)) * 52
            return (
              <span key={i} style={{
                height: h,
                opacity: 0.35 + Math.abs(Math.sin(i * 0.5)) * 0.65,
                animation: `barFloat${i % 5} ${1.8 + (i % 7) * 0.2}s ease-in-out infinite`,
                animationDelay: `${(i % 8) * 0.12}s`,
              }} />
            )
          })}
        </div>

        <div className="vox-stats">
          {[
            { val: '16',  label: 'Languages' },
            { val: '30+', label: 'Studio voices' },
            { val: '9',   label: 'Emotion styles' },
            { val: '0',   label: 'To install' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div className="vox-stat-val vox-grad-text">{s.val}</div>
              <div className="vox-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section style={{ padding: '0 40px 40px' }}>
        <div className="vox-trust">
          <span>For Podcasters</span><span>·</span>
          <span>YouTubers</span><span>·</span>
          <span>E-learning</span><span>·</span>
          <span>Audiobooks</span><span>·</span>
          <span>Localization</span>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="vox-section">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Everything you need to produce<br /><span className="vox-grad-text">studio-quality audio</span></h2>
            <p className="vox-lead">One platform. Script to final audio — without ever leaving your browser.</p>
          </div>
          <div className="vox-grid vox-grid-3">
            {features.map(f => (
              <div key={f.title} className="vox-card">
                <div className="vox-card-icon">{f.icon}</div>
                <div className="vox-card-title">{f.title}</div>
                <div className="vox-card-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">From idea to audio in three steps</h2>
          </div>
          <div className="vox-grid vox-grid-3">
            {steps.map(s => (
              <div key={s.n} className="vox-card">
                <div className="vox-step-num">{s.n}</div>
                <div className="vox-card-title">{s.title}</div>
                <div className="vox-card-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Loved by creators</h2>
          </div>
          <div className="vox-grid vox-grid-3">
            {testimonials.map(t => (
              <div key={t.name} className="vox-card">
                <p style={{ fontSize: 16, color: 'var(--vx-text)', lineHeight: 1.65, fontWeight: 500 }}>"{t.quote}"</p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                  <div className="vox-voice-avatar" style={{ width: 34, height: 34, fontSize: 13 }}>{t.name[0]}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vx-text)' }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--vx-text-3)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="vox-cta">
        <div className="vox-cta-box">
          <h2 className="vox-h2" style={{ marginBottom: 16 }}>Ready to hear yourself?</h2>
          <p className="vox-lead" style={{ marginBottom: 30 }}>Start free in under two minutes — no credit card, no install.</p>
          <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
            Create your workspace →
          </button>
        </div>
      </section>

      <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
    </div>
  )
}
