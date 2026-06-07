import { VoxNav, VoxFooter } from './LandingPage'
import { icons } from './constants'
import './landing.css'

interface PageProps {
  onBack?: () => void
  onSignUp?: () => void
  onSignIn?: () => void
  onNavigate?: (page: string) => void
}

// ── Shell wrapper ─────────────────────────────────────────────────
function Shell({ children, onSignUp, onSignIn, onNavigate }: PageProps & { children: React.ReactNode }) {
  return (
    <div className="vox">
      <div className="vox-ambient"><div className="vox-ambient-3" /></div>
      <VoxNav onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
      {children}
      <VoxFooter onSignIn={onSignIn} onSignUp={onSignUp} onNavigate={onNavigate} />
    </div>
  )
}

// ── Reusable primitives ───────────────────────────────────────────
function Hero({ eyebrow, h1, accent, lead, cta, ctaIcon, onSignUp }: {
  eyebrow: string; h1: string; accent: string; lead: string; cta: string
  ctaIcon?: React.ReactNode; onSignUp?: () => void
}) {
  return (
    <section className="vox-hero" style={{ paddingBottom: 56 }}>
      <span className="vox-eyebrow">{eyebrow}</span>
      <h1 className="vox-h1" style={{ fontSize: 'clamp(38px, 6vw, 68px)' }}>
        {h1}<br /><span className="vox-grad-text">{accent}</span>
      </h1>
      <p className="vox-lead" style={{ marginTop: 22 }}>{lead}</p>
      <div style={{ marginTop: 32 }}>
        <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
          {ctaIcon && <span className="vox-btn-icon">{ctaIcon}</span>}
          {cta}
        </button>
      </div>
    </section>
  )
}

function SHead({ pre, title, accent, sub }: { pre?: string; title: string; accent?: string; sub?: string }) {
  return (
    <div className="vox-section-head">
      {pre && <span className="vox-eyebrow" style={{ marginBottom: 18, display: 'inline-flex' }}>{pre}</span>}
      <h2 className="vox-h2">{title}{accent && <> <span className="vox-grad-text">{accent}</span></>}</h2>
      {sub && <p className="vox-lead" style={{ marginTop: 16 }}>{sub}</p>}
    </div>
  )
}

function FRow({ icon, title, desc, reverse, children }: {
  icon: React.ReactNode; title: string; desc: string; reverse?: boolean; children?: React.ReactNode
}) {
  return (
    <div className={`vox-row${reverse ? ' vox-row--rev' : ''}`}>
      <div className="vox-row-text">
        <div className="vox-card-icon" style={{ marginBottom: 20 }}>{icon}</div>
        <h3 className="vox-row-title">{title}</h3>
        <p className="vox-row-desc">{desc}</p>
      </div>
      <div className="vox-row-visual">
        <div className="vox-row-visual-glow" />
        {children ?? <div className="vox-row-visual-icon">{icon}</div>}
      </div>
    </div>
  )
}

function Cta({ onSignUp }: { onSignUp?: () => void }) {
  return (
    <section className="vox-cta">
      <div className="vox-cta-box">
        <h2 className="vox-h2" style={{ marginBottom: 16 }}>Start creating with Voxora today</h2>
        <p className="vox-lead" style={{ marginBottom: 32 }}>Free plan available — no credit card required.</p>
        <button className="vox-btn vox-btn--primary vox-btn--lg" onClick={onSignUp}>
          Create your workspace →
        </button>
      </div>
    </section>
  )
}

