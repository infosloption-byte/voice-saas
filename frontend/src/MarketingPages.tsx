import { VoxNav, VoxFooter } from './LandingPage'
import { icons } from './constants'
import './landing.css'

interface PageProps {
  onBack?: () => void
  onSignUp?: () => void
  onSignIn?: () => void
  onNavigate?: (page: string) => void
}

// ── Shared building blocks ────────────────────────────────────────
function Shell({ children, current, onSignUp, onSignIn, onNavigate }: {
  children: React.ReactNode; current: string
} & PageProps) {
  return (
    <div className="vox">
      <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} current={current} />
      {children}
      <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
    </div>
  )
}

function Hero({ eyebrow, title, accent, lead, cta, icon, onSignUp }: {
  eyebrow: string; title: React.ReactNode; accent: string; lead: string; cta: string
  icon: React.ReactNode; onSignUp?: () => void
}) {
  return (
    <section className="vox-hero" style={{ paddingTop: 80, paddingBottom: 64 }}>
      <span className="vox-eyebrow">{eyebrow}</span>
      <h1 className="vox-h1" style={{ fontSize: 'clamp(38px, 6vw, 70px)' }}>
        {title}<br /><span className="vox-grad-text">{accent}</span>
      </h1>
      <p className="vox-lead">{lead}</p>
      <div style={{ marginTop: 30 }}>
        <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
          <span className="vox-btn-icon">{icon}</span> {cta}
        </button>
      </div>
    </section>
  )
}

function SectionHead({ title, accent, sub }: { title: string; accent?: string; sub?: string }) {
  return (
    <div className="vox-section-head">
      <h2 className="vox-h2">{title}{accent && <> <span className="vox-grad-text">{accent}</span></>}</h2>
      {sub && <p className="vox-lead">{sub}</p>}
    </div>
  )
}

function FeatureRow({ icon, title, desc, reverse }: {
  icon: React.ReactNode; title: string; desc: string; reverse?: boolean
}) {
  return (
    <div className={`vox-row${reverse ? ' vox-row--rev' : ''}`}>
      <div className="vox-row-text">
        <div className="vox-card-icon" style={{ marginBottom: 18 }}>{icon}</div>
        <h3 className="vox-row-title">{title}</h3>
        <p className="vox-row-desc">{desc}</p>
      </div>
      <div className="vox-row-visual">
        <div className="vox-row-visual-icon">{icon}</div>
      </div>
    </div>
  )
}

