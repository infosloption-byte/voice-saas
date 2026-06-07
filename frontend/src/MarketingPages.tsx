import { LogoMark } from './LandingPage'
import { icons } from './constants'

// ── Shared layout for all feature pages ──────────────────────────
function FeaturePageShell({
  children,
  onBack,
  onSignUp,
  onSignIn,
  currentPage,
  onNavigate,
}: {
  children: React.ReactNode
  onBack?: () => void
  onSignUp?: () => void
  onSignIn?: () => void
  currentPage?: string
  onNavigate?: (page: string) => void
}) {
  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 48px', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 50,
        backdropFilter: 'blur(8px)',
      }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <LogoMark size={26} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>Voxora</span>
        </button>
        <span style={{ color: 'var(--border-2)', fontSize: 16 }}>·</span>
        {[
          { key: 'feature-studio',      label: 'Studio' },
          { key: 'feature-voices',      label: 'Voice Library' },
          { key: 'feature-translation', label: 'Translation' },
          { key: 'feature-timeline',    label: 'Timeline' },
          { key: 'feature-audiobooks',  label: 'Audiobooks' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onNavigate?.(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: currentPage === key ? 600 : 500,
              color: currentPage === key ? 'var(--accent)' : 'var(--text-2)',
              padding: '4px 6px',
              borderBottom: currentPage === key ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn--ghost" style={{ fontSize: 13 }} onClick={onSignIn}>Sign in</button>
        <button className="btn btn--primary" style={{ fontSize: 13 }} onClick={onSignUp}>Get started free</button>
      </nav>

      {children}

      {/* Footer */}
      <footer style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 48px', borderTop: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-3)', marginTop: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={16} />
          <span>Voxora</span>
        </div>
        <span>© {new Date().getFullYear()} Voxora — AI voice synthesis in the cloud</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignIn}>Sign in</button>
          <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }} onClick={onSignUp}>Sign up</button>
        </div>
      </footer>
    </div>
  )
}

function HeroBadge({ text }: { text: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: 11, fontWeight: 600, color: 'var(--accent)',
      background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)',
      borderRadius: 99, padding: '4px 12px', letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{text}</div>
  )
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <h2 style={{
        fontFamily: 'var(--serif)', fontSize: 'clamp(26px, 4vw, 40px)',
        fontWeight: 400, letterSpacing: '-0.8px', color: 'var(--text-1)', marginBottom: 10,
      }}>{title}</h2>
      {sub && <p style={{ fontSize: 15, color: 'var(--text-2)', maxWidth: 540, margin: '0 auto' }}>{sub}</p>}
    </div>
  )
}

function FeatureRow({ icon, title, desc, reverse = false }: {
  icon: React.ReactNode; title: string; desc: string; reverse?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap',
      flexDirection: reverse ? 'row-reverse' : 'row',
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', marginBottom: 16,
        }}>
          <div style={{ width: 22, height: 22 }}>{icon}</div>
        </div>
        <h3 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-1)', marginBottom: 12, lineHeight: 1.3 }}>{title}</h3>
        <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.7 }}>{desc}</p>
      </div>
      <div style={{
        flex: 1, minWidth: 240, height: 200,
        background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: 13,
      }}>
        <div style={{ textAlign: 'center', opacity: 0.5 }}>
          <div style={{ width: 32, height: 32, margin: '0 auto 8px', color: 'var(--accent)' }}>{icon}</div>
          <span>{title}</span>
        </div>
      </div>
    </div>
  )
}

function CtaBanner({ onSignUp }: { onSignUp?: () => void }) {
  return (
    <section style={{
      padding: '64px 48px', textAlign: 'center',
      background: 'var(--bg)', borderTop: '1px solid var(--border)',
    }}>
      <h2 style={{
        fontFamily: 'var(--serif)', fontSize: 'clamp(24px, 3.5vw, 38px)',
        fontWeight: 400, letterSpacing: '-0.7px', color: 'var(--text-1)', marginBottom: 14,
      }}>Start creating with Voxora today</h2>
      <p style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 28 }}>
        Free plan available — no credit card required.
      </p>
      <button className="btn btn--primary" style={{ padding: '12px 28px', fontSize: 15 }} onClick={onSignUp}>
        Create your workspace →
      </button>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// STUDIO PAGE
