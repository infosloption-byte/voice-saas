import { useState, useEffect, useRef } from 'react'
import { VoxNav, VoxFooter } from './LandingPage'
import { icons } from './constants'
import { api } from './api'
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

// ── Animated platform UI mockups ─────────────────────────────────

const px = {
  bg: '#12111a',
  card: '#1c1a28',
  border: '#2e2b44',
  accent: '#a78bfa',
  coral: '#f87171',
  text1: '#e8e6f0',
  text2: '#9490b5',
  text3: '#5a5673',
  green: '#34d399',
  blue: '#60a5fa',
  yellow: '#fbbf24',
}

function MockFrame({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: px.bg,
      border: `1px solid ${px.border}`,
      borderRadius: 14,
      overflow: 'hidden',
      width: '100%',
      aspectRatio: '16/10',
      position: 'relative',
      ...style,
    }}>
      {/* titlebar dots */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px 8px', borderBottom: `1px solid ${px.border}` }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f87171', opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#fbbf24', opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#34d399', opacity: 0.7 }} />
      </div>
      <div style={{ padding: '14px 16px', height: 'calc(100% - 32px)', overflow: 'hidden', boxSizing: 'border-box' }}>
        {children}
      </div>
    </div>
  )
}

function MockSynthesizeVoice() {
  const [active, setActive] = useState(0)
  const voices = ['Claribel', 'Daisy', 'Your Clone']
  const emotions = ['Natural', 'Calm', 'Energetic', 'Whisper']
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % voices.length), 2200)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      setGenerating(true); setDone(false)
      setTimeout(() => { setGenerating(false); setDone(true) }, 1400)
      setTimeout(() => setDone(false), 3200)
    }, 4000)
    return () => clearInterval(t)
  }, [])

  return (
    <MockFrame>
      {/* voice picker row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {voices.map((v, i) => (
          <div key={v} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: i === active ? px.accent : px.card,
            color: i === active ? '#fff' : px.text2,
            border: `1px solid ${i === active ? px.accent : px.border}`,
            transition: 'all 0.4s',
            cursor: 'pointer',
          }}>{v}</div>
        ))}
      </div>
      {/* emotion strip */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
        {emotions.map((e, i) => (
          <div key={e} style={{
            padding: '3px 9px', borderRadius: 12, fontSize: 10,
            background: i === 0 ? '#3b3458' : 'transparent',
            color: i === 0 ? px.accent : px.text3,
            border: `1px solid ${i === 0 ? px.accent : px.border}`,
          }}>{e}</div>
        ))}
      </div>
      {/* script box */}
      <div style={{
        background: px.card, borderRadius: 8, border: `1px solid ${px.border}`,
        padding: '10px 12px', fontSize: 11, color: px.text1, lineHeight: 1.6, marginBottom: 12,
      }}>
        Welcome to this episode. Today we explore<br />
        the future of AI-powered voice synthesis.
        <span style={{
          display: 'inline-block', width: 2, height: 12, background: px.accent,
          marginLeft: 3, verticalAlign: 'middle',
          animation: 'vox-blink 1s steps(1) infinite',
        }} />
      </div>
      {/* generate button + waveform */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          padding: '7px 18px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: generating ? '#3b3458' : done ? px.green : `linear-gradient(90deg,${px.accent},#818cf8)`,
          color: '#fff', cursor: 'pointer', transition: 'all 0.3s', whiteSpace: 'nowrap',
        }}>
          {generating ? '⏳ Generating…' : done ? '✓ Clip saved' : '▶ Generate'}
        </div>
        {done && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {[4,7,10,6,9,5,8,11,4,7,9,5].map((h, i) => (
              <div key={i} style={{
                width: 3, height: h, borderRadius: 2,
                background: `linear-gradient(180deg,${px.accent},#818cf8)`,
                opacity: 0.85,
              }} />
            ))}
          </div>
        )}
      </div>
    </MockFrame>
  )
}

