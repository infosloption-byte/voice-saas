import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { toast } from './toast'
import { icons, LANGUAGES, TONE_PRESETS, type TonePreset } from './constants'
import { loadAudioBlob, saveAudioBlob, deleteAudioBlob, historyReducer, fmt } from './audio'
import { useTTSEngine, type TTSEngine } from './hooks/useTTSEngine'
import { GUEST_WORD_LIMIT, GUEST_SYNTH_LIMIT, type GateType, type GuestUsage } from './hooks/useGuestSession'
import type { Project, Script, VoiceProfile, SaveState, EngineCaps } from './types'

const SCRIPT_TEMPLATES = [
  { id: 'blank',         label: 'Blank Script',    emoji: '📄', description: 'Start from scratch', title: 'Untitled Script', content: '' },
  { id: 'podcast-intro', label: 'Podcast Intro',   emoji: '🎙', description: '~30 second welcome hook', title: 'Podcast Intro',
    content: "Welcome back to [Podcast Name]! I'm your host [Name], and today we're diving into [Topic]. Whether you're a longtime listener or just joining us for the first time — you're in the right place. Let's get started." },
  { id: 'youtube-outro', label: 'YouTube Outro',   emoji: '▶️', description: 'Subscribe & engage CTA', title: 'YouTube Outro',
    content: "Thanks for watching! If you found this video helpful, please hit that like button and subscribe for more content like this. Drop your questions in the comments — I read every single one. See you in the next video!" },
  { id: 'product-demo',  label: 'Product Demo',    emoji: '🚀', description: 'Feature highlight script', title: 'Product Demo',
    content: "Today I want to show you [Product Name] — the easiest way to [solve problem]. In just [time], you'll be able to [key benefit]. Let me walk you through exactly how it works." },
  { id: 'ad-spot',       label: 'Ad Spot',         emoji: '📢', description: '15–30 second advertisement', title: 'Advertisement',
    content: "Tired of [problem]? Introducing [Product] — the solution that [main benefit]. Try it risk-free for [X] days. Visit [website] to get started today." },
  { id: 'news-report',   label: 'News Report',     emoji: '📰', description: 'Breaking news format', title: 'News Report',
    content: "Breaking: [Headline]. According to [Source], [details]. This comes after [context]. More information is expected to emerge in the coming hours. Stay tuned for updates." },
]

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL as string | undefined

function parseSpeakers(text: string): string[] {
  const matches = [...text.matchAll(/^\[SPEAKER:([^\]]+)\]/gim)]
  return [...new Set(matches.map(m => m[1].trim()))].filter(Boolean)
}

// ── Small engine badge shown in the footer ─────────────────────────
function EngineBadge({ engine }: { engine: TTSEngine }) {
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.5px',
      textTransform: 'uppercase' as const,
      padding: '2px 6px',
      borderRadius: 4,
      background: engine === 'f5' ? 'rgba(66,120,201,0.12)' : 'var(--accent-lt)',
      color: engine === 'f5' ? '#4278c9' : 'var(--accent)',
      border: engine === 'f5' ? '1px solid rgba(66,120,201,0.25)' : '1px solid var(--accent-mid)',
      flexShrink: 0,
    }}>
      {engine === 'f5' ? 'F5' : 'XTTS'}
    </span>
  )
}