function Cta({ onSignUp }: { onSignUp?: () => void }) {
  return (
    <section className="vox-cta">
      <div className="vox-cta-box">
        <h2 className="vox-h2" style={{ marginBottom: 14 }}>Start creating with Voxora today</h2>
        <p className="vox-lead" style={{ marginBottom: 28 }}>Free plan available — no credit card required.</p>
        <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>Create your workspace →</button>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// STUDIO
// ═══════════════════════════════════════════════════════════════════
export function StudioPage(props: PageProps) {
  const items = [
    { icon: icons.scripts,  title: 'Script editor with rich controls', desc: 'Write directly in the browser editor. Set voice, speed, and emotion per script — or across the whole project at once. Undo / redo keeps every draft safe.' },
    { icon: icons.mic,      title: 'One-click synthesis',              desc: 'Hit Generate and your script becomes natural speech in seconds. Choose XTTS v2 for cloned voices or F5-TTS for ultra-natural studio delivery.' },
    { icon: icons.music,    title: '9 emotion presets',                desc: 'Natural, Calm, Energetic, Cheerful, Serious, Dramatic, Whisper, Storytelling — dial in exactly the mood your content needs, without recording twice.' },
    { icon: icons.profiles, title: 'Multi-voice scripts',             desc: 'Assign a different voice to each speaker in a single script. Perfect for podcasts, character narration, interviews, and dialogue-driven content.' },
  ]
  return (
    <Shell current="feature-studio" {...props}>
      <Hero
        eyebrow="Voice Studio"
        title="Write it. Voice it."
        accent="Ship it."
        lead="Voxora Studio is a full script-to-audio pipeline in your browser. Write or paste your content, pick a voice, tune the emotion, and generate broadcast-quality speech — no DAW needed."
        cta="Open Studio free" icon={icons.bolt} onSignUp={props.onSignUp}
      />
      <section className="vox-section" style={{ paddingTop: 24 }}>
        <div className="vox-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 72, maxWidth: 1000 }}>
          {items.map((it, i) => <FeatureRow key={it.title} {...it} reverse={i % 2 !== 0} />)}
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <div className="vox-stats">
            {[{ val: '30+', label: 'Studio voices' }, { val: '9', label: 'Emotion presets' }, { val: '16', label: 'Languages' }, { val: 'WAV', label: 'Export format' }].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div className="vox-stat-val vox-grad-text">{s.val}</div>
                <div className="vox-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// VOICE LIBRARY
// ═══════════════════════════════════════════════════════════════════
const SAMPLE_VOICES = [
  { name: 'Aria',   style: 'Warm & conversational', lang: 'English' },
  { name: 'Marcus', style: 'Deep & authoritative',  lang: 'English' },
  { name: 'Sofia',  style: 'Bright & cheerful',     lang: 'Spanish' },
  { name: 'Lena',   style: 'Clear & professional',  lang: 'German' },
  { name: 'Kenji',  style: 'Calm & measured',       lang: 'Japanese' },
  { name: 'Priya',  style: 'Expressive & warm',     lang: 'Hindi' },
  { name: 'Tom',    style: 'Friendly & upbeat',     lang: 'English' },
  { name: 'Chloé',  style: 'Elegant & smooth',      lang: 'French' },
  { name: 'Omar',   style: 'Rich & resonant',       lang: 'Arabic' },
]

export function VoicesPage(props: PageProps) {
  return (
    <Shell current="feature-voices" {...props}>
      <Hero
        eyebrow="Voice Library"
        title="Your voice — or the perfect one"
        accent="for any character."
        lead="Clone your own voice from a short sample, or pick from 30+ studio-crafted voices spanning languages, genders, and styles — all ready to use in seconds."
        cta="Clone my voice" icon={icons.mic} onSignUp={props.onSignUp}
      />
      <section className="vox-section" style={{ paddingTop: 24 }}>
        <div className="vox-wrap">
          <SectionHead title="Clone your voice in" accent="under a minute"
            sub="Record a 10–30 second sample or upload an existing WAV. Voxora captures timbre, pacing, and intonation — then speaks any script in your voice." />
          <div className="vox-grid vox-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {[
              { icon: icons.mic,      title: 'Record or upload',  desc: 'Use your browser mic or drop a WAV file.' },
              { icon: icons.bolt,     title: 'Instant capture',   desc: 'AI analyses voice characteristics in seconds.' },
              { icon: icons.scripts,  title: 'Use everywhere',    desc: 'Available in every script across all your projects.' },
              { icon: icons.profiles, title: 'Multiple profiles', desc: 'Save several clones — personal, professional, character.' },
            ].map(it => (
              <div key={it.title} className="vox-card">
                <div className="vox-card-icon">{it.icon}</div>
                <div className="vox-card-title">{it.title}</div>
                <div className="vox-card-desc">{it.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <SectionHead title="30+ studio voices," accent="ready instantly"
            sub="No sample needed. Browse voices by language, style, and gender — or just try one." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
            {SAMPLE_VOICES.map(v => (
              <div key={v.name} className="vox-voice">
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div className="vox-voice-avatar">{v.name[0]}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--vx-text)' }}>{v.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--vx-text-3)' }}>{v.lang}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--vx-text-2)' }}>{v.style}</div>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13.5, color: 'var(--vx-text-3)' }}>
            + more voices added regularly. Start for free to browse them all.
          </p>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRANSLATION
// ═══════════════════════════════════════════════════════════════════
const SUPPORTED_LANGS = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Chinese (Mandarin)', 'Arabic', 'Hindi',
  'Russian', 'Dutch', 'Polish', 'Swedish', 'Turkish',
]

export function TranslationPage(props: PageProps) {
  return (
    <Shell current="feature-translation" {...props}>
      <Hero
        eyebrow="AI Translation"
        title="Write once. Speak in"
        accent="16 languages."
        lead="Translate your script with one click using Gemini AI, then synthesize it immediately in the target language. Reach global audiences without hiring translators or re-recording."
        cta="Try translation free" icon={icons.globe} onSignUp={props.onSignUp}
      />
      <section className="vox-section" style={{ paddingTop: 24 }}>
        <div className="vox-wrap">
          <SectionHead title="Translation built into" accent="your workflow"
            sub="No copy-pasting into external tools. Translation happens inside the script editor — results appear instantly." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {[
              { n: '1', title: 'Write your script',  desc: 'Type or import in any of the 16 supported languages.' },
              { n: '2', title: 'Click Translate',    desc: 'Pick a target language from the toolbar. Gemini AI rewrites the script naturally.' },
              { n: '3', title: 'Generate speech',    desc: 'Translated text is ready to synthesize immediately — same voice, new language.' },
              { n: '4', title: 'Repeat for any market', desc: 'Translate the same script to as many languages as you need.' },
            ].map(s => (
              <div key={s.n} className="vox-card">
                <div className="vox-step-num">{s.n}</div>
                <div className="vox-card-title">{s.title}</div>
                <div className="vox-card-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <SectionHead title="16 supported languages" />
          <div className="vox-chips">
            {SUPPORTED_LANGS.map(l => <span key={l} className="vox-chip">{l}</span>)}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 620 }}>
          <div className="vox-card">
            <div className="vox-card-title" style={{ marginBottom: 6 }}>Translation quotas by plan</div>
            {[
              { plan: 'Free',    q: '10 translations / month' },
              { plan: 'Starter', q: '50 translations / month' },
              { plan: 'Pro',     q: 'Unlimited translations' },
            ].map(r => (
              <div key={r.plan} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--vx-text-2)', padding: '10px 0', borderBottom: '1px solid var(--vx-border)' }}>
                <span style={{ fontWeight: 600, color: 'var(--vx-text)' }}>{r.plan}</span>
                <span>{r.q}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════════════════════════════════
export function TimelinePage(props: PageProps) {
  const features = [
    { icon: icons.assembly, title: 'Multi-lane timeline',     desc: 'Stack voice clips, SFX, and music across independent lanes. Each lane has its own volume and mute control — a proper mixing workspace in the browser.' },
    { icon: icons.scripts,  title: 'Minimap navigation',      desc: 'A full-width minimap at the top of the timeline shows every clip at once. Click or drag to jump to any point in long sessions without losing your place.' },
    { icon: icons.download, title: 'Precision clip editing',  desc: 'Trim, split, and reposition clips by dragging handles. Insert silence gaps between clips. Zoom in to the frame level for precise edits.' },
    { icon: icons.music,    title: 'One-click export',        desc: 'Mix your assembled timeline down to a single high-quality WAV with one click. Or export every clip individually as a ZIP archive.' },
  ]
  return (
    <Shell current="feature-timeline" {...props}>
      <Hero
        eyebrow="Timeline Assembly"
        title="Arrange. Layer. Mix."
        accent="Right in your browser."
        lead="The Voxora timeline editor brings multi-track audio assembly to the web. Place synthesized clips, cut, trim, and layer tracks — then export a finished WAV, no desktop software required."
        cta="Open Timeline free" icon={icons.assembly} onSignUp={props.onSignUp}
      />
      <section className="vox-section" style={{ paddingTop: 24 }}>
        <div className="vox-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 72, maxWidth: 1000 }}>
          {features.map((f, i) => <FeatureRow key={f.title} {...f} reverse={i % 2 !== 0} />)}
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 760, textAlign: 'center' }}>
          <h3 className="vox-row-title" style={{ fontSize: 28 }}>From script to mixed audio in one tab</h3>
          <p className="vox-row-desc">
            Write your script in the Studio, generate each line as a clip, then switch to Assembly.
            Drag clips onto the timeline, layer background music, trim the silences, and export.
            No round-tripping between apps.
          </p>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AUDIOBOOKS
// ═══════════════════════════════════════════════════════════════════
export function AudiobooksPage(props: PageProps) {
  return (
    <Shell current="feature-audiobooks" {...props}>
      <Hero
        eyebrow="Audiobooks"
        title="Turn any book or course"
        accent="into a listening experience."
        lead="Voxora's project workspace, multi-script editor, and timeline assembler combine into a complete audiobook production pipeline — no studio booking, no narrator fees."
        cta="Start my audiobook" icon={icons.scripts} onSignUp={props.onSignUp}
      />
      <section className="vox-section" style={{ paddingTop: 24 }}>
        <div className="vox-wrap">
          <SectionHead title="A complete" accent="production workflow"
            sub="Each chapter is a script. Each script becomes a clip. The timeline assembles them into the finished audiobook." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {[
              { n: '1', icon: icons.scripts,  title: 'One script per chapter', desc: 'Organise long-form content into chapters inside a single project. Reorder or rename any time.' },
              { n: '2', icon: icons.mic,      title: 'Consistent narration',   desc: 'Pick a cloned or studio voice and apply it to every chapter for a consistent narrator sound.' },
              { n: '3', icon: icons.music,    title: 'Emotion per section',    desc: 'Adjust tone for dramatic scenes, calm passages, and dialogue — without re-recording.' },
              { n: '4', icon: icons.assembly, title: 'Assemble on the timeline', desc: 'Drop chapters onto the timeline. Adjust pacing, add music, and export the complete book.' },
            ].map(s => (
              <div key={s.n} className="vox-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="vox-step-num">{s.n}</div>
                  <div className="vox-card-icon" style={{ width: 38, height: 38 }}>{s.icon}</div>
                </div>
                <div className="vox-card-title">{s.title}</div>
                <div className="vox-card-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 820, textAlign: 'center' }}>
          <SectionHead title="Scale with your plan"
            sub="The Pro plan removes all word and script limits — produce entire books without worrying about caps." />
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { plan: 'Free',    scripts: '1 project · 500 words/script' },
              { plan: 'Starter', scripts: '10 projects · 5,000 words/script' },
              { plan: 'Pro',     scripts: 'Unlimited · No word limit' },
            ].map(p => (
              <div key={p.plan} className="vox-card" style={{ minWidth: 200, textAlign: 'center', alignItems: 'center' }}>
                <div className="vox-grad-text" style={{ fontWeight: 800, fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{p.plan}</div>
                <div className="vox-card-desc">{p.scripts}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 700, textAlign: 'center' }}>
          <h3 className="vox-row-title" style={{ fontSize: 26 }}>Publish in multiple languages</h3>
          <p className="vox-row-desc">
            Use the built-in translation feature to produce your audiobook in Spanish, French, German,
            Japanese, and 12 more languages — reaching a global audience from a single source manuscript.
          </p>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}