function MockEmotionEditor() {
  const [sel, setSel] = useState(1)
  const scripts = [
    { name: 'Intro', emotion: 'Whisper', color: px.blue },
    { name: 'Chapter 1', emotion: 'Energetic', color: px.coral },
    { name: 'Outro', emotion: 'Calm', color: px.green },
  ]
  useEffect(() => {
    const t = setInterval(() => setSel(s => (s + 1) % scripts.length), 2000)
    return () => clearInterval(t)
  }, [])
  const emotions = ['Natural', 'Calm', 'Energetic', 'Cheerful', 'Whisper', 'Dramatic']
  return (
    <MockFrame>
      <div style={{ display: 'flex', gap: 10, height: '100%' }}>
        {/* script list */}
        <div style={{ width: 110, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {scripts.map((s, i) => (
            <div key={s.name} onClick={() => setSel(i)} style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              background: i === sel ? px.card : 'transparent',
              border: `1px solid ${i === sel ? s.color : px.border}`,
              transition: 'all 0.3s',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: i === sel ? px.text1 : px.text3, marginBottom: 3 }}>{s.name}</div>
              <div style={{ fontSize: 9, color: s.color, fontWeight: 600 }}>{s.emotion}</div>
            </div>
          ))}
        </div>
        {/* emotion picker */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: px.text3, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Emotion</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
            {emotions.map(e => (
              <div key={e} style={{
                padding: '6px 8px', borderRadius: 7, fontSize: 10, fontWeight: 600, textAlign: 'center',
                background: e === scripts[sel].emotion ? scripts[sel].color + '33' : px.card,
                color: e === scripts[sel].emotion ? scripts[sel].color : px.text2,
                border: `1px solid ${e === scripts[sel].emotion ? scripts[sel].color : px.border}`,
                transition: 'all 0.4s',
              }}>{e}</div>
            ))}
          </div>
        </div>
      </div>
    </MockFrame>
  )
}

function MockMultiLane() {
  const lanes = [
    { label: 'Voice', color: px.accent, clips: [[0,38],[45,72],[78,95]] },
    { label: 'Music', color: px.blue,   clips: [[0,100]] },
    { label: 'SFX',   color: px.yellow, clips: [[2,12],[50,62]] },
  ]
  return (
    <MockFrame>
      {/* timeline header */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} style={{ flex: 1, fontSize: 8, color: px.text3, textAlign: 'center' }}>{i * 10}s</div>
        ))}
      </div>
      {/* lanes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lanes.map(lane => (
          <div key={lane.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, fontSize: 9, fontWeight: 700, color: lane.color, flexShrink: 0, textAlign: 'right' }}>{lane.label}</div>
            <div style={{ flex: 1, height: 24, background: px.card, borderRadius: 6, position: 'relative', border: `1px solid ${px.border}` }}>
              {lane.clips.map(([s, e], ci) => (
                <div key={ci} style={{
                  position: 'absolute', left: `${s}%`, width: `${e - s}%`, top: 2, bottom: 2,
                  background: lane.color + '55', border: `1px solid ${lane.color}`,
                  borderRadius: 4,
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${px.border}`, background: px.card, display: 'grid', placeItems: 'center', fontSize: 9, color: px.text3 }}>M</div>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${px.border}`, background: px.card, display: 'grid', placeItems: 'center', fontSize: 9, color: px.text3 }}>S</div>
            </div>
          </div>
        ))}
      </div>
      {/* playhead */}
      <div style={{ position: 'relative', marginTop: 6, height: 20 }}>
        <div style={{
          position: 'absolute', left: '28%', top: 0, bottom: 0,
          width: 1, background: px.coral, opacity: 0.8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: px.coral, marginLeft: -2.5 }} />
        </div>
        <div style={{ fontSize: 8, color: px.text3, paddingTop: 6, paddingLeft: 4 }}>▶ 0:27.4</div>
      </div>
    </MockFrame>
  )
}