export function WorkspacePage({
  project,
  activeScriptId,
  setActiveScriptId,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  onReorder,
  voiceProfiles,
  engineCaps = { xtts: true, f5: false },
  isGuest = false,
  guestUsage,
  getGuestVoiceBlob,
  onGuestGate,
  onGuestSynthesisUsed,
}: {
  project: Project
  activeScriptId: string | null
  setActiveScriptId: (id: string | null) => void
  onAddScript: (template?: { title?: string; content?: string }) => void
  onUpdateScript: (id: string, upd: Partial<Script>) => void
  onDeleteScript: (id: string) => void
  onReorder: (scripts: Script[]) => void
  voiceProfiles: VoiceProfile[]
  engineCaps?: EngineCaps
  isGuest?: boolean
  guestUsage?: GuestUsage
  getGuestVoiceBlob?: (profileId: string) => Promise<Blob | null>
  onGuestGate?: (type: GateType) => void
  onGuestSynthesisUsed?: () => void
}) {
  const activeScript = project.scripts.find(s => s.id === activeScriptId) ?? null

  const [histState, dispatch] = useReducer(
    historyReducer,
    { past: [], present: activeScript?.content ?? '', future: [] }
  )
  const [synthesizing, setSynthesizing]     = useState(false)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkProgress, setBulkProgress]     = useState(0)
  const [bulkTotal, setBulkTotal]           = useState(0)
  const [bulkErrors, setBulkErrors]         = useState<string[]>([])
  const [synthErr, setSynthErr]             = useState('')
  const [saveState, setSaveState]           = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl]             = useState<string | null>(null)
  const [showScriptList, setShowScriptList] = useState(true)
  const [transcribing, setTranscribing]     = useState(false)
  const [showEngineMenu, setShowEngineMenu] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [pendingTranscription, setPendingTranscription] = useState<string | null>(null)

  // TTS engine preference (persisted in localStorage)
  const { engine, setEngine } = useTTSEngine()

  const fileImportRef  = useRef<HTMLInputElement>(null)
  const audioUploadRef = useRef<HTMLInputElement>(null)
  const synthAbortRef  = useRef<AbortController | null>(null)
  const dragIdx        = useRef<number | null>(null)

  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768

  // Is the currently selected engine actually available on the server?
  const currentEngineAvailable = engine === 'f5' ? engineCaps.f5 : engineCaps.xtts

  // ── Reset editor when active script changes ───────────────────────
  useEffect(() => {
    const content = activeScript?.content ?? ''
    dispatch({ type: 'SET', value: content })
    setAudioUrl(null)
    setSynthErr('')

    if (activeScript?.hasAudio && activeScript.id) {
      loadAudioBlob(`audio_${activeScript.id}`).then(setAudioUrl)
    }
  }, [activeScriptId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save with debounce ───────────────────────────────────────
  useEffect(() => {
    if (!activeScript) return
    if (histState.present === activeScript.content) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    const timer = setTimeout(() => {
      onUpdateScript(activeScript.id, { content: histState.present })
      setSaveState('saved')
    }, 600)
    return () => clearTimeout(timer)
  }, [histState.present]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch({ type: 'UNDO' })
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault()
        dispatch({ type: 'REDO' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    return () => { synthAbortRef.current?.abort() }
  }, [])

  // ── Script list drag-to-reorder ───────────────────────────────────
  function onDragStart(i: number) { dragIdx.current = i }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...project.scripts]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    onReorder(next)
  }

  function onDragEnd() { dragIdx.current = null }

  function handleSelectScript(id: string) {
    setActiveScriptId(id)
    if (isMobile) setShowScriptList(false)
  }

  // ── Core synthesis helper ─────────────────────────────────────────
  const generateVoiceover = useCallback(
    async (
      script: Script,
      text: string,
      signal?: AbortSignal,
      ttsEngine: TTSEngine = 'xtts'
    ): Promise<boolean> => {
      if (!ENGINE_URL) {
        console.error('[WorkspacePage] VITE_ENGINE_URL is not set')
        return false
      }

      const pid = script.profileId || voiceProfiles[0]?.profile_id
      if (!pid || !text.trim()) return false

      const tone = (script.tone ?? 'natural') as TonePreset
      const toneParams = TONE_PRESETS[tone] ?? TONE_PRESETS.natural

      const fd = new FormData()
      fd.append('text',        text.trim())
      fd.append('profile_id',  pid)
      fd.append('language',    script.language || 'en')
      fd.append('speed',       String(Math.max(0.5, Math.min(2.0, script.speed ?? 1.0))))
      fd.append('tts_engine',  ttsEngine)
      // XTTS-specific knobs derived from tone preset (ignored by F5-TTS)
      fd.append('temperature', String(toneParams.temperature))
      fd.append('top_k',       String(toneParams.top_k))
      fd.append('top_p',       String(toneParams.top_p))
      fd.append('gap_ms',      '60')

      // Multi-voice speaker map (if script uses [SPEAKER:name] markers)
      if (script.speakerMap && Object.keys(script.speakerMap).length > 0) {
        fd.append('speaker_map', JSON.stringify(script.speakerMap))
      }

      try {
        const res = await fetch(`${ENGINE_URL}/synthesize`, {
          method: 'POST',
          body: fd,
          signal,
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          console.error(`[WorkspacePage] Synthesis HTTP ${res.status}:`, errData.detail ?? errData)
          return false
        }

        const blob = await res.blob()
        let duration: number | null = null
        let peaks: number[] | undefined

        try {
          const tempUrl  = URL.createObjectURL(blob)
          const audioCtx = new AudioContext()
          const arr      = await (await fetch(tempUrl)).arrayBuffer()
          const buf      = await audioCtx.decodeAudioData(arr)
          duration       = Math.round(buf.duration * 10) / 10

          const peakData  = buf.getChannelData(0)
          const numBars   = 60
          const blockSize = Math.floor(peakData.length / numBars)
          const rawPeaks: number[] = []
          for (let i = 0; i < numBars; i++) {
            let max = 0
            for (let j = 0; j < blockSize; j++) {
              const val = Math.abs(peakData[i * blockSize + j])
              if (val > max) max = val
            }
            rawPeaks.push(max)
          }
          const maxP = Math.max(...rawPeaks, 0.001)
          peaks = rawPeaks.map(p => p / maxP)

          await audioCtx.close()
          URL.revokeObjectURL(tempUrl)
        } catch {
          // Duration/peaks optional
        }

        await saveAudioBlob(`audio_${script.id}`, blob)
        onUpdateScript(script.id, {
          hasAudio:      true,
          profileId:     pid,
          language:      script.language || 'en',
          duration,
          waveformPeaks: peaks,
        })
        return true
      } catch (e) {
        if ((e as Error).name === 'AbortError') return false
        console.error('[WorkspacePage] generateVoiceover error:', e)
        return false
      }
    },
    [voiceProfiles, onUpdateScript]
  )

  // ── Guest synthesis (one-shot via /clone-voice, no engine profile needed) ──
  async function handleGuestGenerate() {
    if (!activeScript || !histState.present.trim()) {
      setSynthErr('Write some script content first.')
      return
    }
    if (!voiceProfiles.length) {
      setSynthErr('Record a voice profile first.')
      return
    }

    const wc = histState.present.trim().split(/\s+/).length
    if (wc > GUEST_WORD_LIMIT) {
      onGuestGate?.('word_limit')
      return
    }

    const used = guestUsage?.synthesesUsed ?? 0
    if (used >= GUEST_SYNTH_LIMIT) {
      onGuestGate?.('synth_limit')
      return
    }

    if (!ENGINE_URL) {
      setSynthErr('Engine URL is not configured. Check your .env file.')
      return
    }

    const profileId = activeScript.profileId || voiceProfiles[0]?.profile_id
    if (!profileId) { setSynthErr('No voice profile selected.'); return }

    const voiceBlob = await getGuestVoiceBlob?.(profileId)
    if (!voiceBlob) {
      setSynthErr('Voice profile audio not found. Please re-record your voice.')
      return
    }

    setSynthesizing(true)
    setSynthErr('')
    try {
      const fd = new FormData()
      fd.append('text', histState.present.trim())
      fd.append('file', voiceBlob, 'voice.wav')

      const res = await fetch(`${ENGINE_URL}/clone-voice`, { method: 'POST', body: fd })
      if (!res.ok) { setSynthErr('Synthesis failed. Is the AI engine running?'); return }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      setAudioUrl(url)
      onGuestSynthesisUsed?.()
    } catch {
      setSynthErr('Synthesis failed. Is the AI engine running?')
    } finally {
      setSynthesizing(false)
    }
  }

  // ── Single-script synthesis ───────────────────────────────────────
  async function handleGenerateSingle() {
    if (isGuest) { await handleGuestGenerate(); return }

    if (!activeScript || !histState.present.trim()) {
      setSynthErr('Write some script content first.')
      return
    }
    if (!voiceProfiles.length) {
      setSynthErr('No voice profile found. Record one in Voice Profiles.')
      return
    }
    if (!ENGINE_URL) {
      setSynthErr('Engine URL is not configured. Check your .env file.')
      return
    }
    // Guard: surface engine unavailability immediately rather than waiting for a 503
    if (!currentEngineAvailable) {
      setSynthErr(
        engine === 'f5'
          ? 'F5-TTS is not installed on this server. Switch to XTTS v2 or run: pip install f5-tts'
          : 'XTTS v2 is not available on this server.'
      )
      return
    }

    synthAbortRef.current?.abort()
    const controller = new AbortController()
    synthAbortRef.current = controller

    setSynthesizing(true)
    setSynthErr('')

    const ok = await generateVoiceover(
      activeScript,
      histState.present,
      controller.signal,
      engine
    )

    if (!ok && !controller.signal.aborted) {
      setSynthErr(
        engine === 'f5'
          ? 'F5-TTS synthesis failed. Is the engine running and f5-tts installed?'
          : 'Synthesis failed. Is the AI engine running?'
      )
    } else if (ok) {
      const url = await loadAudioBlob(`audio_${activeScript.id}`)
      setAudioUrl(url)
    }

    setSynthesizing(false)
  }

  // ── Bulk synthesis ────────────────────────────────────────────────
  async function handleBulkGenerate() {
    const pending = project.scripts.filter(s => s.content.trim() && !s.hasAudio)
    if (!pending.length) { toast.info('All scripts already have audio.'); return }
    if (!voiceProfiles.length) { toast.err('No voice profile found. Record one in Voice Profiles first.'); return }
    if (!ENGINE_URL) { toast.err('Engine URL is not configured. Check your .env file.'); return }
    if (!currentEngineAvailable) {
      toast.err(
        engine === 'f5'
          ? 'F5-TTS is not installed on this server. Switch to XTTS v2 in the engine selector.'
          : 'XTTS v2 is not available on this server.'
      )
      return
    }

    synthAbortRef.current?.abort()
    const controller = new AbortController()
    synthAbortRef.current = controller

    setBulkGenerating(true)
    setBulkTotal(pending.length)
    setBulkProgress(0)
    setBulkErrors([])

    for (const script of pending) {
      if (controller.signal.aborted) break
      const ok = await generateVoiceover(script, script.content, controller.signal, engine)
      if (!ok && !controller.signal.aborted) {
        setBulkErrors(prev => [...prev, script.title])
      }
      setBulkProgress(p => p + 1)
    }

    setBulkGenerating(false)
    setBulkTotal(0)
    setBulkProgress(0)
  }

  // ── Audio transcription ───────────────────────────────────────────
  async function handleAudioTranscribe(file: File) {
    if (!ENGINE_URL) { toast.err('Engine URL is not configured. Check your .env file.'); return }

    setTranscribing(true)
    const fd = new FormData()
    fd.append('file', file, file.name)
    try {
      const res = await fetch(`${ENGINE_URL}/transcribe`, { method: 'POST', body: fd })
      if (!res.ok) { toast.err('Transcription failed. Is the AI engine running?'); return }
      const data = await res.json() as { text?: string }
      const text = data.text ?? ''
      if (activeScript) {
        setPendingTranscription(text)
      } else {
        onAddScript({ title: 'Transcribed Script', content: text })
      }
    } catch {
      toast.err('Connection error. Is the AI engine running?')
    } finally {
      setTranscribing(false)
    }
  }

  // ── Text file import ──────────────────────────────────────────────
  async function handleFileImport(file: File) {
    const text       = await file.text()
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

    if (paragraphs.length <= 1) {
      if (activeScript) dispatch({ type: 'SET', value: text.trim() })
    } else {
      const confirmed = confirm(
        `Found ${paragraphs.length} paragraphs. Import first paragraph into this script?`
      )
      if (confirmed && activeScript) {
        dispatch({ type: 'SET', value: paragraphs[0] })
      }
    }
  }

  // ── Derived values ────────────────────────────────────────────────
  const wordCount = histState.present.trim()
    ? histState.present.trim().split(/\s+/).length
    : 0

  const pendingCount = project.scripts.filter(
    s => s.content.trim() && !s.hasAudio
  ).length

  // ── Engine switcher dropdown ──────────────────────────────────────
  const EngineSelector = () => (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => setShowEngineMenu(v => !v)}
        title="Switch TTS engine"
        style={{ gap: 5, paddingRight: 8 }}
      >
        <EngineBadge engine={engine} />
        {/* Warning dot when selected engine is unavailable */}
        {!currentEngineAvailable && (
          <span
            title={`${engine === 'f5' ? 'F5-TTS' : 'XTTS v2'} is not available on this server`}
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'var(--warn)', flexShrink: 0,
              boxShadow: '0 0 0 2px var(--warn-lt)',
            }}
          />
        )}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
          style={{ width: 10, height: 10, opacity: 0.5 }}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {showEngineMenu && (
        <>
          {/* click-away overlay */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setShowEngineMenu(false)}
          />
          <div style={{
            position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
            background: 'var(--surface)', border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
            zIndex: 200, minWidth: 230, overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>
              TTS Engine
            </div>

            {([
              {
                id: 'xtts' as TTSEngine,
                label: 'XTTS v2',
                desc: '16 languages · multilingual · fast',
                color: 'var(--accent)',
                available: engineCaps.xtts,
              },
              {
                id: 'f5' as TTSEngine,
                label: 'F5-TTS',
                desc: 'Flow-matching · natural prosody · English-first',
                color: '#4278c9',
                available: engineCaps.f5,
              },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => { setEngine(opt.id); setShowEngineMenu(false) }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: engine === opt.id ? `${opt.color}10` : 'transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                  borderLeft: engine === opt.id ? `3px solid ${opt.color}` : '3px solid transparent',
                  opacity: opt.available ? 1 : 0.55,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {opt.label}
                    {engine === opt.id && (
                      <span style={{ width: 14, height: 14, color: opt.color }}>{icons.check}</span>
                    )}
                    {/* Availability pill */}
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                      background: opt.available ? 'var(--ok-lt)' : 'var(--warn-lt)',
                      color: opt.available ? 'var(--ok)' : 'var(--warn)',
                      border: `1px solid ${opt.available ? 'rgba(59,125,99,0.25)' : 'rgba(160,117,48,0.25)'}`,
                      letterSpacing: '0.3px',
                    }}>
                      {opt.available ? 'Ready' : 'Not installed'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                    {opt.desc}
                  </div>
                </div>
              </button>
            ))}

            <div style={{
              padding: '6px 12px 8px', fontSize: 11, color: 'var(--text-3)',
              borderTop: '1px solid var(--border)', lineHeight: 1.5, marginTop: 2,
            }}>
              Applies to all future generations in this session.
            </div>
          </div>
        </>
      )}
    </div>
  )

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="workspace">
      {/* Script template modal */}
      {showTemplateModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowTemplateModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal__title">New Script</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>Choose a template or start blank.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {SCRIPT_TEMPLATES.map(tpl => (
                <button key={tpl.id} onClick={() => {
                  onAddScript({ title: tpl.title, content: tpl.content })
                  setShowTemplateModal(false)
                }} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-2)')}>
                  <span style={{ fontSize: 18 }}>{tpl.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{tpl.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{tpl.description}</span>
                </button>
              ))}
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setShowTemplateModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Transcription choice modal */}
      {pendingTranscription !== null && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setPendingTranscription(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal__title">Transcription Complete</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>What would you like to do with the transcribed text?</p>
            <div style={{ padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 6, fontSize: 12, color: 'var(--text-2)', maxHeight: 120, overflowY: 'auto', lineHeight: 1.6, marginBottom: 14, fontStyle: 'italic' }}>
              "{pendingTranscription.slice(0, 200)}{pendingTranscription.length > 200 ? '…' : ''}"
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setPendingTranscription(null)}>Cancel</button>
              <button className="btn" onClick={() => {
                onAddScript({ title: 'Transcribed Script', content: pendingTranscription })
                setPendingTranscription(null)
              }}>
                {icons.newScript} New Script
              </button>
              <button className="btn btn--primary" onClick={() => {
                if (activeScript) dispatch({ type: 'SET', value: pendingTranscription })
                setPendingTranscription(null)
              }} disabled={!activeScript}>
                {icons.check} Replace Current
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Script list panel ── */}
      <div className={`script-panel ${!showScriptList ? 'script-panel--hidden' : ''}`}>
        <div className="script-panel__head">
          <h3>
            Scripts{' '}
            <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
              ({project.scripts.length})
            </span>
          </h3>

          <div style={{ display: 'flex', gap: 4 }}>
            {pendingCount > 0 && !bulkGenerating && (
              <button
                className="btn btn--sm"
                onClick={handleBulkGenerate}
                title={`Generate all ${pendingCount} pending scripts`}
                style={{
                  background:   'var(--accent-lt)',
                  color:        'var(--accent)',
                  border:       '1px solid var(--accent-mid)',
                }}
              >
                {icons.bolt}
              </button>
            )}
            {bulkGenerating && (
              <span style={{
                fontSize: 11, color: 'var(--accent)',
                display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px',
              }}>
                <span className="spinner" />{bulkProgress}/{bulkTotal}
              </span>
            )}
            <button className="btn btn--sm btn--primary" onClick={() => setShowTemplateModal(true)} title="New script">
              {icons.plus}
            </button>
          </div>
        </div>

        <div className="script-list">
          {project.scripts.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 12px' }}>
              {icons.edit}
              <p>No scripts yet</p>
              <button className="btn btn--sm btn--primary" onClick={() => onAddScript()}>
                Add Script
              </button>
            </div>
          ) : (
            project.scripts.map((s, i) => (
              <div
                key={s.id}
                className={`script-item ${s.id === activeScriptId ? 'script-item--active' : ''}`}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={e => onDragOver(e, i)}
                onDragEnd={onDragEnd}
                onClick={() => handleSelectScript(s.id)}
              >
                <div className="script-item__drag" style={{ cursor: 'grab' }}>
                  {icons.drag}
                </div>
                <div className="script-item__num">{i + 1}</div>
                <div className="script-item__body">
                  <div className="script-item__title">{s.title}</div>
                  <div className="script-item__meta">
                    {s.content
                      ? `${s.content.trim().split(/\s+/).length} words`
                      : 'Empty'}
                    {s.duration ? ` · ${fmt(s.duration)}` : ''}
                  </div>
                </div>
                <span
                  className={[
                    'script-item__status',
                    s.hasAudio
                      ? 'script-item__status--done'
                      : s.content
                        ? 'script-item__status--pending'
                        : 'script-item__status--none',
                  ].join(' ')}
                />
              </div>
            ))
          )}
        </div>

        {/* Bulk generate footer */}
        {pendingCount > 0 && (
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              className="btn btn--sm"
              style={{
                width:          '100%',
                justifyContent: 'center',
                background:     bulkGenerating ? 'var(--bg-3)' : 'var(--accent-lt)',
                color:          bulkGenerating ? 'var(--text-3)' : 'var(--accent)',
                border:         '1px solid var(--accent-mid)',
              }}
              onClick={handleBulkGenerate}
              disabled={bulkGenerating}
            >
              {bulkGenerating ? (
                <><span className="spinner" /> Generating {bulkProgress}/{bulkTotal}</>
              ) : (
                <>{icons.bolt} Generate All ({pendingCount})</>
              )}
            </button>

            {!bulkGenerating && bulkErrors.length > 0 && (
              <div className="msg msg--err" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}>
                {engine === 'f5' && !engineCaps.f5
                  ? 'F5-TTS not installed — '
                  : ''}
                Failed: {bulkErrors.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Editor panel ── */}
      <div
        className={`editor-panel ${
          showScriptList && !activeScript ? 'editor-panel--hidden-mobile' : ''
        }`}
      >
        {!activeScript ? (
          <div className="empty-state">
            {icons.edit}
            <p>Select a script or create a new one</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="editor-toolbar">
              <button
                className="btn btn--ghost btn--sm editor-back"
                onClick={() => setShowScriptList(true)}
              >
                {icons.back}
              </button>

              <input
                className="text-input editor-title"
                value={activeScript.title}
                onChange={e => onUpdateScript(activeScript.id, { title: e.target.value })}
                placeholder="Script title"
              />

              <div className="undo-redo">
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => dispatch({ type: 'UNDO' })}
                  disabled={!histState.past.length}
                  title="Undo (Ctrl+Z)"
                >
                  {icons.undo}
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => dispatch({ type: 'REDO' })}
                  disabled={!histState.future.length}
                  title="Redo (Ctrl+Y)"
                >
                  {icons.redo}
                </button>
              </div>

              <button
                className="btn btn--sm btn--ghost"
                onClick={() => fileImportRef.current?.click()}
                title="Import .txt file"
              >
                {icons.upload}
              </button>

              <button
                className="btn btn--sm btn--ghost"
                onClick={() => audioUploadRef.current?.click()}
                disabled={transcribing}
                title="Upload audio → transcribe to script"
              >
                {transcribing ? <span className="spinner" /> : icons.mic}
              </button>

              {/* Hidden file inputs */}
              <input
                ref={fileImportRef}
                type="file"
                accept=".txt,.md"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFileImport(f)
                  e.target.value = ''
                }}
              />
              <input
                ref={audioUploadRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleAudioTranscribe(f)
                  e.target.value = ''
                }}
              />

              {/* Save indicator */}
              <span style={{
                fontSize: 11,
                color: saveState === 'saved' ? 'var(--ok)' : 'var(--text-3)',
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                {saveState === 'saving' ? (
                  <span className="spinner" />
                ) : saveState === 'saved' ? (
                  icons.check
                ) : null}
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
              </span>

              <button
                className="btn btn--sm btn--danger"
                onClick={() => {
                  if (confirm(`Delete script "${activeScript.title}"?`)) {
                    onDeleteScript(activeScript.id)
                    setShowScriptList(true)
                  }
                }}
                title="Delete script"
              >
                {icons.trash}
              </button>
            </div>

            {/* Script textarea */}
            <div className="editor-body">
              <textarea
                className="script-textarea"
                value={histState.present}
                onChange={e => dispatch({ type: 'SET', value: e.target.value })}
                placeholder="Write your script here… or use the mic button to transcribe audio."
              />
            </div>

            {/* Engine-unavailable warning banner */}
            {!currentEngineAvailable && (
              <div className="msg msg--warn" style={{ margin: '8px 14px 0' }}>
                {engine === 'f5'
                  ? 'F5-TTS is not installed on this server. Switch to XTTS v2 or run: pip install f5-tts'
                  : 'XTTS v2 is not available on this server.'}
              </div>
            )}

            {/* Synthesis error */}
            {synthErr && (
              <div className="msg msg--err" style={{ margin: '8px 14px 0' }}>
                {synthErr}
              </div>
            )}

            {/* Audio playback row */}
            {audioUrl && (
              <div className="vo-audio-row">
                <span className="vo-ready-label">✓ Ready</span>
                <audio src={audioUrl} controls />
                {isGuest ? (
                  <button
                    className="btn btn--sm"
                    title="Subscribe to download"
                    onClick={() => onGuestGate?.('download')}
                  >
                    {icons.download}
                  </button>
                ) : (
                  <a
                    href={audioUrl}
                    download={`${activeScript.title}.wav`}
                    className="btn btn--sm"
                  >
                    {icons.download}
                  </a>
                )}
                <button
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    deleteAudioBlob(`audio_${activeScript.id}`)
                    onUpdateScript(activeScript.id, { hasAudio: false, duration: null })
                    setAudioUrl(null)
                  }}
                  title="Remove audio"
                >
                  {icons.trash}
                </button>
              </div>
            )}

            {/* Multi-voice speaker mapping panel */}
            {(() => {
              const speakers = parseSpeakers(histState.present)
              if (!speakers.length || !voiceProfiles.length) return null
              return (
                <div style={{ margin: '0 14px 0', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', flexShrink: 0 }}>👥 Multi-voice:</span>
                  {speakers.map(spk => {
                    const currentId = activeScript.speakerMap?.[spk] ?? voiceProfiles[0]?.profile_id ?? ''
                    return (
                      <div key={spk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)', background: 'var(--accent-lt)', padding: '1px 6px', borderRadius: 4 }}>{spk}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>→</span>
                        <select className="profile-select" style={{ fontSize: 11, padding: '2px 4px' }}
                          value={currentId}
                          onChange={e => {
                            const newMap = { ...(activeScript.speakerMap ?? {}), [spk]: e.target.value }
                            onUpdateScript(activeScript.id, { speakerMap: newMap })
                          }}>
                          {voiceProfiles.map(vp => (
                            <option key={vp.profile_id} value={vp.profile_id}>{vp.profile_id}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Footer controls */}
            <div className="editor-footer">
              <span className="word-count">
                {wordCount} words · ~{Math.ceil(wordCount / 130)}m
                {isGuest && (
                  <span style={{
                    marginLeft: 6,
                    color: wordCount > GUEST_WORD_LIMIT ? 'var(--err)' : 'var(--text-3)',
                    fontSize: 10,
                  }}>
                    ({wordCount}/{GUEST_WORD_LIMIT} guest limit)
                  </span>
                )}
              </span>

              <div style={{ flex: 1 }} />

              {/* Tone preset (XTTS only) */}
              {engine !== 'f5' && (
                <div style={{ display: 'flex', gap: 2 }}>
                  {(Object.entries(TONE_PRESETS) as [TonePreset, typeof TONE_PRESETS[TonePreset]][]).map(([key, preset]) => {
                    const active = (activeScript.tone ?? 'natural') === key
                    return (
                      <button key={key} title={preset.label}
                        onClick={() => onUpdateScript(activeScript.id, { tone: key })}
                        style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${active ? 'var(--accent)' : 'var(--border-2)'}`, background: active ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: active ? 'var(--accent)' : 'var(--text-3)' }}
                        aria-pressed={active}>
                        {preset.emoji}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Speed */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                  Speed
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={activeScript.speed ?? 1.0}
                  onChange={e =>
                    onUpdateScript(activeScript.id, { speed: parseFloat(e.target.value) })
                  }
                  style={{ width: 60, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)', width: 28 }}>
                  {(activeScript.speed ?? 1.0).toFixed(1)}x
                </span>
              </div>

              {/*
                Language — disabled for F5-TTS (English-first; the backend accepts
                the field but ignores it, so we surface that clearly in the UI).
              */}
              <select
                className="profile-select"
                value={activeScript.language || 'en'}
                onChange={e => onUpdateScript(activeScript.id, { language: e.target.value })}
                disabled={engine === 'f5'}
                title={
                  engine === 'f5'
                    ? 'Language selection is only used by XTTS v2. F5-TTS is English-first.'
                    : 'Language'
                }
                style={{ opacity: engine === 'f5' ? 0.45 : 1 }}
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>

              {/* Voice profile */}
              {voiceProfiles.length > 0 && (
                <select
                  className="profile-select"
                  value={activeScript.profileId ?? voiceProfiles[0]?.profile_id ?? ''}
                  onChange={e => onUpdateScript(activeScript.id, { profileId: e.target.value })}
                >
                  {voiceProfiles.map(vp => (
                    <option key={vp.profile_id} value={vp.profile_id}>{vp.profile_id}</option>
                  ))}
                </select>
              )}

              {/* Engine switcher */}
              <EngineSelector />

              {/* Generate button */}
              <button
                className="btn btn--primary btn--sm"
                onClick={handleGenerateSingle}
                disabled={synthesizing || !histState.present.trim()}
              >
                {synthesizing ? (
                  <><span className="spinner" /> Generating…</>
                ) : (
                  <>{icons.play} Generate</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}