// ═══════════════════════════════════════════════════════════════════
export function StudioPage({ onBack, onSignUp, onSignIn, onNavigate }: {
  onBack?: () => void; onSignUp?: () => void; onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  const items = [
    {
      icon: icons.scripts,
      title: 'Script editor with rich controls',
      desc: 'Write directly in the browser editor. Set voice, speed, and emotion per script — or across the whole project at once. Undo / redo keeps every draft safe.',
    },
    {
      icon: icons.mic,
      title: 'One-click synthesis',
      desc: 'Hit Generate and your script is converted to natural speech in seconds. Choose XTTS v2 for cloned voices or F5-TTS for ultra-natural studio delivery.',
    },
    {
      icon: icons.music,
      title: '9 emotion presets',
      desc: 'Natural, Calm, Energetic, Cheerful, Serious, Dramatic, Whisper, Storytelling — dial in exactly the mood your content needs, without recording it twice.',
    },
    {
      icon: icons.profiles,
      title: 'Multi-voice scripts',
      desc: 'Assign a different voice to each speaker in a single script. Perfect for podcasts, character narration, interviews, and explainer content with dialogue.',
    },
  ]

  return (
    <FeaturePageShell onBack={onBack} onSignUp={onSignUp} onSignIn={onSignIn} currentPage="feature-studio" onNavigate={onNavigate}>
      {/* Hero */}
      <section style={{ padding: '72px 48px 56px', textAlign: 'center', background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)' }}>
        <HeroBadge text="Voice Studio" />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(36px, 5.5vw, 62px)',
          fontWeight: 400, letterSpacing: '-1.5px', color: 'var(--text-1)',
          lineHeight: 1.12, marginTop: 20, marginBottom: 20, maxWidth: 760, margin: '20px auto',
        }}>
          Write it. Voice it.<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Ship it.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-2)', maxWidth: 540, margin: '0 auto 32px', lineHeight: 1.65 }}>
          Voxora Studio is a full script-to-audio pipeline in your browser. Write or paste your content,
          pick a voice, tune the emotion, and generate broadcast-quality speech — no DAW needed.
        </p>
        <button className="btn btn--primary" style={{ padding: '11px 26px', fontSize: 14 }} onClick={onSignUp}>
          {icons.bolt} Open Studio free
        </button>
      </section>

      {/* Feature rows */}
      <section style={{ padding: '64px 48px', maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 64 }}>
        {items.map((item, i) => (
          <FeatureRow key={item.title} icon={item.icon} title={item.title} desc={item.desc} reverse={i % 2 !== 0} />
        ))}
      </section>

      {/* Specs strip */}
      <section style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '32px 48px' }}>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { val: '30+', label: 'Studio voices' },
            { val: '9',   label: 'Emotion presets' },
            { val: '16',  label: 'Languages' },
            { val: 'WAV', label: 'Export format' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-1)' }}>{s.val}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner onSignUp={onSignUp} />
    </FeaturePageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// VOICE LIBRARY PAGE
// ═══════════════════════════════════════════════════════════════════
const SAMPLE_VOICES = [
  { name: 'Aria', style: 'Warm & conversational', gender: 'F', lang: 'English' },
  { name: 'Marcus', style: 'Deep & authoritative', gender: 'M', lang: 'English' },
  { name: 'Sofia', style: 'Bright & cheerful', gender: 'F', lang: 'Spanish' },
  { name: 'Lena', style: 'Clear & professional', gender: 'F', lang: 'German' },
  { name: 'Kenji', style: 'Calm & measured', gender: 'M', lang: 'Japanese' },
  { name: 'Priya', style: 'Expressive & warm', gender: 'F', lang: 'Hindi' },
  { name: 'Tom', style: 'Friendly & upbeat', gender: 'M', lang: 'English' },
  { name: 'Chloé', style: 'Elegant & smooth', gender: 'F', lang: 'French' },
  { name: 'Omar', style: 'Rich & resonant', gender: 'M', lang: 'Arabic' },
]