function MockMinimap() {
  return (
    <MockFrame>
      {/* minimap strip at top */}
      <div style={{
        background: px.card, border: `1px solid ${px.border}`, borderRadius: 8,
        height: 36, marginBottom: 12, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 8, color: px.text3, padding: '4px 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Overview</div>
        {/* clip blobs in minimap */}
        {[[3,18,px.accent],[22,40,px.blue],[44,55,px.accent],[60,80,px.yellow],[83,97,px.blue]].map(([l,r,c],i)=>(
          <div key={i} style={{
            position:'absolute',bottom:4,left:`${l}%`,width:`${(r as number)-(l as number)}%`,height:10,
            background: (c as string)+'66', borderRadius:3,
          }}/>
        ))}
        {/* viewport rect */}
        <div style={{
          position:'absolute',left:'30%',top:0,bottom:0,width:'35%',
          background:'rgba(167,139,250,0.15)',border:'1px solid '+px.accent,
          borderRadius:4,
        }}/>
      </div>
      {/* main timeline (zoomed) */}
      <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
        {[px.accent, px.blue, px.yellow].map((c,i)=>(
          <div key={i} style={{ height:22, background:px.card, border:`1px solid ${px.border}`, borderRadius:6, position:'relative', overflow:'hidden' }}>
            <div style={{
              position:'absolute',left:`${5+i*8}%`,width:`${40-i*4}%`,top:2,bottom:2,
              background:c+'55',border:`1px solid ${c}`,borderRadius:4,
            }}/>
          </div>
        ))}
      </div>
    </MockFrame>
  )
}

function MockClipEditor() {
  const [trimL, setTrimL] = useState(10)
  const [trimR, setTrimR] = useState(85)
  const bars = Array.from({ length: 60 }, (_, i) => 20 + Math.abs(Math.sin(i * 0.45 + 1) * 30 + Math.cos(i * 0.7) * 15))

  useEffect(() => {
    const t = setInterval(() => {
      setTrimL(l => l === 10 ? 18 : 10)
      setTrimR(r => r === 85 ? 75 : 85)
    }, 2500)
    return () => clearInterval(t)
  }, [])

  return (
    <MockFrame>
      {/* waveform */}
      <div style={{
        background: px.card, border: `1px solid ${px.border}`, borderRadius: 8,
        height: 64, position: 'relative', overflow: 'hidden', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 1, padding: '0 2px',
      }}>
        {/* trim handles */}
        <div style={{
          position: 'absolute', left: `${trimL}%`, top: 0, bottom: 0,
          width: 3, background: px.accent, borderRadius: '3px 0 0 3px', cursor: 'ew-resize',
          transition: 'left 0.5s ease',
          zIndex: 2,
        }} />
        <div style={{
          position: 'absolute', right: `${100 - trimR}%`, top: 0, bottom: 0,
          width: 3, background: px.accent, borderRadius: '0 3px 3px 0', cursor: 'ew-resize',
          transition: 'right 0.5s ease',
          zIndex: 2,
        }} />
        {/* dimmed regions outside trim */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${trimL}%`, background: 'rgba(0,0,0,0.55)', transition: 'width 0.5s ease', zIndex: 1 }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - trimR}%`, background: 'rgba(0,0,0,0.55)', transition: 'width 0.5s ease', zIndex: 1 }} />
        {bars.map((h, i) => (
          <div key={i} style={{
            flex: 1, height: `${h}%`, minHeight: 2,
            background: `linear-gradient(180deg,${px.accent},#818cf8)`,
            borderRadius: 1, opacity: 0.75,
          }} />
        ))}
      </div>
      {/* controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ padding: '5px 12px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: `linear-gradient(90deg,${px.accent},#818cf8)`, color: '#fff' }}>▶ Play</div>
        <div style={{ padding: '5px 12px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: px.card, border: `1px solid ${px.border}`, color: px.text2 }}>✂ Split</div>
        <div style={{ padding: '5px 12px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: px.card, border: `1px solid ${px.border}`, color: px.text2 }}>⬜ Gap</div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: px.text3 }}>
          {trimL / 10 | 0}:{String((trimL % 10) * 6).padStart(2,'0')} → {trimR / 10 | 0}:{String((trimR % 10) * 6).padStart(2,'0')}
        </div>
      </div>
    </MockFrame>
  )
}

function MockExport() {
  const [phase, setPhase] = useState<'idle'|'mixing'|'done'>('idle')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const cycle = () => {
      setPhase('mixing'); setProgress(0)
      const tick = setInterval(() => setProgress(p => {
        if (p >= 100) { clearInterval(tick); setPhase('done'); setTimeout(() => setPhase('idle'), 2500); return 100 }
        return p + 8
      }), 100)
    }
    cycle()
    const t = setInterval(cycle, 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <MockFrame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* format cards */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { fmt: 'Single WAV', desc: 'Mixed master', icon: '🎵', active: true },
            { fmt: 'ZIP Archive', desc: 'All clips', icon: '📦', active: false },
          ].map(f => (
            <div key={f.fmt} style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              background: f.active ? '#3b3458' : px.card,
              border: `1px solid ${f.active ? px.accent : px.border}`,
            }}>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{f.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: f.active ? px.text1 : px.text2, marginBottom: 2 }}>{f.fmt}</div>
              <div style={{ fontSize: 9, color: px.text3 }}>{f.desc}</div>
            </div>
          ))}
        </div>
        {/* progress bar */}
        <div style={{ background: px.card, border: `1px solid ${px.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 10 }}>
            <span style={{ color: px.text2, fontWeight: 600 }}>
              {phase === 'idle' ? 'Ready to export' : phase === 'mixing' ? '⏳ Mixing down…' : '✓ Export complete'}
            </span>
            <span style={{ color: phase === 'done' ? px.green : px.text3 }}>{phase === 'idle' ? '' : `${Math.min(progress, 100)}%`}</span>
          </div>
          <div style={{ height: 6, background: '#2e2b44', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: phase === 'done' ? px.green : `linear-gradient(90deg,${px.accent},#818cf8)`,
              width: phase === 'idle' ? '0%' : `${Math.min(progress, 100)}%`,
              transition: 'width 0.15s linear, background 0.3s',
            }} />
          </div>
        </div>
        {/* download row */}
        {phase === 'done' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: px.card, borderRadius: 8, border: `1px solid ${px.green}` }}>
            <span style={{ fontSize: 10, color: px.green, fontWeight: 700 }}>⬇ project-master.wav</span>
            <span style={{ fontSize: 9, color: px.text3, marginLeft: 'auto' }}>44.1 kHz · 16-bit</span>
          </div>
        )}
      </div>
    </MockFrame>
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
        { val: '17',  label: 'Languages' },
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
              { icon: icons.globe,    title: 'Translate in one click',   desc: 'AI translation (Gemini) rewrites your script in 17 languages without leaving the editor.' },
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
            desc="Pick your cloned voice profile or any studio voice, set the emotion and speed, and generate. Each synthesis is saved as a reusable clip ready for the timeline.">
            <MockSynthesizeVoice />
          </FRow>
          <FRow icon={icons.music} title="Fine-tune emotion per script" reverse={true}
            desc="Different scripts in the same project can use different emotions. A Whisper intro, an Energetic segment, a Calm outro — all in one project, all in the same voice.">
            <MockEmotionEditor />
          </FRow>
        </div>
      </section>
      <Cta onSignUp={props.onSignUp} />
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// VOICE LIBRARY
// ═══════════════════════════════════════════════════════════════════
const SAMPLE_VOICES: { name: string; full: string; style: string; lang: string; gender: 'F'|'M' }[] = [
  { name: 'Claribel',  full: 'Claribel Dervla',   style: 'Warm & conversational',   lang: 'English',    gender: 'F' },
  { name: 'Daisy',     full: 'Daisy Studious',     style: 'Clear & professional',    lang: 'English',    gender: 'F' },
  { name: 'Gracie',    full: 'Gracie Wise',        style: 'Bright & cheerful',       lang: 'English',    gender: 'F' },
  { name: 'Tammie',    full: 'Tammie Ema',         style: 'Friendly & upbeat',       lang: 'English',    gender: 'F' },
  { name: 'Ana',       full: 'Ana Florence',       style: 'Smooth & expressive',     lang: 'English',    gender: 'F' },
  { name: 'Sofia',     full: 'Sofia Hellen',       style: 'Elegant & measured',      lang: 'English',    gender: 'F' },
  { name: 'Tammy',     full: 'Tammy Grit',         style: 'Bold & assertive',        lang: 'English',    gender: 'F' },
  { name: 'Brenda',    full: 'Brenda Stern',       style: 'Authoritative & calm',    lang: 'English',    gender: 'F' },
  { name: 'Gitta',     full: 'Gitta Nikolina',     style: 'Crisp & energetic',       lang: 'English',    gender: 'F' },
  { name: 'Nova',      full: 'Nova Hogarth',       style: 'Deep & resonant',         lang: 'English',    gender: 'F' },
  { name: 'Maja',      full: 'Maja Ruoho',         style: 'Soft & intimate',         lang: 'English',    gender: 'F' },
  { name: 'Lilya',     full: 'Lilya Stainthorpe',  style: 'Gentle & storytelling',   lang: 'English',    gender: 'F' },
  { name: 'Narelle',   full: 'Narelle Moon',       style: 'Light & natural',         lang: 'English',    gender: 'F' },
  { name: 'Alma',      full: 'Alma María',         style: 'Warm & persuasive',       lang: 'Spanish',    gender: 'F' },
  { name: 'Rosemarie', full: 'Rosemarie Okafor',   style: 'Rich & confident',        lang: 'English',    gender: 'F' },
  { name: 'Andrew',    full: 'Andrew Chipper',     style: 'Energetic & punchy',      lang: 'English',    gender: 'M' },
  { name: 'Badr',      full: 'Badr Odhiambo',      style: 'Deep & authoritative',    lang: 'Arabic',     gender: 'M' },
  { name: 'Dionisio',  full: 'Dionisio Schuyler',  style: 'Dramatic & expressive',   lang: 'English',    gender: 'M' },
  { name: 'Royston',   full: 'Royston Min',        style: 'Calm & precise',          lang: 'English',    gender: 'M' },
  { name: 'Viktor',    full: 'Viktor Eka',         style: 'Firm & professional',     lang: 'Russian',    gender: 'M' },
  { name: 'Craig',     full: 'Craig Gutsy',        style: 'Strong & confident',      lang: 'English',    gender: 'M' },
  { name: 'Damien',    full: 'Damien Black',       style: 'Smooth & charismatic',    lang: 'English',    gender: 'M' },
  { name: 'Baldur',    full: 'Baldur Sanjin',      style: 'Bold & resonant',         lang: 'English',    gender: 'M' },
  { name: 'Zacharie',  full: 'Zacharie Aimilios',  style: 'Clear & engaging',        lang: 'French',     gender: 'M' },
  { name: 'Aaron',     full: 'Aaron Dreschner',    style: 'Warm & trustworthy',      lang: 'German',     gender: 'M' },
  { name: 'Kumar',     full: 'Kumar Dahl',         style: 'Expressive & vibrant',    lang: 'Hindi',      gender: 'M' },
  { name: 'Luis',      full: 'Luis Moray',         style: 'Smooth & conversational', lang: 'Portuguese', gender: 'M' },
  { name: 'Marcos',    full: 'Marcos Rudaski',     style: 'Energetic & warm',        lang: 'Spanish',    gender: 'M' },
  { name: 'Torcull',   full: 'Torcull Diarmuid',   style: 'Rich & storytelling',     lang: 'English',    gender: 'M' },
  { name: 'Wulf',      full: 'Wulf Carlevaro',     style: 'Deep & mysterious',       lang: 'English',    gender: 'M' },
]

