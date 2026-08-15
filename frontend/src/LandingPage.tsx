import { useState, useRef, useEffect } from 'react'
import { icons } from './constants'
import './landing.css'

// ── Logo ──────────────────────────────────────────────────────────
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div className="vox-logo" style={{ width: size, height: size, fontSize: size * 0.48, borderRadius: size * 0.28 }}>
      🎙
    </div>
  )
}

// ── Product links used by dropdown + footer ───────────────────────
export const PRODUCT_LINKS = [
  { key: 'feature-studio',      label: 'Studio',        desc: 'Script editor & voice synthesis', icon: icons.scripts },
  { key: 'feature-voices',      label: 'Voice Library', desc: 'Clone your own voice + 30 studio voices', icon: icons.mic     },
  { key: 'feature-translation', label: 'Translation',   desc: 'AI scripts in 17 languages',       icon: icons.globe   },
  { key: 'feature-timeline',    label: 'Timeline',      desc: 'Multi-lane audio assembly',        icon: icons.assembly },
  { key: 'feature-audiobooks',  label: 'Audiobooks',    desc: 'Long-form audio production',        icon: icons.music   },
]

// ── Products dropdown ─────────────────────────────────────────────
function ProductsDropdown({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="vox-nav-link" onClick={() => setOpen(v => !v)}>
        Features
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
          style={{ width: 10, height: 10, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="vox-dropdown">
          {PRODUCT_LINKS.map(it => (
            <button key={it.key} className="vox-dropdown-item" onClick={() => { setOpen(false); onNavigate?.(it.key) }}>
              <span className="vox-dropdown-ic">{it.icon}</span>
              <span>
                <div className="vox-dropdown-title">{it.label}</div>
                <div className="vox-dropdown-desc">{it.desc}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared Nav (exported for feature pages) ───────────────────────
export function VoxNav({ onSignIn, onSignUp, onNavigate }: {
  onSignIn?: () => void; onSignUp?: () => void; onNavigate?: (p: string) => void
}) {
  return (
    <nav className="vox-nav">
      <button className="vox-brand" onClick={() => onNavigate?.('landing')}>
        <LogoMark size={30} />
        <span className="vox-brand-name">Voxora</span>
        <span className="vox-pill-beta">BETA</span>
      </button>
      <div style={{ flex: 1 }} />
      <div className="vox-nav-hide" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <ProductsDropdown onNavigate={onNavigate} />
        <button className="vox-nav-link" onClick={() => onNavigate?.('pricing')}>Pricing</button>
      </div>
      <button className="vox-btn vox-btn--ghost" style={{ padding: '8px 18px', fontSize: 13.5 }} onClick={onSignIn}>Sign in</button>
      <button className="vox-btn vox-btn--primary" style={{ padding: '8px 18px', fontSize: 13.5 }} onClick={onSignUp}>Get started free</button>
    </nav>
  )
}

// ── Social links ──────────────────────────────────────────────────
const SOCIALS = [
  {
    label: 'X', href: 'https://x.com/voxora',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.3 8.3L23.3 22h-6.8l-5.3-6.9L5.1 22H2l7.8-8.9L1 2h6.9l4.8 6.4L18.9 2zm-2.4 18h1.9L7.6 4H5.6l10.9 16z"/></svg>,
  },
  {
    label: 'Instagram', href: 'https://instagram.com/voxora',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>,
  },
  {
    label: 'YouTube', href: 'https://youtube.com/@voxora',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .6 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.4 12 31 31 0 0 0 23 7.5zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z"/></svg>,
  },
  {
    label: 'LinkedIn', href: 'https://linkedin.com/company/voxora',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm6 0h3.8v1.6h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9V9z"/></svg>,
  },
  {
    label: 'GitHub', href: 'https://github.com/voxora',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.3-1.1.6-1.4-2.2-.300-4.6-1.1-4.6-5a4 4 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.6.9.6 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>,
  },
]

// ── Shared Footer (exported for feature pages) ────────────────────
export function VoxFooter({ onSignIn, onSignUp, onNavigate }: {
  onSignIn?: () => void; onSignUp?: () => void; onNavigate?: (p: string) => void
}) {
  return (
    <footer className="vox-footer">
      <div className="vox-footer-inner">
        <div style={{ maxWidth: 280 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
            <LogoMark size={26} />
            <span className="vox-footer-brand">Voxora</span>
          </div>
          <div className="vox-footer-tagline">
            Clone your voice, translate scripts, and assemble studio-quality audio — all in your browser.
          </div>
          <div className="vox-socials">
            {SOCIALS.map(s => (
              <a key={s.label} className="vox-social" href={s.href} target="_blank" rel="noopener noreferrer" title={s.label} aria-label={s.label}>
                {s.icon}
              </a>
            ))}
          </div>
        </div>
        <div className="vox-footer-col">
          <div className="vox-footer-col-label">Features</div>
          {PRODUCT_LINKS.map(p => (
            <button key={p.key} className="vox-footer-link" onClick={() => onNavigate?.(p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="vox-footer-col">
          <div className="vox-footer-col-label">Product</div>
          <button className="vox-footer-link" onClick={() => onNavigate?.('pricing')}>Pricing</button>
          <button className="vox-footer-link" onClick={onSignUp}>Get started free</button>
          <button className="vox-footer-link" onClick={onSignIn}>Sign in</button>
        </div>
        <div className="vox-footer-col">
          <div className="vox-footer-col-label">Legal</div>
          <button className="vox-footer-link" onClick={() => onNavigate?.('privacy')}>Privacy Policy</button>
          <button className="vox-footer-link" onClick={() => onNavigate?.('terms')}>Terms of Service</button>
          <button className="vox-footer-link" onClick={() => onNavigate?.('refund')}>Refund Policy</button>
          <button className="vox-footer-link" onClick={() => onNavigate?.('acceptable-use')}>Acceptable Use</button>
        </div>
      </div>
      <div className="vox-footer-bottom">
        <span>© {new Date().getFullYear()} Voxora. All rights reserved.</span>
        <span>usevoxora.online</span>
      </div>
    </footer>
  )
}

// ── Mock UI preview ───────────────────────────────────────────────
function MockUI() {
  const bars = Array.from({ length: 36 }, (_, i) => ({
    h: 6 + Math.abs(Math.sin(i * 0.55 + 1) * Math.cos(i * 0.22)) * 22,
    op: 0.35 + Math.abs(Math.sin(i * 0.7)) * 0.65,
  }))
  return (
    <div className="vox-ui-frame">
      {/* Title bar */}
      <div className="vox-ui-titlebar">
        <div className="vox-ui-dot" style={{ background: '#ff5f57' }} />
        <div className="vox-ui-dot" style={{ background: '#ffbd2e' }} />
        <div className="vox-ui-dot" style={{ background: '#27c93f' }} />
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: 0.2 }}>
          Voxora — My Podcast Project
        </div>
      </div>
      <div className="vox-ui-body">
        {/* Sidebar */}
        <div className="vox-ui-sidebar">
          {['Dashboard', 'Projects', 'Profiles'].map((l, i) => (
            <div key={l} className={`vox-ui-sitem${i === 1 ? ' vox-ui-sitem--active' : ''}`}>
              <span className="vox-ui-sitem-dot" />
              {l}
            </div>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '8px 0' }} />
          {['Ep. 1 — Intro', 'Ep. 2 — Deep Dive'].map(l => (
            <div key={l} className="vox-ui-sitem" style={{ fontSize: 10.5 }}>
              <span className="vox-ui-sitem-dot" />
              {l}
            </div>
          ))}
        </div>
        {/* Main */}
        <div className="vox-ui-main">
          <div className="vox-ui-topbar">
            <span className="vox-ui-tab">📝 Scripts</span>
            <span className="vox-ui-tab-ghost">🎚 Assembly</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="vox-ui-pill vox-ui-pill--accent">Aria · EN</span>
              <span className="vox-ui-pill">Natural</span>
            </div>
          </div>
          <div className="vox-ui-content">
            {/* Script cards */}
            <div className="vox-ui-script vox-ui-script--active">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="vox-ui-script-title">Intro Script</span>
                <span className="vox-ui-script-badge">
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
                  Ready
                </span>
              </div>
              <div className="vox-ui-script-text">
                Welcome to the show. Today we're exploring how AI is changing the way creators produce audio content at scale…
              </div>
              <div className="vox-ui-wave">
                {bars.map((b, i) => (
                  <span key={i} style={{ height: b.h, opacity: b.op, animation: `barFloat${i % 5} ${1.6 + (i % 5) * 0.18}s ease-in-out infinite`, animationDelay: `${i * 0.04}s` }} />
                ))}
              </div>
            </div>
            <div className="vox-ui-script">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="vox-ui-script-title">Main Segment</span>
                <span className="vox-ui-script-badge" style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', borderColor: 'rgba(139,92,246,0.3)' }}>
                  Draft
                </span>
              </div>
              <div className="vox-ui-script-text">
                The research is clear — voice content is growing 40% year over year. Let's break down why…
              </div>
            </div>
          </div>
          <div className="vox-ui-controls">
            <span className="vox-ui-pill">1.0×</span>
            <span className="vox-ui-pill vox-ui-pill--accent">ES / Spanish</span>
            <span className="vox-ui-pill">WAV</span>
            <div className="vox-ui-gen-btn">⚡ Generate</div>
          </div>
        </div>
      </div>
    </div>
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

const MARQUEE_ITEMS = [
  { icon: '🎙', label: 'Voice Cloning'      },
  { icon: '🌍', label: '17 Languages'        },
  { icon: '🎵', label: 'Timeline Assembly'   },
  { icon: '📖', label: 'Audiobook Production' },
  { icon: '🤖', label: 'AI Translation'       },
  { icon: '🎭', label: '9 Emotion Styles'     },
  { icon: '🎚', label: 'Multi-lane Mixer'     },
  { icon: '💾', label: 'Lossless WAV Export'  },
  { icon: '🔊', label: '30+ Studio Voices'    },
  { icon: '⚡', label: 'Instant Synthesis'     },
]

const USE_CASES = [
  {
    emoji: '🎙',
    title: 'Podcasters',
    desc: 'Script your show, generate narration in your own voice, and mix intros, segments and music on the timeline — all without recording hardware.',
    chips: ['Voice cloning', 'Multi-voice', 'Timeline', 'WAV export'],
  },
  {
    emoji: '📹',
    title: 'Video Creators',
    desc: 'Drop voiceovers into any video workflow. Generate in seconds, export a clean WAV and drop it straight into your editor.',
    chips: ['Quick synthesis', 'Studio voices', '9 emotions', 'Export'],
  },
  {
    emoji: '📚',
    title: 'E-learning Authors',
    desc: 'Produce consistent narration across hundreds of lessons. Translate courses into 17 languages with one click per script.',
    chips: ['17 languages', 'Translation', 'Projects', 'Consistent voice'],
  },
  {
    emoji: '✍️',
    title: 'Audiobook Producers',
    desc: 'Turn any manuscript into a finished audiobook. One script per chapter, one voice, assembled on the timeline and exported as a single WAV.',
    chips: ['Long-form', 'Chapter projects', 'Assembly', 'Multilingual'],
  },
]

const PRICING = [
  {
    name: 'Free',
    amount: '$0',
    period: '',
    desc: 'Try it — no credit card needed',
    feats: [
      '20 voice syntheses per month',
      '10 script translations per month',
      '1 voice profile',
      '1 project',
      'Up to 500 words per script',
      'WAV export',
      '16 languages',
    ],
    btn: 'Get started free',
    featured: false,
  },
  {
    name: 'Starter',
    amount: '$9',
    period: '/month',
    desc: 'For individuals getting started',
    feats: [
      '150 voice syntheses per month',
      '50 script translations per month',
      '3 voice profiles',
      '10 projects',
      'Up to 5,000 words per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
    ],
    btn: 'Start Starter',
    featured: false,
  },
  {
    name: 'Creator',
    amount: '$29',
    period: '/month',
    desc: 'For creators and podcasters',
    feats: [
      '600 voice syntheses per month',
      '200 script translations per month',
      '10 voice profiles',
      'Unlimited projects',
      'No word limit per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
      'Priority synthesis queue',
    ],
    btn: 'Start Creator',
    featured: false,
  },
  {
    name: 'Pro',
    amount: '$79',
    period: '/month',
    desc: 'For power users and studios',
    feats: [
      '2,000 voice syntheses per month',
      'Unlimited script translations',
      '25 voice profiles',
      'Unlimited projects',
      'No word limit per script',
      'WAV export',
      'Multi-voice scripts',
      'Timeline assembly',
      '16 languages',
      'Priority synthesis queue',
      'Data export (GDPR)',
    ],
    btn: 'Go Pro',
    featured: true,
  },
]

const CHECK = (
  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1.5 5.5l2.5 2.5 4.5-5" />
  </svg>
)

const FEATURES = [
  { icon: icons.mic,      title: 'Your Voice, Cloned',       desc: 'Record a 10-second sample of your own voice — or upload a WAV you have the rights to. Voxora captures timbre, pacing, and intonation. Consent-verified: we require confirmation the voice is yours before cloning.' },
  { icon: icons.speaker,  title: 'Studio Voice Library',    desc: 'No sample? Pick from 30+ professional studio voices across genders, styles, and languages. Ready to use in seconds — no account upgrade needed on Free.' },
  { icon: icons.globe,    title: '17 Languages + AI Translate', desc: 'Write in one language and translate your entire script with one click. Powered by Gemini AI. Generate natural speech in Spanish, Japanese, Arabic, Hindi, French and 11 more.' },
  { icon: icons.music,    title: '9 Emotion Presets',       desc: 'Natural, Calm, Energetic, Cheerful, Serious, Dramatic, Whisper, Storytelling — shape the exact delivery your content needs, with fine-grained controls for power users.' },
  { icon: icons.upload,   title: 'Audio → Script',          desc: 'Upload any audio file and Voxora transcribes it to an editable script automatically. Re-voice in a different language, change the emotion, or rebuild from scratch.' },
  { icon: icons.profiles, title: 'Multi-Voice Scripts',     desc: 'Assign a different voice to each speaker — run full podcast dialogues, character narration, or interview formats from a single script in a single project.' },
  { icon: icons.assembly, title: 'Timeline Assembly',       desc: 'Drag synthesized clips across multi-lane tracks. Trim, split, add silence, layer music. Navigate with the minimap, zoom to the frame, then mix and export.' },
  { icon: icons.download, title: 'Lossless WAV Export',     desc: 'Export individual clips or your complete assembled timeline as high-quality WAV. Your audio, uncompressed and ready for any platform, editor or distribution.' },
  { icon: icons.projects, title: 'Project Workspaces',      desc: 'Organise episodes, campaigns, or book chapters into projects. Every script, clip, voice profile and setting saved in the cloud and synced across all your devices.' },
]

export function LandingPage({ onSignIn, onSignUp, onTryNow, onNavigate }: LandingPageProps) {
  return (
    <div className="vox">
      {/* Ambient background */}
      <div className="vox-ambient"><div className="vox-ambient-3" /></div>

      <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />

      {/* ── Hero ── */}
      <section className="vox-hero">
        <span className="vox-eyebrow"><span className="vox-eyebrow-dot" /> AI voice studio · In your browser</span>
        <h1 className="vox-h1">
          Your voice.<br />Every script.<br />
          <span className="vox-grad-text">Any language.</span>
        </h1>
        <p className="vox-lead" style={{ marginTop: 24 }}>
          Clone your voice or pick a studio one, write or translate a script, shape the emotion,
          and assemble professional audio — all in your browser, nothing to install.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 36 }}>
          <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
            <span className="vox-btn-icon">{icons.bolt}</span> Start for free
          </button>
          <button className="vox-btn vox-btn--ghost vox-btn--lg" onClick={onTryNow}>
            Try without an account →
          </button>
        </div>
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--vx-text-3)' }}>
          Free plan to start · Nothing to install · Cancel anytime
        </p>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--vx-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <span>🔒</span> Consent-only voice cloning — your voice, your content
        </p>

        {/* Mock UI preview */}
        <MockUI />

        {/* Stats */}
        <div className="vox-stats" style={{ marginTop: 56 }}>
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

      {/* ── Marquee ── */}
      <div className="vox-marquee">
        <div className="vox-marquee-inner">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((it, i) => (
            <span key={i} className="vox-marquee-item">
              <span className="vox-marquee-icon">{it.icon}</span>
              {it.label}
              {i % MARQUEE_ITEMS.length !== MARQUEE_ITEMS.length - 1 && (
                <span style={{ marginLeft: 48, color: 'var(--vx-text-3)', opacity: 0.4 }}>·</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ── Use cases ── */}
      <section className="vox-section">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Built for every creator <span className="vox-grad-text">workflow</span></h2>
            <p className="vox-lead">From solo podcasters to multilingual e-learning teams — Voxora fits your production style.</p>
          </div>
          <div className="vox-grid vox-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {USE_CASES.map(uc => (
              <div key={uc.title} className="vox-usecase">
                <div className="vox-usecase-emoji">{uc.emoji}</div>
                <div className="vox-usecase-title">{uc.title}</div>
                <div className="vox-usecase-desc">{uc.desc}</div>
                <div className="vox-usecase-chips">
                  {uc.chips.map(c => <span key={c} className="vox-usecase-chip">{c}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="vox-rule" />

      {/* ── Feature grid ── */}
      <section id="features" className="vox-section">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Everything to produce <span className="vox-grad-text">studio-quality audio</span></h2>
            <p className="vox-lead">One platform. Script to final audio — without leaving your browser.</p>
          </div>
          <div className="vox-grid vox-grid-3">
            {FEATURES.map(f => (
              <div key={f.title} className="vox-card">
                <div className="vox-card-icon">{f.icon}</div>
                <div className="vox-card-title">{f.title}</div>
                <div className="vox-card-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="vox-rule" />

      {/* ── How it works ── */}
      <section id="how" className="vox-section">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">From idea to audio in <span className="vox-grad-text">three steps</span></h2>
          </div>
          <div className="vox-grid vox-grid-3">
            {[
              { n: '1', title: 'Pick a voice',        desc: 'Clone your own in under a minute, or choose from 30+ studio voices. Set emotion and speed.' },
              { n: '2', title: 'Write or import',     desc: 'Type a script, paste text, or upload audio to auto-transcribe. Translate to any language with one click.' },
              { n: '3', title: 'Generate & assemble', desc: 'Synthesize with one click. Arrange clips on the timeline, layer music, and export your WAV.' },
            ].map(s => (
              <div key={s.n} className="vox-card" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                <div className="vox-step-num">{s.n}</div>
                <div>
                  <div className="vox-card-title" style={{ marginBottom: 8 }}>{s.title}</div>
                  <div className="vox-card-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="vox-rule" />

      {/* ── Self-hosted infrastructure ── */}
      <section id="self-hosted" className="vox-section">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Run on <span className="vox-grad-text">your own infrastructure</span></h2>
            <p className="vox-lead">Voxora is self-hostable — deploy under your own domain and keep every byte of audio and voice data on infrastructure you control.</p>
          </div>
          <div className="vox-grid vox-grid-3">
            <div className="vox-card">
              <div className="vox-card-icon">{icons.shield}</div>
              <div className="vox-card-title">Full Data Residency</div>
              <div className="vox-card-desc">Voice profiles, scripts, and generated audio never leave infrastructure you control. No third-party SaaS processor in the loop unless you choose one.</div>
            </div>
            <div className="vox-card">
              <div className="vox-card-icon">{icons.template}</div>
              <div className="vox-card-title">Your Own Domain</div>
              <div className="vox-card-desc">Deploy Voxora under your own domain for your team, studio, or organization — fully under your control end to end.</div>
            </div>
            <div className="vox-card">
              <div className="vox-card-icon">{icons.api}</div>
              <div className="vox-card-title">No Per-Seat Lock-In</div>
              <div className="vox-card-desc">Run it on your own servers and scale usage without per-seat SaaS pricing working against you as your team or customer base grows.</div>
            </div>
          </div>
        </div>
      </section>

      <hr className="vox-rule" />


      <section className="vox-section" id="pricing">
        <div className="vox-wrap">
          <div className="vox-section-head">
            <h2 className="vox-h2">Simple, transparent <span className="vox-grad-text">pricing</span></h2>
            <p className="vox-lead">Start free. Upgrade when you need more. Cancel any time.</p>
          </div>
          
          {/* 👇 CHANGE: updated from vox-grid-3 to vox-grid-4 */}
          <div className="vox-grid vox-grid-4">
            {PRICING.map(p => (
              <div key={p.name} className={`vox-price-card${p.featured ? ' vox-price-card--featured' : ''}`}>
                <div>
                  <div className="vox-price-name">{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
                    <span className="vox-price-amount vox-grad-text">{p.amount}</span>
                    {p.period && <span className="vox-price-period">{p.period}</span>}
                  </div>
                  <div className="vox-price-desc" style={{ marginTop: 8 }}>{p.desc}</div>
                </div>
                <ul className="vox-price-feats">
                  {p.feats.map(f => (
                    <li key={f} className="vox-price-feat">
                      <span className="vox-price-check">{CHECK}</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`vox-btn${p.featured ? ' vox-btn--primary' : ' vox-btn--ghost'}`}
                  style={{ width: '100%', marginTop: 'auto' }}
                  onClick={onSignUp}
                >
                  {p.btn}
                </button>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--vx-text-3)' }}>
            All plans include a 7-day trial. Payments via PayPal — credit &amp; debit cards accepted.{' '}
            <button
              onClick={() => onNavigate?.('pricing')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4b5fd', fontSize: 13, textDecoration: 'underline' }}
            >
              See full plan details →
            </button>
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="vox-cta">
        <div className="vox-cta-box">
          <span className="vox-eyebrow" style={{ marginBottom: 20, display: 'inline-flex' }}>Start today</span>
          <h2 className="vox-h2" style={{ marginBottom: 18 }}>Ready to hear yourself?</h2>
          <p className="vox-lead" style={{ marginBottom: 36 }}>
            Join creators already using Voxora to ship better audio, faster.
            Free plan, no credit card, no install.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
              Create your workspace →
            </button>
            <button className="vox-btn vox-btn--ghost vox-btn--lg" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        </div>
      </section>

      <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
    </div>
  )
}