export function VoicesPage({ onBack, onSignUp, onSignIn, onNavigate }: {
  onBack?: () => void; onSignUp?: () => void; onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  return (
    <FeaturePageShell onBack={onBack} onSignUp={onSignUp} onSignIn={onSignIn} currentPage="feature-voices" onNavigate={onNavigate}>
      {/* Hero */}
      <section style={{ padding: '72px 48px 56px', textAlign: 'center', background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)' }}>
        <HeroBadge text="Voice Library" />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(36px, 5.5vw, 62px)',
          fontWeight: 400, letterSpacing: '-1.5px', color: 'var(--text-1)',
          lineHeight: 1.12, margin: '20px auto', maxWidth: 760,
        }}>
          Your voice — or the perfect one<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>for any character.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-2)', maxWidth: 540, margin: '0 auto 32px', lineHeight: 1.65 }}>
          Clone your own voice from a short sample, or pick from 30+ studio-crafted voices
          spanning languages, genders, and styles — all ready to use in seconds.
        </p>
        <button className="btn btn--primary" style={{ padding: '11px 26px', fontSize: 14 }} onClick={onSignUp}>
          {icons.mic} Clone my voice
        </button>
      </section>

      {/* Voice cloning section */}
      <section style={{ padding: '64px 48px', background: 'var(--bg-2)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <SectionHeading
            title="Clone your voice in under a minute"
            sub="Record a 10–30 second sample or upload an existing WAV. Voxora captures timbre, pacing, and intonation — then speaks any script in your voice."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { icon: icons.mic, title: 'Record or upload', desc: 'Use your browser mic or drop a WAV file.' },
              { icon: icons.bolt, title: 'Instant capture', desc: 'AI analyses voice characteristics in seconds.' },
              { icon: icons.scripts, title: 'Use everywhere', desc: 'Available in every script across all your projects.' },
              { icon: icons.profiles, title: 'Multiple profiles', desc: 'Save several voice clones — personal, professional, character.' },
            ].map(item => (
              <div key={item.title} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '20px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <div style={{ width: 16, height: 16 }}>{item.icon}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)' }}>{item.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Voice browser */}
      <section style={{ padding: '64px 48px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <SectionHeading
            title="30+ studio voices, ready instantly"
            sub="No sample needed. Browse voices by language, style, and gender — or just try one."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {SAMPLE_VOICES.map(v => (
              <div key={v.name} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '16px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13,
                  }}>{v.name[0]}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{v.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{v.lang}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{v.style}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-3)' }}>
            + more voices added regularly. Start for free to browse them all.
          </p>
        </div>
      </section>

      <CtaBanner onSignUp={onSignUp} />
    </FeaturePageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRANSLATION PAGE
// ═══════════════════════════════════════════════════════════════════
const SUPPORTED_LANGS = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Chinese (Mandarin)', 'Arabic', 'Hindi',
  'Russian', 'Dutch', 'Polish', 'Swedish', 'Turkish',
]

export function TranslationPage({ onBack, onSignUp, onSignIn, onNavigate }: {
  onBack?: () => void; onSignUp?: () => void; onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  return (
    <FeaturePageShell onBack={onBack} onSignUp={onSignUp} onSignIn={onSignIn} currentPage="feature-translation" onNavigate={onNavigate}>
      {/* Hero */}
      <section style={{ padding: '72px 48px 56px', textAlign: 'center', background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)' }}>
        <HeroBadge text="AI Translation" />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(36px, 5.5vw, 62px)',
          fontWeight: 400, letterSpacing: '-1.5px', color: 'var(--text-1)',
          lineHeight: 1.12, margin: '20px auto', maxWidth: 800,
        }}>
          Write once. Speak in<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>16 languages.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.65 }}>
          Translate your script with one click using Gemini AI, then synthesize it immediately in the target language.
          Reach global audiences without hiring translators or re-recording.
        </p>
        <button className="btn btn--primary" style={{ padding: '11px 26px', fontSize: 14 }} onClick={onSignUp}>
          {icons.globe} Try translation free
        </button>
      </section>

      {/* How it works */}
      <section style={{ padding: '64px 48px', background: 'var(--bg-2)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <SectionHeading
            title="Translation built into your workflow"
            sub="No copy-pasting into external tools. Translation happens inside the script editor — results appear instantly."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { n: '1', title: 'Write your script', desc: 'Type or import in any of the 16 supported languages.' },
              { n: '2', title: 'Click Translate', desc: 'Pick a target language from the toolbar. Gemini AI rewrites the script naturally.' },
              { n: '3', title: 'Generate speech', desc: 'The translated text is ready to synthesize immediately — same voice, new language.' },
              { n: '4', title: 'Repeat for any market', desc: 'Translate the same script to as many languages as you need.' },
            ].map(s => (
              <div key={s.n} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, fontFamily: 'var(--serif)' }}>{s.n}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>{s.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section style={{ padding: '64px 48px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <SectionHeading title="16 supported languages" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {SUPPORTED_LANGS.map(lang => (
              <span key={lang} style={{
                background: 'var(--bg-2)', border: '1px solid var(--border)',
                borderRadius: 99, padding: '6px 14px', fontSize: 13, color: 'var(--text-2)', fontWeight: 500,
              }}>{lang}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Plan note */}
      <section style={{ padding: '0 48px 48px' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)', marginBottom: 10 }}>Translation quotas by plan</div>
          {[
            { plan: 'Free', q: '10 translations / month' },
            { plan: 'Starter', q: '50 translations / month' },
            { plan: 'Pro', q: 'Unlimited translations' },
          ].map(row => (
            <div key={row.plan} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 500 }}>{row.plan}</span>
              <span>{row.q}</span>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner onSignUp={onSignUp} />
    </FeaturePageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TIMELINE PAGE
// ═══════════════════════════════════════════════════════════════════
export function TimelinePage({ onBack, onSignUp, onSignIn, onNavigate }: {
  onBack?: () => void; onSignUp?: () => void; onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  const features = [
    {
      icon: icons.assembly,
      title: 'Multi-lane timeline',
      desc: 'Stack voice clips, SFX, and music across independent lanes. Each lane has its own volume and mute control, giving you a proper mixing workspace in the browser.',
    },
    {
      icon: icons.scripts,
      title: 'Minimap navigation',
      desc: 'A full-width minimap at the top of the timeline shows every clip at once. Click or drag to jump to any point in long sessions without losing your place.',
    },
    {
      icon: icons.download,
      title: 'Precision clip editing',
      desc: 'Trim, split, and reposition clips by dragging handles. Insert silence gaps between clips. Zoom in to the frame level for precise edits.',
    },
    {
      icon: icons.music,
      title: 'One-click export',
      desc: 'Mix your assembled timeline down to a single high-quality WAV with one click. Or export every clip individually as a ZIP archive.',
    },
  ]

  return (
    <FeaturePageShell onBack={onBack} onSignUp={onSignUp} onSignIn={onSignIn} currentPage="feature-timeline" onNavigate={onNavigate}>
      {/* Hero */}
      <section style={{ padding: '72px 48px 56px', textAlign: 'center', background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)' }}>
        <HeroBadge text="Timeline Assembly" />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(36px, 5.5vw, 62px)',
          fontWeight: 400, letterSpacing: '-1.5px', color: 'var(--text-1)',
          lineHeight: 1.12, margin: '20px auto', maxWidth: 800,
        }}>
          Arrange. Layer. Mix.<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Right in your browser.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.65 }}>
          The Voxora timeline editor brings multi-track audio assembly to the web.
          Place synthesized clips, cut, trim, and layer tracks — then export a finished WAV,
          no desktop software required.
        </p>
        <button className="btn btn--primary" style={{ padding: '11px 26px', fontSize: 14 }} onClick={onSignUp}>
          {icons.assembly} Open Timeline free
        </button>
      </section>

      {/* Features */}
      <section style={{ padding: '64px 48px', maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 64 }}>
        {features.map((f, i) => (
          <FeatureRow key={f.title} icon={f.icon} title={f.title} desc={f.desc} reverse={i % 2 !== 0} />
        ))}
      </section>

      {/* Workflow note */}
      <section style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)', padding: '48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 26, fontWeight: 400, color: 'var(--text-1)', marginBottom: 12 }}>
            From script to mixed audio in one tab
          </h3>
          <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.7 }}>
            Write your script in the Studio, generate each line as a clip, then switch to Assembly.
            Drag clips onto the timeline, layer background music, trim the silences, and export.
            No round-tripping between apps.
          </p>
        </div>
      </section>

      <CtaBanner onSignUp={onSignUp} />
    </FeaturePageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AUDIOBOOKS PAGE
// ═══════════════════════════════════════════════════════════════════
export function AudiobooksPage({ onBack, onSignUp, onSignIn, onNavigate }: {
  onBack?: () => void; onSignUp?: () => void; onSignIn?: () => void
  onNavigate?: (page: string) => void
}) {
  return (
    <FeaturePageShell onBack={onBack} onSignUp={onSignUp} onSignIn={onSignIn} currentPage="feature-audiobooks" onNavigate={onNavigate}>
      {/* Hero */}
      <section style={{ padding: '72px 48px 56px', textAlign: 'center', background: 'linear-gradient(160deg, var(--bg) 60%, var(--bg-2) 100%)' }}>
        <HeroBadge text="Audiobooks" />
        <h1 style={{
          fontFamily: 'var(--serif)', fontSize: 'clamp(36px, 5.5vw, 62px)',
          fontWeight: 400, letterSpacing: '-1.5px', color: 'var(--text-1)',
          lineHeight: 1.12, margin: '20px auto', maxWidth: 800,
        }}>
          Turn any book or course<br />
          <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>into a listening experience.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.65 }}>
          Voxora's project workspace, multi-script editor, and timeline assembler combine into
          a complete audiobook production pipeline — no studio booking, no narrator fees.
        </p>
        <button className="btn btn--primary" style={{ padding: '11px 26px', fontSize: 14 }} onClick={onSignUp}>
          {icons.scripts} Start my audiobook
        </button>
      </section>

      {/* Workflow */}
      <section style={{ padding: '64px 48px', background: 'var(--bg-2)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <SectionHeading
            title="A complete production workflow"
            sub="Each chapter is a script. Each script becomes a clip. The timeline assembles them into the finished audiobook."
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { n: '1', icon: icons.scripts, title: 'One script per chapter', desc: 'Organise long-form content into chapters inside a single project. Reorder or rename any time.' },
              { n: '2', icon: icons.mic, title: 'Consistent narration', desc: 'Pick a cloned or studio voice and apply it to every chapter for a consistent narrator sound.' },
              { n: '3', icon: icons.music, title: 'Emotion per section', desc: 'Adjust tone for dramatic scenes, calm passages, and dialogue — without re-recording.' },
              { n: '4', icon: icons.assembly, title: 'Assemble on the timeline', desc: 'Drop chapters onto the timeline. Adjust pacing, add music, and export the complete book.' },
            ].map(s => (
              <div key={s.n} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '22px 20px',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, fontFamily: 'var(--serif)', flexShrink: 0 }}>{s.n}</div>
                  <div style={{ width: 18, height: 18, color: 'var(--accent)' }}>{s.icon}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>{s.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scale */}
      <section style={{ padding: '64px 48px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <SectionHeading
            title="Scale with your plan"
            sub="The Pro plan removes all word and script limits — produce entire books without worrying about caps."
          />
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { plan: 'Free', scripts: '1 project · 500 words/script', color: 'var(--text-3)' },
              { plan: 'Starter', scripts: '10 projects · 5,000 words/script', color: 'var(--accent)' },
              { plan: 'Pro', scripts: 'Unlimited · No word limit', color: '#4278c9' },
            ].map(p => (
              <div key={p.plan} style={{
                background: 'var(--bg-2)', border: `2px solid ${p.color}`,
                borderRadius: 'var(--radius-lg)', padding: '18px 24px', minWidth: 180, textAlign: 'center',
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: p.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{p.plan}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{p.scripts}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Multilingual note */}
      <section style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)', padding: '48px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 400, color: 'var(--text-1)', marginBottom: 12 }}>
            Publish in multiple languages
          </h3>
          <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.7 }}>
            Use the built-in translation feature to produce your audiobook in Spanish, French, German,
            Japanese, and 12 more languages — reaching a global audience from a single source manuscript.
          </p>
        </div>
      </section>

      <CtaBanner onSignUp={onSignUp} />
    </FeaturePageShell>
  )
}