function VoicePreviewBtn({ full }: { full: string }) {
  const [state, setState] = useState<'idle'|'loading'|'playing'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const toggle = async () => {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('idle')
      return
    }
    if (state === 'loading') return

    // If we already have the audio element loaded, just replay
    if (audioRef.current && audioRef.current.src) {
      audioRef.current.currentTime = 0
      audioRef.current.play()
      setState('playing')
      return
    }

    setState('loading')
    try {
      const blob = await api.engineFetchBlob(`/voice-preview/${encodeURIComponent(full)}`)
      const objUrl = URL.createObjectURL(blob)
      const audio = new Audio(objUrl)
      audioRef.current = audio
      audio.onended = () => setState('idle')
      audio.onerror = () => setState('idle')
      await audio.play()
      setState('playing')
    } catch {
      setState('idle')
    }
  }

  useEffect(() => () => { audioRef.current?.pause() }, [])

  return (
    <button onClick={toggle} title={state === 'playing' ? 'Pause preview' : 'Play preview'} style={{
      width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: state === 'playing'
        ? 'linear-gradient(135deg,#a78bfa,#818cf8)'
        : 'rgba(167,139,250,0.12)',
      color: state === 'playing' ? '#fff' : '#a78bfa',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, transition: 'all 0.2s',
      outline: state === 'playing' ? '2px solid #a78bfa' : 'none',
      outlineOffset: 2,
    }}>
      {state === 'loading'
        ? <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #a78bfa', borderTopColor: 'transparent', borderRadius: '50%', animation: 'vox-spin 0.7s linear infinite' }} />
        : state === 'playing'
          ? <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3" height="12" rx="1"/><rect x="7" y="0" width="3" height="12" rx="1"/></svg>
          : <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0 L10 6 L0 12 Z"/></svg>
      }
    </button>
  )
}