function StatStrip({ items }: { items: { val: string; label: string }[] }) {
  return (
    <section style={{ padding: '48px 40px' }}>
      <div className="vox-wrap">
        <div className="vox-stats">
          {items.map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div className="vox-stat-val vox-grad-text">{s.val}</div>
              <div className="vox-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// STUDIO PAGE
// ═══════════════════════════════════════════════════════════════════
export function StudioPage(props: PageProps) {
  return (
    <Shell {...props}>
      <Hero
        eyebrow="Voice Studio"
        h1="Write it. Voice it."
        accent="Ship it."
        lead="A full script-to-audio pipeline in your browser. Write or paste content, pick a voice, tune the emotion, and generate broadcast-quality speech — no DAW needed."
        cta="Open Studio free" ctaIcon={icons.bolt} onSignUp={props.onSignUp}
      />
      <hr className="vox-rule" />
      <StatStrip items={[
        { val: '30+', label: 'Studio voices' },
        { val: '9',   label: 'Emotion presets' },
        { val: '16',  label: 'Languages' },
        { val: 'WAV', label: 'Export format' },
      ]} />
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap">
          <SHead pre="Core features" title="Everything in" accent="one editor"
            sub="Write, generate, translate, and preview — without switching tabs or apps." />
          <div className="vox-grid vox-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {[
              { icon: icons.scripts,  title: 'Rich script editor',      desc: 'Set voice, speed, and emotion per script or per project. Undo/redo keeps every draft safe.' },
              { icon: icons.mic,      title: 'One-click synthesis',      desc: 'Hit Generate and your script becomes natural speech in seconds. XTTS v2 or F5-TTS engine.' },
              { icon: icons.music,    title: '9 emotion presets',        desc: 'Natural, Calm, Energetic, Cheerful, Serious, Dramatic, Whisper, Storytelling — dial in the mood.' },
              { icon: icons.profiles, title: 'Multi-voice scripts',      desc: 'Assign a different voice to each speaker. Full podcasts and dialogues from a single script.' },
              { icon: icons.upload,   title: 'Audio → Script',           desc: 'Upload audio and Voxora transcribes it to an editable script automatically.' },
              { icon: icons.globe,    title: 'Translate in one click',   desc: 'AI translation (Gemini) rewrites your script in 16 languages without leaving the editor.' },
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
        <div className="vox-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 72, maxWidth: 1000 }}>
          <FRow icon={icons.mic} title="Synthesize in your voice" reverse={false}
            desc="Pick your cloned voice profile or any studio voice, set the emotion and speed, and generate. Each synthesis is saved as a reusable clip ready for the timeline." />
          <FRow icon={icons.music} title="Fine-tune emotion per script" reverse={true}
            desc="Different scripts in the same project can use different emotions. A Whisper intro, an Energetic segment, a Calm outro — all in one project, all in the same voice." />
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
  { name: 'Aria',   style: 'Warm & conversational', lang: 'English'  },
  { name: 'Marcus', style: 'Deep & authoritative',  lang: 'English'  },
  { name: 'Sofia',  style: 'Bright & cheerful',     lang: 'Spanish'  },
  { name: 'Lena',   style: 'Clear & professional',  lang: 'German'   },
  { name: 'Kenji',  style: 'Calm & measured',       lang: 'Japanese' },
  { name: 'Priya',  style: 'Expressive & warm',     lang: 'Hindi'    },
  { name: 'Tom',    style: 'Friendly & upbeat',     lang: 'English'  },
  { name: 'Chloé',  style: 'Elegant & smooth',      lang: 'French'   },
  { name: 'Omar',   style: 'Rich & resonant',       lang: 'Arabic'   },
  { name: 'Yuki',   style: 'Light & natural',       lang: 'Japanese' },
  { name: 'Elena',  style: 'Confident & clear',     lang: 'Russian'  },
  { name: 'Carlos', style: 'Warm & persuasive',     lang: 'Spanish'  },
]

export function VoicesPage(props: PageProps) {
  return (
    <Shell {...props}>
      <Hero
        eyebrow="Voice Library"
        h1="Your voice — or the perfect one"
        accent="for any character."
        lead="Clone your own voice from a short sample, or pick from 30+ studio-crafted voices. Use any voice in any project — switch anytime."
        cta="Clone my voice" ctaIcon={icons.mic} onSignUp={props.onSignUp}
      />
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap">
          <SHead pre="Voice cloning" title="Sounds exactly" accent="like you."
            sub="Record a 10–30 second sample or upload a WAV. Voxora captures timbre, pacing, and intonation — then speaks any script in your voice." />
          <div className="vox-grid vox-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', maxWidth: 880, margin: '0 auto' }}>
            {[
              { icon: icons.mic,      title: 'Record or upload',   desc: 'Use your browser mic for a quick sample, or upload a clean WAV file.' },
              { icon: icons.bolt,     title: 'Instant capture',    desc: 'AI analyses voice characteristics in seconds — no training time.' },
              { icon: icons.scripts,  title: 'Use everywhere',     desc: 'Your cloned voice is available in every script across all your projects.' },
              { icon: icons.profiles, title: 'Multiple profiles',  desc: 'Save several clones — personal, professional, narrator, character.' },
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
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap">
          <SHead pre="Studio library" title="30+ voices," accent="ready instantly."
            sub="No recording needed. Browse by language, style, or gender — or just pick one and generate." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
            {SAMPLE_VOICES.map(v => (
              <div key={v.name} className="vox-voice">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
          <p style={{ textAlign: 'center', marginTop: 28, fontSize: 13.5, color: 'var(--vx-text-3)' }}>
            + more voices added regularly. Create a free account to browse the full library.
          </p>
        </div>
      </section>
      <StatStrip items={[
        { val: '30+', label: 'Studio voices' },
        { val: '16',  label: 'Languages covered' },
        { val: '9',   label: 'Emotion styles' },
        { val: '∞',   label: 'Clones on Pro' },
      ]} />
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
    <Shell {...props}>
      <Hero
        eyebrow="AI Translation"
        h1="Write once. Speak in"
        accent="16 languages."
        lead="Translate your script with one click — powered by Gemini AI. Synthesize in the target language immediately. No copy-pasting, no external tools."
        cta="Try translation free" ctaIcon={icons.globe} onSignUp={props.onSignUp}
      />
      <hr className="vox-rule" />
      <StatStrip items={[
        { val: '16',     label: 'Languages' },
        { val: '1',      label: 'Click to translate' },
        { val: 'Gemini', label: 'AI engine' },
        { val: '∞',      label: 'Translations on Pro' },
      ]} />
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap">
          <SHead pre="Workflow" title="Translation built into" accent="your editor"
            sub="The translate button lives in the script toolbar. Pick a target language, click, and the result appears inline — ready to synthesize." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {[
              { n: '1', title: 'Write your script',     desc: 'Type or import in any of the 16 supported languages.' },
              { n: '2', title: 'Click Translate',        desc: 'Choose a target language from the toolbar. Gemini AI rewrites naturally.' },
              { n: '3', title: 'Review & synthesize',   desc: 'The translated text appears inline. Hit Generate to produce speech in the new language.' },
              { n: '4', title: 'Repeat for any market', desc: 'Translate the same script to as many languages as your plan allows.' },
            ].map(s => (
              <div key={s.n} className="vox-card" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                <div className="vox-step-num" style={{ flexShrink: 0 }}>{s.n}</div>
                <div>
                  <div className="vox-card-title" style={{ marginBottom: 7 }}>{s.title}</div>
                  <div className="vox-card-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap">
          <SHead title="16 supported" accent="languages" />
          <div className="vox-chips">
            {SUPPORTED_LANGS.map(l => <span key={l} className="vox-chip">{l}</span>)}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 640 }}>
          <SHead title="Plan quotas" />
          <div className="vox-card">
            {[
              { plan: 'Free',    q: '10 translations / month',   col: 'var(--vx-text-3)' },
              { plan: 'Starter', q: '50 translations / month',   col: '#c4b5fd' },
              { plan: 'Pro',     q: 'Unlimited translations',     col: 'var(--vx-coral)' },
            ].map((r, i, a) => (
              <div key={r.plan} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 0', fontSize: 14, color: 'var(--vx-text-2)',
                borderBottom: i < a.length - 1 ? '1px solid var(--vx-border)' : 'none',
              }}>
                <span style={{ fontWeight: 700, color: r.col }}>{r.plan}</span>
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
  return (
    <Shell {...props}>
      <Hero
        eyebrow="Timeline Assembly"
        h1="Arrange. Layer. Mix."
        accent="Right in your browser."
        lead="Multi-track audio assembly without desktop software. Place synthesized clips, cut, trim, and layer — then export a finished WAV with one click."
        cta="Open Timeline free" ctaIcon={icons.assembly} onSignUp={props.onSignUp}
      />
      <hr className="vox-rule" />
      <StatStrip items={[
        { val: '∞',      label: 'Lanes on Pro'      },
        { val: '1-click', label: 'WAV export'       },
        { val: 'ZIP',    label: 'Batch export'       },
        { val: 'Frame',  label: 'Zoom precision'     },
      ]} />
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 72, maxWidth: 1000 }}>
          <FRow icon={icons.assembly} reverse={false}
            title="Multi-lane track view"
            desc="Stack voice clips, music, and SFX across independent lanes. Each lane has its own volume and mute control — a real mixing workspace, no plugins required." />
          <FRow icon={icons.scripts} reverse={true}
            title="Minimap navigation"
            desc="A full-width minimap above the timeline shows every clip at once. Click or drag to jump to any position — no more scrolling through long sessions blind." />
          <FRow icon={icons.download} reverse={false}
            title="Precise clip editing"
            desc="Trim start and end by dragging handles. Split a clip at the cursor. Insert silence gaps to control pacing. Zoom from project-level to frame-level with the scroll wheel." />
          <FRow icon={icons.music} reverse={true}
            title="One-click export"
            desc="Mix the assembled timeline down to a single high-quality WAV with one click. Or export every clip individually as a ZIP archive — your choice." />
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 760, textAlign: 'center' }}>
          <div className="vox-card" style={{ padding: '36px 32px', alignItems: 'center', textAlign: 'center', gap: 14 }}>
            <div style={{ fontSize: 36 }}>🎚</div>
            <h3 className="vox-row-title" style={{ fontSize: 24, textAlign: 'center' }}>From script to mixed audio in one tab</h3>
            <p className="vox-row-desc" style={{ textAlign: 'center' }}>
              Write in the Studio tab, generate each line as a clip, then switch to Assembly.
              Drag clips onto the timeline, layer background music, trim the silences, and export.
              No round-tripping between apps.
            </p>
          </div>
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
    <Shell {...props}>
      <Hero
        eyebrow="Audiobooks"
        h1="Turn any book or course"
        accent="into a listening experience."
        lead="Voxora's project workspace, multi-script editor, and timeline assembler combine into a complete audiobook production pipeline — no studio booking, no narrator fees."
        cta="Start my audiobook" ctaIcon={icons.scripts} onSignUp={props.onSignUp}
      />
      <hr className="vox-rule" />
      <StatStrip items={[
        { val: '∞',  label: 'Scripts on Pro'   },
        { val: '∞',  label: 'Words per script on Pro' },
        { val: '16', label: 'Languages'          },
        { val: '1',  label: 'Export click'       },
      ]} />
      <hr className="vox-rule" />
      <section className="vox-section">
        <div className="vox-wrap">
          <SHead pre="Production workflow" title="A complete pipeline" accent="for long-form audio"
            sub="Each chapter is a script. Each script becomes a clip. The timeline assembles them into the finished audiobook." />
          <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {[
              { n: '1', icon: icons.scripts,  title: 'One script per chapter', desc: 'Organise content into chapters inside a single project. Reorder or rename any time.' },
              { n: '2', icon: icons.mic,      title: 'Consistent narration',   desc: 'Pick a cloned or studio voice and apply it to every chapter for a consistent narrator sound.' },
              { n: '3', icon: icons.music,    title: 'Emotion per section',    desc: 'Adjust tone for dramatic scenes, calm passages, and dialogue — without re-recording.' },
              { n: '4', icon: icons.assembly, title: 'Assemble the finished book', desc: 'Drop chapters onto the timeline. Add music, adjust pacing, and export the complete WAV.' },
            ].map(s => (
              <div key={s.n} className="vox-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  <div className="vox-step-num" style={{ flexShrink: 0 }}>{s.n}</div>
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
        <div className="vox-wrap" style={{ maxWidth: 860, textAlign: 'center' }}>
          <SHead title="Scale with" accent="your plan"
            sub="The Pro plan removes all word and script limits — produce entire books without worrying about caps." />
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { plan: 'Free',    detail: '1 project · 500 words / script' },
              { plan: 'Starter', detail: '10 projects · 5,000 words / script' },
              { plan: 'Pro',     detail: 'Unlimited · No word limit' },
            ].map(p => (
              <div key={p.plan} className="vox-card" style={{ minWidth: 210, alignItems: 'center', textAlign: 'center', padding: '24px 20px' }}>
                <div className="vox-grad-text" style={{ fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{p.plan}</div>
                <div className="vox-card-desc">{p.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="vox-section" style={{ paddingTop: 0 }}>
        <div className="vox-wrap" style={{ maxWidth: 700, textAlign: 'center' }}>
          <div className="vox-card" style={{ alignItems: 'center', textAlign: 'center', padding: '36px 32px', gap: 14 }}>
            <div style={{ fontSize: 38 }}>🌍</div>
            <h3 className="vox-row-title" style={{ fontSize: 24 }}>Publish in multiple languages</h3>
            <p className="vox-row-desc">
              Use the built-in AI translation to produce your audiobook in Spanish, French, German,
              Japanese, and 12 more languages — from a single source manuscript, reaching a global audience.
            </p>
          </div>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}