function VoiceFilter() {
  const [gender, setGender] = useState<'All'|'F'|'M'>('All')
  const [lang, setLang] = useState('All')
  const langs = ['All', ...Array.from(new Set(SAMPLE_VOICES.map(v => v.lang))).sort()]
  const visible = SAMPLE_VOICES.filter(v =>
    (gender === 'All' || v.gender === gender) &&
    (lang === 'All' || v.lang === lang)
  )
  return (
    <div>
      {/* filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['All','F','M'] as const).map(g => (
            <button key={g} onClick={() => setGender(g)} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: gender === g ? 'var(--vx-accent)' : 'transparent',
              color: gender === g ? '#fff' : 'var(--vx-text-3)',
              border: `1px solid ${gender === g ? 'var(--vx-accent)' : 'var(--vx-border)'}`,
              transition: 'all 0.2s',
            }}>{g === 'All' ? 'All' : g === 'F' ? 'Female' : 'Male'}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {langs.map(l => (
            <button key={l} onClick={() => setLang(l)} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: lang === l ? '#3b3458' : 'transparent',
              color: lang === l ? 'var(--vx-accent)' : 'var(--vx-text-3)',
              border: `1px solid ${lang === l ? 'var(--vx-accent)' : 'var(--vx-border)'}`,
              transition: 'all 0.2s',
            }}>{l}</button>
          ))}
        </div>
      </div>
      {/* voice grid */}
      <div className="vox-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {visible.map(v => (
          <div key={v.full} className="vox-voice" style={{ gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="vox-voice-avatar" style={{
                background: v.gender === 'F'
                  ? 'linear-gradient(135deg,#a78bfa,#818cf8)'
                  : 'linear-gradient(135deg,#60a5fa,#34d399)',
                flexShrink: 0,
              }}>{v.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--vx-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                <div style={{ fontSize: 10, color: 'var(--vx-text-3)', marginTop: 1 }}>{v.lang} · {v.gender === 'F' ? 'Female' : 'Male'}</div>
              </div>
              <VoicePreviewBtn full={v.full} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--vx-text-2)', lineHeight: 1.4 }}>{v.style}</div>
          </div>
        ))}
      </div>
      <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--vx-text-3)' }}>
        Every voice is available on all plans — including Free. Click ▶ to preview.
      </p>
    </div>
  )
}

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
          <SHead pre="Studio library" title="30 voices," accent="ready instantly."
            sub="No recording needed. Browse by language, style, or gender — every voice is available on all plans." />
          <VoiceFilter />
        </div>
      </section>
      <StatStrip items={[
        { val: '30',  label: 'Studio voices' },
        { val: '17',  label: 'Synthesis languages' },
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
  'Russian', 'Dutch', 'Polish', 'Czech', 'Turkish', 'Hungarian',
]

export function TranslationPage(props: PageProps) {
  return (
    <Shell {...props}>
      <Hero
        eyebrow="AI Translation"
        h1="Write once. Speak in"
        accent="17 languages."
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
              { n: '1', title: 'Write your script',     desc: 'Type or import in any of the 17 supported languages.' },
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
          <SHead title="17 supported" accent="languages" />
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
            desc="Stack voice clips, music, and SFX across independent lanes. Each lane has its own volume and mute control — a real mixing workspace, no plugins required.">
            <MockMultiLane />
          </FRow>
          <FRow icon={icons.scripts} reverse={true}
            title="Minimap navigation"
            desc="A full-width minimap above the timeline shows every clip at once. Click or drag to jump to any position — no more scrolling through long sessions blind.">
            <MockMinimap />
          </FRow>
          <FRow icon={icons.download} reverse={false}
            title="Precise clip editing"
            desc="Trim start and end by dragging handles. Split a clip at the cursor. Insert silence gaps to control pacing. Zoom from project-level to frame-level with the scroll wheel.">
            <MockClipEditor />
          </FRow>
          <FRow icon={icons.music} reverse={true}
            title="One-click export"
            desc="Mix the assembled timeline down to a single high-quality WAV with one click. Or export every clip individually as a ZIP archive — your choice.">
            <MockExport />
          </FRow>
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
        { val: '17', label: 'Languages'          },
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
