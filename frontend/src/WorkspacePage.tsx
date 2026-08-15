import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { api, ApiError } from './api'
import { toast } from './toast'
import { activityLog } from './activityLog'
import { icons, LANGUAGES, TONE_PRESETS, BUILT_IN_VOICES, type TonePreset } from './constants'
import { loadAudioBlob, saveAudioBlob, deleteAudioBlob, historyReducer, fmt, trimSilence, enhanceAudio, audioBufferToWav } from './audio'
import { useTTSEngine, type TTSEngine } from './hooks/useTTSEngine'
import { useEscapeKey } from './hooks/useEscapeKey'
import { type GateType, type GuestUsage } from './hooks/useGuestSession'
import { DEFAULT_GUEST_LIMITS } from './hooks/useGuestLimits'
import type { Project, Script, VoiceProfile, SaveState, EngineCaps, GuestLimits } from './types'

// ── Voice preview hook ────────────────────────────────────────────
// Manages a single shared audio instance so only one voice plays at a time.
function useVoicePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobCache = useRef<Map<string, string>>(new Map())

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
  }, [])

  const toggle = useCallback(async (id: string, url: string) => {
    if (playingId === id) { stop(); return }
    stop()
    setLoadingId(id)
    try {
      let objUrl = blobCache.current.get(id)
      if (!objUrl) {
        const blob = await api.engineFetchBlob(url)
        objUrl = URL.createObjectURL(blob)
        blobCache.current.set(id, objUrl)
      }
      const audio = new Audio(objUrl)
      audioRef.current = audio
      audio.onended = () => setPlayingId(null)
      audio.onerror = () => setPlayingId(null)
      await audio.play()
      setPlayingId(id)
    } catch {
      setPlayingId(null)
    } finally {
      setLoadingId(null)
    }
  }, [playingId, stop])

  useEffect(() => () => { audioRef.current?.pause() }, [])

  return { playingId, loadingId, toggle, stop }
}

// ── Small play/pause button used inside the voice picker ──────────
function VoicePlayBtn({
  id, playingId, loadingId, toggle, url,
}: {
  id: string; playingId: string | null; loadingId: string | null
  toggle: (id: string, url: string) => void; url: string
}) {
  const isPlaying = playingId === id
  const isLoading = loadingId === id
  return (
    <button
      onClick={e => { e.stopPropagation(); toggle(id, url) }}
      title={isPlaying ? 'Stop preview' : 'Preview voice'}
      style={{
        width: 24, height: 24, borderRadius: '50%', border: 'none',
        flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isPlaying ? 'var(--accent)' : 'var(--accent-lt)',
        color: isPlaying ? '#fff' : 'var(--accent)',
        transition: 'all 0.15s',
        marginLeft: 'auto',
      }}
    >
      {isLoading
        ? <span style={{ width: 10, height: 10, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
        : isPlaying
          ? <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><rect x="0" y="0" width="2.5" height="10" rx="1"/><rect x="5.5" y="0" width="2.5" height="10" rx="1"/></svg>
          : <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><path d="M0 0 L8 5 L0 10 Z"/></svg>
      }
    </button>
  )
}

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

// Splits text into ~150-word sentence-aligned chunks for chunked synthesis.
function splitIntoChunks(text: string, maxWords = 150): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? current + ' ' + sentence.trim() : sentence.trim()
    if (candidate.split(/\s+/).length > maxWords && current) {
      chunks.push(current.trim())
      current = sentence.trim()
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

// Concatenates multiple WAV blobs into a single WAV blob.
async function concatAudioBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0]
  const ctx = new AudioContext()
  const buffers: AudioBuffer[] = []
  for (const b of blobs) {
    buffers.push(await ctx.decodeAudioData(await b.arrayBuffer()))
  }
  await ctx.close()
  const sr          = buffers[0].sampleRate
  const totalLen    = buffers.reduce((s, b) => s + b.length, 0)
  const out         = new AudioContext().createBuffer(1, totalLen, sr)
  const outData     = out.getChannelData(0)
  let offset = 0
  for (const buf of buffers) {
    outData.set(buf.getChannelData(0), offset)
    offset += buf.length
  }
  return new Blob([audioBufferToWav(out)], { type: 'audio/wav' })
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

// ── Upgrade popup shown when the synthesis quota is exhausted ──────
const UPGRADE_PLANS = [
  {
    id: 'starter', name: 'Starter', price: '$9', period: '/month',
    tagline: 'For individuals getting started', featured: false,
    features: ['150 voice syntheses / month', '50 translations / month', '3 voice profiles', '10 projects', 'Up to 5,000 words per script', 'Multi-voice & timeline assembly'],
  },
  {
    id: 'creator', name: 'Creator', price: '$29', period: '/month',
    tagline: 'For creators & podcasters', featured: true,
    features: ['600 voice syntheses / month', '200 translations / month', '10 voice profiles', 'Unlimited projects', 'No word limit per script', 'Priority synthesis queue'],
  },
  {
    id: 'pro', name: 'Pro', price: '$79', period: '/month',
    tagline: 'For power users & studios', featured: false,
    features: ['2,000 voice syntheses / month', 'Unlimited translations', '25 voice profiles', 'Data export (GDPR)', 'Priority synthesis queue'],
  },
]

function UpgradeQuotaModal({ quota, onClose, onGoPricing }: {
  quota: { limit: number; period: string } | null
  onClose: () => void
  onGoPricing?: () => void
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Upgrade your plan" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{
            width: 46, height: 46, borderRadius: '50%', margin: '0 auto 10px',
            background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" style={{ width: 22, height: 22 }}>
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="modal__title" style={{ marginBottom: 4 }}>You've used today's free syntheses</div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, lineHeight: 1.5 }}>
            {quota && quota.limit > 0
              ? <>Your plan includes <strong>{quota.limit} syntheses per {quota.period}</strong>. Upgrade to keep generating without waiting.</>
              : 'Upgrade your plan to keep generating voiceovers without waiting.'}
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {UPGRADE_PLANS.map(plan => (
            <div key={plan.id} style={{
              border: plan.featured ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
              borderRadius: 10, padding: '14px 14px 12px', position: 'relative',
              background: plan.featured ? 'var(--accent-lt)' : 'var(--bg-2)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {plan.featured && (
                <span style={{
                  position: 'absolute', top: -9, right: 12, fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', padding: '2px 8px',
                  borderRadius: 99, background: 'var(--accent)', color: '#fff',
                }}>Best value</span>
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{plan.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: plan.featured ? 'var(--accent)' : 'var(--text-1)' }}>{plan.price}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{plan.period}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{plan.tagline}</div>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                {plan.features.map(f => (
                  <li key={f} style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.4 }}>
                    <svg viewBox="0 0 10 10" fill="none" stroke="var(--ok)" strokeWidth="2" style={{ width: 9, height: 9, flexShrink: 0, marginTop: 3 }}>
                      <path d="M1.5 5.5l2.5 2.5 4.5-5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`btn btn--sm ${plan.featured ? 'btn--primary' : ''}`}
                style={{ width: '100%', justifyContent: 'center', marginTop: 2 }}
                onClick={() => { onClose(); onGoPricing?.() }}
              >
                Upgrade to {plan.name}
              </button>
            </div>
          ))}
        </div>

        <div className="modal__actions" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Maybe later</button>
        </div>
      </div>
    </div>
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
  guestLimits = DEFAULT_GUEST_LIMITS,
  getGuestVoiceBlob,
  onGuestGate,
  onGuestSynthesisUsed,
  onRecheckEngine,
  onUploadAudio,
  onGoPricing,
  onRemoveScriptClips,
  openTemplateNonce = 0,
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
  guestLimits?: GuestLimits
  getGuestVoiceBlob?: (profileId: string) => Promise<Blob | null>
  onGuestGate?: (type: GateType) => void
  onGuestSynthesisUsed?: () => void
  onRecheckEngine?: () => void
  onUploadAudio?: (scriptId: string, blob: Blob) => Promise<void>
  onGoPricing?: () => void
  /** Remove this script's clips from the assembly timeline (called before delete). */
  onRemoveScriptClips?: (scriptId: string) => void
  /** Bump this counter from the parent to open the New Script template modal. */
  openTemplateNonce?: number
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
  const [bulkActiveId, setBulkActiveId]     = useState<string | null>(null)
  const [synthErr, setSynthErr]             = useState('')
  const [saveState, setSaveState]           = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl]             = useState<string | null>(null)
  // Track the current object URL so we can revoke the previous one whenever it
  // changes (and on unmount) — prevents WAV blobs leaking into memory.
  const audioUrlRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = audioUrlRef.current
    if (prev && prev !== audioUrl) URL.revokeObjectURL(prev)
    audioUrlRef.current = audioUrl
  }, [audioUrl])
  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current) }, [])
  const [showScriptList, setShowScriptList] = useState(true)
  const [transcribing, setTranscribing]     = useState(false)
  const [showEngineMenu,   setShowEngineMenu]   = useState(false)
  const [showLangMenu,     setShowLangMenu]     = useState(false)
  const [showToneMenu,     setShowToneMenu]     = useState(false)
  const [showVoiceMenu,    setShowVoiceMenu]    = useState(false)
  const voicePreview = useVoicePreview()
  const [showTranslateMenu, setShowTranslateMenu] = useState(false)
  const [translateTarget, setTranslateTarget]   = useState('es')
  const [showAdvanced,     setShowAdvanced]     = useState(false)
  const [synthQuota, setSynthQuota]             = useState<{ remaining: number; limit: number; period: string } | null>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [pendingTranscription, setPendingTranscription] = useState<string | null>(null)
  const [importParagraphs, setImportParagraphs] = useState<string[] | null>(null)
  const [deleteScriptId, setDeleteScriptId]     = useState<string | null>(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [translating, setTranslating]           = useState(false)

  // Escape closes whichever modal is open — highest-priority one wins
  useEscapeKey(() => {
    if (showUpgradeModal)            { setShowUpgradeModal(false);    return }
    if (deleteScriptId)              { setDeleteScriptId(null);       return }
    if (importParagraphs)            { setImportParagraphs(null);     return }
    if (pendingTranscription !== null){ setPendingTranscription(null);return }
    if (showTemplateModal)           { setShowTemplateModal(false);   return }
    if (showTranslateMenu)           { setShowTranslateMenu(false);   return }
  })

  // Parent (topbar "+ Script" button) requests the template modal
  useEffect(() => {
    if (openTemplateNonce > 0) setShowTemplateModal(true)
  }, [openTemplateNonce])

  // TTS engine preference (persisted in localStorage)
  const { engine, setEngine } = useTTSEngine()

  const fileImportRef       = useRef<HTMLInputElement>(null)
  const audioUploadRef      = useRef<HTMLInputElement>(null)
  const synthAbortRef       = useRef<AbortController | null>(null)
  const dragIdx             = useRef<number | null>(null)
  const onRecheckEngineRef  = useRef(onRecheckEngine)
  onRecheckEngineRef.current = onRecheckEngine

  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768

  // Is the currently selected engine actually available on the server?
  const currentEngineAvailable = engine === 'f5' ? engineCaps.f5 : engineCaps.xtts

  // If a saved F5 preference can't run here (e.g. CPU-only server), fall back
  // to XTTS automatically so the user isn't stuck on an unusable engine.
  useEffect(() => {
    if (engine === 'f5' && engineCaps.f5 === false && engineCaps.xtts) {
      setEngine('xtts')
    }
  }, [engine, engineCaps.f5, engineCaps.xtts, setEngine])

  // ── Reset editor when active script changes ───────────────────────
  useEffect(() => {
    const content = activeScript?.content ?? ''
    dispatch({ type: 'SET', value: content })
    setAudioUrl(null)
    setSynthErr('')

    if (activeScript?.hasAudio && activeScript.id) {
      const sid = activeScript.id
      const audioUrl = activeScript.audioUrl
      loadAudioBlob(`audio_${sid}`).then(async url => {
        if (url) {
          setAudioUrl(url)
        } else if (audioUrl) {
          // Not in IndexedDB — try to restore from the server (multi-device sync)
          try {
            const blob = await api.get(`/scripts/${sid}/audio`) as Blob
            if (blob instanceof Blob && blob.size > 0) {
              await saveAudioBlob(`audio_${sid}`, blob)
              const restored = await loadAudioBlob(`audio_${sid}`)
              if (restored) { setAudioUrl(restored); return }
              console.error(`[WorkspacePage] saveAudioBlob/loadAudioBlob round-trip failed for script ${sid}`)
            } else {
              console.error(`[WorkspacePage] GET /scripts/${sid}/audio returned an empty/non-blob response`, blob)
            }
          } catch (e) {
            // This used to be a bare `catch {}` — the exact failure (404 vs
            // network/CORS error) was thrown away, which is why "hasAudio"
            // kept flipping back to false for reasons nobody could diagnose.
            const is404 = e instanceof ApiError && e.status === 404
            console.error(
              `[WorkspacePage] server audio restore failed for script ${sid} ` +
              `(hasAudio was true, audioUrl="${audioUrl}"). ` +
              (is404
                ? 'Server returned 404 — the file is genuinely missing/unreadable ' +
                  '(check storage disk config / S3 permissions / whether Storage::exists() ' +
                  'can actually read the key that was written).'
                : 'Non-404 error — likely a network/CORS failure fetching the audio ' +
                  '(check Network tab: does the request redirect to S3, and does that ' +
                  'redirected request fail with a CORS error in the console?).'),
              e,
            )
            if (!is404) {
              // Don't destroy a perfectly good has_audio=true record just because
              // of a transient network/CORS hiccup — only a confirmed 404 means
              // the file is actually gone.
              setSynthErr('Could not load audio right now (network error). Your generated audio is still saved — try again.')
              return
            }
          }
          onUpdateScript(sid, { hasAudio: false, duration: null, waveformPeaks: undefined })
          setSynthErr('Audio could not be loaded from the server. Please regenerate.')
        } else {
          // No server backup either — clear the stale flag
          onUpdateScript(sid, { hasAudio: false, duration: null, waveformPeaks: undefined })
          setSynthErr('Audio was lost (storage cleared). Please regenerate.')
        }
      })
    }
  }, [activeScriptId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save with debounce ───────────────────────────────────────
  // Keep an abort ref so a new save cancels any still-in-flight request
  // (prevents last-write-wins races on slow connections).
  const saveAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!activeScript) return
    if (histState.present === activeScript.content) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    const timer = setTimeout(() => {
      saveAbortRef.current?.abort()
      saveAbortRef.current = new AbortController()
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

      // Determine if the selected profile is a built-in XTTS library voice
      const selectedId = script.profileId || voiceProfiles[0]?.profile_id || ''
      const isBuiltin  = selectedId.startsWith('builtin:')
      const profile    = isBuiltin ? null : (voiceProfiles.find(vp => vp.profile_id === selectedId) ?? voiceProfiles[0])
      const pid        = isBuiltin ? selectedId : profile?.profile_id
      const engineKey  = isBuiltin ? selectedId : (profile?.engine_key ?? profile?.profile_id ?? '')
      if (!pid || !text.trim()) return false

      const tone = (script.tone ?? 'natural') as TonePreset
      const toneParams = TONE_PRESETS[tone] ?? TONE_PRESETS.natural
      // advancedParams override preset values if the user has manually set them
      const adv = script.advancedParams ?? {}
      const temperature = adv.temperature ?? toneParams.temperature
      const top_k       = adv.top_k       ?? toneParams.top_k
      const top_p       = adv.top_p       ?? toneParams.top_p

      // F5 has no temperature/top_k; the same tone maps to F5's own knobs.
      // Pace folds the tone's pace into the user's speed setting.
      const userSpeed = Math.max(0.5, Math.min(2.0, script.speed ?? 1.0))
      const f5Speed   = Math.max(0.5, Math.min(2.0, userSpeed * (toneParams.f5_pace ?? 1.0)))

      // One id per generate action; the backend records quota once per batch
      // so a chunked synthesis (many submits) only counts as a single use.
      const batchId = (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.()
        ?? `b_${Date.now()}_${Math.random().toString(36).slice(2)}`

      const fd = new FormData()
      fd.append('text',        text.trim())
      fd.append('batch_id',    batchId)
      fd.append('profile_id',  engineKey)
      fd.append('language',    script.language || 'en')
      fd.append('speed',       String(ttsEngine === 'f5' ? f5Speed : userSpeed))
      fd.append('tts_engine',  ttsEngine)
      // XTTS-specific knobs (ignored by F5-TTS)
      fd.append('temperature', String(temperature))
      fd.append('top_k',       String(top_k))
      fd.append('top_p',       String(top_p))
      fd.append('gap_ms',      '60')
      // F5-specific tone knobs (ignored by XTTS)
      fd.append('cfg_strength',       String(toneParams.cfg_strength ?? 2.0))
      fd.append('target_rms',         String(toneParams.f5_rms ?? 0.1))
      fd.append('sway_sampling_coef', String(toneParams.f5_sway ?? -1.0))
      // Reduces word/phrase repetition loops in XTTS output
      if (ttsEngine === 'xtts') fd.append('repetition_penalty', '5.0')

      // Multi-voice speaker map — resolve profile_ids to engine_keys before sending
      if (script.speakerMap && Object.keys(script.speakerMap).length > 0) {
        const engineMap: Record<string, string> = {}
        for (const [spk, spkPid] of Object.entries(script.speakerMap)) {
          const spkProfile = voiceProfiles.find(vp => vp.profile_id === spkPid)
          engineMap[spk] = spkProfile?.engine_key ?? spkPid
        }
        fd.append('speaker_map', JSON.stringify(engineMap))
      }

      // ── Sentence-chunk synthesis (single-voice scripts only) ────────
      const isMultiVoice = script.speakerMap && Object.keys(script.speakerMap).length > 0
      const words        = text.trim().split(/\s+/).length
      const useChunking  = !isMultiVoice && words > 150

      const synthesizeText = async (chunkText: string): Promise<Blob> => {
        const chunkFd = new FormData()
        chunkFd.append('text',        chunkText)
        chunkFd.append('batch_id',    batchId)
        chunkFd.append('profile_id',  fd.get('profile_id') as string)
        chunkFd.append('language',    fd.get('language') as string)
        chunkFd.append('speed',       fd.get('speed') as string)
        chunkFd.append('tts_engine',  fd.get('tts_engine') as string)
        chunkFd.append('temperature', fd.get('temperature') as string)
        chunkFd.append('top_k',       fd.get('top_k') as string)
        chunkFd.append('top_p',       fd.get('top_p') as string)
        chunkFd.append('gap_ms',      fd.get('gap_ms') as string)
        chunkFd.append('cfg_strength',       fd.get('cfg_strength') as string)
        chunkFd.append('target_rms',         fd.get('target_rms') as string)
        chunkFd.append('sway_sampling_coef', fd.get('sway_sampling_coef') as string)
        if (fd.get('repetition_penalty')) chunkFd.append('repetition_penalty', fd.get('repetition_penalty') as string)

        const MAX_RETRIES = 2
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (signal?.aborted) throw new Error('AbortError')
          try {
            return await api.engineSynthesize(chunkFd, signal)
          } catch (e) {
            if ((e as Error).name === 'AbortError') throw e
            if (e instanceof ApiError) {
              if (e.status >= 500)
                throw new Error(`Engine returned HTTP ${e.status} — the model may have crashed or run out of memory.`)
              throw new Error(`Synthesis failed: ${e.message}`)
            }
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
            } else {
              onRecheckEngineRef.current?.()
              throw new Error('Cannot reach the AI engine after multiple attempts. Check that the engine server is running.')
            }
          }
        }
        throw new Error('Synthesis failed after retries')
      }

      let blob: Blob
      if (useChunking) {
        const chunks      = splitIntoChunks(text.trim())
        const chunkBlobs: Blob[] = []
        for (const chunk of chunks) {
          if (signal?.aborted) return false
          chunkBlobs.push(await synthesizeText(chunk))
        }
        blob = await concatAudioBlobs(chunkBlobs)
      } else {
        // ── Single-pass with up to 2 retries on transient network errors
        const MAX_RETRIES = 2
        let raw: Blob | undefined
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (signal?.aborted) return false
          try {
            raw = await api.engineSynthesize(fd, signal)
            break
          } catch (e) {
            if ((e as Error).name === 'AbortError') return false
            if (e instanceof ApiError) {
              if (e.status >= 500)
                throw new Error(`Engine returned HTTP ${e.status} — the model may have crashed or run out of memory.`)
              throw new Error(`Synthesis failed: ${e.message}`)
            }
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
            } else {
              onRecheckEngineRef.current?.()
              throw new Error('Cannot reach the AI engine after multiple attempts. Check that the engine server is running.')
            }
          }
        }
        blob = raw!
      }

      // ── Enhance: HPF + noise gate + normalization → trim silence ────
      blob = await enhanceAudio(blob)
      blob = await trimSilence(blob)

      // ── Extract duration + waveform peaks ────────────────────────
      let duration: number | null = null
      let peaks: number[] | undefined
      try {
        const arr      = await blob.arrayBuffer()
        const audioCtx = new AudioContext()
        const buf      = await audioCtx.decodeAudioData(arr)
        duration       = Math.round(buf.duration * 10) / 10
        const peakData = buf.getChannelData(0)
        const numBars  = 60
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
      } catch {
        // Duration/peaks are non-critical — continue without them
      }

      // ── Persist: save blob locally, then upload to server so other
      // devices can restore it.  Await upload before marking hasAudio
      // so the DB never has has_audio=true with audio_url=null.
      await saveAudioBlob(`audio_${script.id}`, blob)
      if (onUploadAudio) await onUploadAudio(script.id, blob)
      onUpdateScript(script.id, {
        hasAudio:      true,
        profileId:     pid,
        language:      script.language || 'en',
        engine:        ttsEngine,
        duration,
        waveformPeaks: peaks,
      })
      return true
    },
    [voiceProfiles, onUpdateScript]
  )

  // ── Guest synthesis (one-shot via /clone-voice, no engine profile needed) ──
  // scriptOverride / textOverride let handleBulkGenerate pass any script directly.
  async function handleGuestGenerate(scriptOverride?: Script, textOverride?: string) {
    const script = scriptOverride ?? activeScript
    const text   = textOverride   ?? histState.present.trim()

    if (!script || !text) {
      setSynthErr('Write some script content first.')
      return
    }
    if (!voiceProfiles.length) {
      setSynthErr('Record a voice profile first.')
      return
    }

    const wc = text.split(/\s+/).length
    if (wc > guestLimits.word_limit) {
      onGuestGate?.('word_limit')
      return
    }

    const used = guestUsage?.synthesesUsed ?? 0
    if (used >= guestLimits.synth_limit) {
      onGuestGate?.('synth_limit')
      return 'gated' as const
    }

    if (!ENGINE_URL) {
      setSynthErr('Engine URL is not configured. Check your .env file.')
      return
    }

    const profileId = script.profileId || voiceProfiles[0]?.profile_id
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
      fd.append('text', text)
      fd.append('file', voiceBlob, 'voice.wav')
      fd.append('tts_engine', engine)
      fd.append('purpose', 'generate')

      let blob = await api.enginePost('/clone-voice', fd) as Blob
      blob = await trimSilence(blob)
      setAudioUrl(URL.createObjectURL(blob))

      // Extract duration + peaks, persist blob (same path as authenticated synthesis)
      let duration: number | null = null
      let peaks: number[] | undefined
      try {
        const arr      = await blob.arrayBuffer()
        const audioCtx = new AudioContext()
        const buf      = await audioCtx.decodeAudioData(arr)
        duration       = Math.round(buf.duration * 10) / 10
        const peakData = buf.getChannelData(0)
        const numBars  = 60
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
        peaks = rawPeaks.map(p => p / Math.max(...rawPeaks, 0.001))
        await audioCtx.close()
        await saveAudioBlob(`audio_${script.id}`, blob)
        onUpdateScript(script.id, { hasAudio: true, engine, duration, waveformPeaks: peaks })
      } catch {
        // Non-critical — playback still works
      }

      onGuestSynthesisUsed?.()
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setSynthErr('Synthesis failed. Is the AI engine running?')
    } finally {
      setSynthesizing(false)
    }
  }

  // ── Script translation ────────────────────────────────────────────
  async function translateScript(targetLang: string) {
    if (!activeScript) return
    const source = histState.present
    if (!source.trim()) { toast.err('Nothing to translate — add content first.'); return }
    setShowTranslateMenu(false)
    setTranslating(true)
    const wordCount = source.trim().split(/\s+/).length
    const logEntry = await activityLog.start(
      `Translating "${activeScript.title}"`,
      `words:${wordCount}|langs:${(activeScript.language || 'EN').toUpperCase()} → ${targetLang.toUpperCase()}`,
      { projectId: project.id, eventType: 'translation' },
    )
    try {
      const result = await api.engineJsonPost('/translate', {
        text: source,
        source_lang: activeScript.language || 'en',
        target_lang: targetLang,
      }) as { translated_text: string }

      dispatch({ type: 'SET', value: result.translated_text })
      onUpdateScript(activeScript.id, { language: targetLang })
      logEntry.done('Complete')
      toast.ok('Translation complete')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Translation failed'
      logEntry.fail(msg)
      toast.err(msg)
    } finally {
      setTranslating(false)
    }
  }

  // ── Server synthesis helpers ──────────────────────────────────────

  /**
   * Poll a server activity-log until done/failed.
   * Keeps the local activity-log store in sync so the panel shows live progress
   * without creating a second redundant log entry.
   */
  async function pollActivityLog(
    logId: number,
    onProgress?: (message: string) => void,
  ): Promise<void> {
    const MAX_MS = 60 * 60 * 1000 // 1 hour
    const start  = Date.now()
    // Register the server log in the in-memory store so it shows immediately.
    const tracker = await activityLog.track(logId)
    for (;;) {
      await new Promise(r => setTimeout(r, 3000))
      if (Date.now() - start > MAX_MS) throw new Error('Synthesis timed out after 1 hour.')
      const log = await api.get(`/activity-logs/${logId}`) as Record<string, unknown>
      tracker?.update(log)
      onProgress?.((log.message as string) ?? '')
      if (log.status === 'done') return
      if (log.status === 'failed') throw new Error((log.message as string) || 'Server synthesis failed.')
    }
  }

  /** Re-fetch the current project from the server and push changed script fields into local state. */
  async function refreshScriptState(scriptIds: string[]): Promise<void> {
    try {
      const raw   = await api.get('/projects') as Record<string, unknown>[]
      const proj  = raw.find(p => (p as Record<string, unknown>).id === project.id) as Record<string, unknown> | undefined
      if (!proj) return
      const scripts = (proj.scripts ?? []) as Record<string, unknown>[]
      for (const s of scripts) {
        const id = s.id as string
        if (!scriptIds.includes(id)) continue
        onUpdateScript(id, {
          hasAudio:      (s.has_audio      as boolean)              ?? false,
          audioUrl:      (s.audio_url      as string  | undefined)  ?? undefined,
          duration:      (s.duration       as number  | null)       ?? null,
          waveformPeaks: (s.waveform_peaks as number[] | undefined) ?? undefined,
        })
      }
    } catch (e) {
      console.warn('[WorkspacePage] refreshScriptState failed:', e)
    }
  }

  /** Download a script's audio from the server, cache it in IndexedDB, and return an object URL. */
  async function loadServerAudio(scriptId: string): Promise<string | null> {
    try {
      const blob = await api.get(`/scripts/${scriptId}/audio`) as Blob
      if (!(blob instanceof Blob) || blob.size === 0) {
        console.error(`[WorkspacePage] loadServerAudio(${scriptId}): server responded but body wasn't a usable audio blob`, blob)
        setSynthErr('Generation finished, but the audio file could not be loaded (empty response from server).')
        return null
      }
      await saveAudioBlob(`audio_${scriptId}`, blob)
      return URL.createObjectURL(blob)
    } catch (e) {
      // This bare catch used to hide exactly the bug being chased: audio
      // generates fine (DB + S3 both confirm it), but the browser can't
      // fetch it back, so the clip never appears in the Script section.
      const is404 = e instanceof ApiError && e.status === 404
      console.error(
        `[WorkspacePage] loadServerAudio(${scriptId}) failed. ` +
        (is404
          ? 'Got HTTP 404 from /scripts/:id/audio even though generation reported success — ' +
            'check Storage::disk(\'audio\')->exists() on the backend: is it able to actually ' +
            'read back what BulkSynthesisJob just wrote (permissions/region/bucket mismatch)?'
          : 'Non-404 failure — likely the request redirected to S3 and the browser fetch was ' +
            'blocked (check the Network/Console tab for a CORS error on the S3 domain, or a ' +
            'network timeout).'),
        e,
      )
      setSynthErr(
        is404
          ? 'Audio was generated but the server could not find the file when asked to serve it. Check server logs.'
          : 'Audio was generated but could not be downloaded to play (network/CORS error). Check the console.'
      )
      return null
    }
  }

  /**
   * Ensure a script has a profile_id saved server-side before queuing.
   * Picks the first available voice if none is set.
   */
  async function ensureProfileSaved(script: Script): Promise<boolean> {
    if (script.profileId) return true
    const fallbackId = voiceProfiles[0]?.profile_id
    if (!fallbackId) return false
    onUpdateScript(script.id, { profileId: fallbackId })
    // Give the server a moment to persist (updateScript is fire-and-forget in onUpdateScript)
    await new Promise(r => setTimeout(r, 300))
    return true
  }

  // ── Single-script synthesis ───────────────────────────────────────
  async function handleGenerateSingle() {
    if (isGuest) { await handleGuestGenerate(); return }

    if (!activeScript || !histState.present.trim()) {
      setSynthErr('Write some script content first.')
      return
    }
    const selectedVoiceId = activeScript.profileId || voiceProfiles[0]?.profile_id || ''
    const isBuiltinVoice  = selectedVoiceId.startsWith('builtin:')
    if (!voiceProfiles.length && !isBuiltinVoice) {
      setSynthErr('No voice selected. Pick a voice from the Voxora Library or record your own.')
      return
    }
    if (!ENGINE_URL) {
      setSynthErr('Engine URL is not configured. Check your .env file.')
      return
    }
    if (!currentEngineAvailable) {
      setSynthErr(
        engine === 'f5'
          ? 'F5-TTS is not installed on this server. Switch to XTTS v2 or run: pip install f5-tts'
          : 'XTTS v2 is not available on this server.'
      )
      return
    }

    // Check synthesis quota
    try {
      const q = await api.get('/synthesis/quota') as { remaining: number; limit: number; period: string }
      setSynthQuota(q)
      if (q.limit > 0 && q.remaining <= 0) {
        setSynthErr(`Synthesis quota reached (${q.limit} per ${q.period}). Upgrade your plan for more.`)
        setShowUpgradeModal(true)
        return
      }
    } catch { /* non-critical */ }

    // Ensure the current voice selection is persisted before the server job reads it.
    if (!activeScript.profileId && voiceProfiles[0]?.profile_id) {
      onUpdateScript(activeScript.id, { profileId: voiceProfiles[0].profile_id })
      await new Promise(r => setTimeout(r, 300))
    }

    // Also persist current content before queuing (auto-save may not have fired yet)
    if (activeScript.content !== histState.present) {
      onUpdateScript(activeScript.id, { content: histState.present })
      await new Promise(r => setTimeout(r, 300))
    }

    setSynthesizing(true)
    setSynthErr('')

    try {
      const result = await api.post('/engine/synthesize/bulk-queue', {
        script_ids: [activeScript.id],
        engine,
        project_id: project.id,
      }) as { queued: boolean; activity_log_id: number }

      // pollActivityLog registers the server's own log in the local store —
      // no separate client log needed.
      await pollActivityLog(result.activity_log_id)

      await refreshScriptState([activeScript.id])
      const url = await loadServerAudio(activeScript.id)
      if (url) setAudioUrl(url)

      api.get('/synthesis/quota').then(q => setSynthQuota(q as typeof synthQuota)).catch(() => {})
    } catch (e) {
      setSynthErr((e as Error).message)
    } finally {
      setSynthesizing(false)
    }
  }

  // ── Bulk synthesis ────────────────────────────────────────────────
  async function handleBulkGenerate() {
    const pending = project.scripts.filter(s => s.content.trim() && !s.hasAudio)
    if (!pending.length) { toast.info('All scripts already have audio.'); return }

    // Guest path: use /clone-voice for each pending script, respecting synth gate
    if (isGuest) {
      if (!voiceProfiles.length) { toast.err('No voice profile found. Record one in Voice Profiles first.'); return }
      for (const script of pending) {
        const result = await handleGuestGenerate(script, script.content)
        if (result === 'gated') break
      }
      return
    }

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

    // Ensure every pending script has a profile_id persisted before the server job runs.
    const fallbackProfileId = voiceProfiles[0]?.profile_id
    if (fallbackProfileId) {
      for (const script of pending) {
        if (!script.profileId) {
          onUpdateScript(script.id, { profileId: fallbackProfileId })
        }
      }
      if (pending.some(s => !s.profileId)) {
        await new Promise(r => setTimeout(r, 400))
      }
    }

    setBulkGenerating(true)
    setBulkTotal(pending.length)
    setBulkProgress(0)
    setBulkErrors([])

    try {
      const result = await api.post('/engine/synthesize/bulk-queue', {
        script_ids: pending.map(s => s.id),
        engine,
        project_id: project.id,
      }) as { queued: boolean; activity_log_id: number }

      // Server creates and owns the activity log — pollActivityLog registers it
      // in the local store so the panel shows it immediately (no duplicate log).
      await pollActivityLog(result.activity_log_id, (msg) => {
        const m = msg.match(/(\d+)\/(\d+)/)
        if (m) setBulkProgress(parseInt(m[1]))
      })

      await refreshScriptState(pending.map(s => s.id))
      setBulkProgress(pending.length)

      // If the currently-viewed script was in this batch, load its audio into
      // the player now — otherwise the waveform stays empty until page reload.
      if (activeScript && pending.some(s => s.id === activeScript.id)) {
        const url = await loadServerAudio(activeScript.id)
        if (url) setAudioUrl(url)
      }

      api.post('/notifications/bulk-synthesis-complete', {
        project_name: project.name,
        total: pending.length,
        failed: 0,
      }).catch(() => {})
    } catch (e) {
      toast.err((e as Error).message || 'Bulk synthesis failed.')
    } finally {
      setBulkActiveId(null)
      setBulkGenerating(false)
      setBulkTotal(0)
      setBulkProgress(0)
    }
  }

  // ── Queue bulk synthesis server-side ─────────────────────────────
  // ── Audio transcription ───────────────────────────────────────────
  async function handleAudioTranscribe(file: File) {
    if (!ENGINE_URL) { toast.err('Engine URL is not configured. Check your .env file.'); return }

    setTranscribing(true)
    const fd = new FormData()
    fd.append('file', file, file.name)
    try {
      const data = await api.enginePost('/transcribe', fd) as { text?: string }
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
      setImportParagraphs(paragraphs)
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
            position: 'fixed', bottom: 'auto', right: 'auto',
            left: '50%', transform: 'translateX(-50%)',
            top: 'auto',
            marginBottom: 6,
            background: 'var(--surface)', border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
            zIndex: 200, width: 260, maxWidth: 'calc(100vw - 24px)', overflow: 'hidden',
          }}
            ref={el => {
              if (!el) return
              // Position above the trigger button, centered but kept within viewport
              const trigger = el.parentElement?.querySelector('button') as HTMLElement | null
              if (!trigger) return
              const tb = trigger.getBoundingClientRect()
              const panelH = el.offsetHeight || 200
              const top = tb.top - panelH - 8
              el.style.top = Math.max(8, top) + 'px'
              el.style.left = ''
              el.style.transform = ''
              const halfW = (el.offsetWidth || 260) / 2
              const cx = tb.left + tb.width / 2
              const clampedLeft = Math.min(Math.max(12, cx - halfW), window.innerWidth - (el.offsetWidth || 260) - 12)
              el.style.left = clampedLeft + 'px'
            }}
          >
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
                desc: 'Flow-matching · natural prosody · English · all voices',
                color: '#4278c9',
                available: engineCaps.f5,
              },
            ] as const).map(opt => (
              <button
                key={opt.id}
                disabled={!opt.available}
                onClick={() => {
                  if (!opt.available) {
                    toast.info(`${opt.label} is unavailable on this server. ${opt.id === 'f5' ? 'F5-TTS needs a GPU — use XTTS v2 instead.' : ''}`)
                    return
                  }
                  setEngine(opt.id); setShowEngineMenu(false)
                }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '9px 12px', border: 'none',
                  background: engine === opt.id ? `${opt.color}10` : 'transparent',
                  cursor: opt.available ? 'pointer' : 'not-allowed', textAlign: 'left', transition: 'background 0.1s',
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
                      {opt.available ? 'Ready' : (opt.id === 'f5' ? 'Needs GPU' : 'Unavailable')}
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
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New Script" onClick={e => e.target === e.currentTarget && setShowTemplateModal(false)}>
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
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Transcription Complete" onClick={e => e.target === e.currentTarget && setPendingTranscription(null)}>
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

      {/* File import confirm modal */}
      {importParagraphs && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import Paragraphs" onClick={() => setImportParagraphs(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Import paragraphs</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              Found <strong>{importParagraphs.length} paragraphs</strong>. Import the first one into this script?
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setImportParagraphs(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => {
                if (activeScript) dispatch({ type: 'SET', value: importParagraphs[0] })
                setImportParagraphs(null)
              }}>Import first paragraph</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete script confirm modal — guards audio + assembly clip usage */}
      {(() => {
        const target = deleteScriptId ? project.scripts.find(s => s.id === deleteScriptId) : null
        if (!target) return null
        const clipsInUse = (project.timelineClips ?? []).filter(c => !c.isGap && c.scriptId === target.id)

        const confirmDelete = async (removeClips: boolean) => {
          if (removeClips && clipsInUse.length > 0) onRemoveScriptClips?.(target.id)
          deleteAudioBlob(`audio_${target.id}`)
          onDeleteScript(target.id)
          if (activeScriptId === target.id) setShowScriptList(true)
          setDeleteScriptId(null)
          const parts = [target.hasAudio ? 'generated audio removed' : 'no audio']
          if (removeClips && clipsInUse.length > 0) parts.push(`${clipsInUse.length} assembly clip${clipsInUse.length !== 1 ? 's' : ''} removed from timeline`)
          const entry = await activityLog.start(
            `Deleted script "${target.title}"`,
            parts.join(' · '),
            { projectId: project.id, eventType: 'delete' },
          )
          entry.done(parts.join(' · '))
        }

        return (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete Script" onClick={() => setDeleteScriptId(null)}>
            <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
              <div className="modal__title">Delete script?</div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
                <strong>"{target.title}"</strong> will be permanently deleted
                {target.hasAudio ? <> along with its <strong>generated audio clip</strong></> : ''}. This cannot be undone.
              </p>
              {clipsInUse.length > 0 && (
                <div className="msg msg--warn" style={{ marginBottom: 14, fontSize: 12.5, lineHeight: 1.5 }}>
                  This script's audio is used in <strong>{clipsInUse.length} clip{clipsInUse.length !== 1 ? 's' : ''}</strong> on
                  the Assembly timeline. The clip{clipsInUse.length !== 1 ? 's' : ''} must be removed from the timeline
                  before the script can be deleted.
                </div>
              )}
              <div className="modal__actions">
                <button className="btn btn--ghost" onClick={() => setDeleteScriptId(null)}>Cancel</button>
                {clipsInUse.length > 0 ? (
                  <button className="btn btn--danger" onClick={() => confirmDelete(true)}>
                    {icons.trash} Remove from timeline & delete
                  </button>
                ) : (
                  <button className="btn btn--danger" onClick={() => confirmDelete(false)}>
                    {icons.trash} Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Quota-reached upgrade popup */}
      {showUpgradeModal && (
        <UpgradeQuotaModal
          quota={synthQuota}
          onClose={() => setShowUpgradeModal(false)}
          onGoPricing={onGoPricing}
        />
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
            {!bulkGenerating && (
              <button
                className="btn btn--sm"
                onClick={handleBulkGenerate}
                disabled={synthesizing || bulkGenerating}
                title="Generate all scripts"
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
              <button className="btn btn--sm btn--primary" onClick={() => setShowTemplateModal(true)}>
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
                {bulkActiveId === s.id ? (
                  <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />
                ) : (
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
                )}
                <button
                  className="script-item__delete"
                  title="Delete script"
                  onClick={e => { e.stopPropagation(); setDeleteScriptId(s.id) }}
                >
                  {icons.trash}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bulk generate footer — always visible so users can regenerate */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            className="btn btn--sm"
            style={{
              width:          '100%',
              justifyContent: 'center',
              background:     (synthesizing || bulkGenerating) ? 'var(--bg-3)' : 'var(--accent-lt)',
              color:          (synthesizing || bulkGenerating) ? 'var(--text-3)' : 'var(--accent)',
              border:         '1px solid var(--accent-mid)',
            }}
            onClick={handleBulkGenerate}
            disabled={synthesizing || bulkGenerating}
          >
            {bulkGenerating ? (
              <><span className="spinner" /> Generating {bulkProgress}/{bulkTotal}</>
            ) : (
              <>{icons.bolt} Generate All{pendingCount > 0 ? ` (${pendingCount})` : ''}</>
            )}
          </button>
        </div>
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

              {/* Translate — engine-independent (Gemini text translation) */}
              {(
                <div style={{ position: 'relative' }}>
                  <button
                    className="btn btn--sm btn--ghost"
                    disabled={translating}
                    title="Translate this script to another language"
                    style={{ gap: 5, opacity: translating ? 0.6 : 1 }}
                    onClick={() => setShowTranslateMenu(v => !v)}
                  >
                    {translating
                      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 14, height: 14 }}><path d="M3 5h12M9 3v2M11.5 19l-2.5-5M13.5 19l2.5-5M9 14h6M5 17h6a2 2 0 0 0 2-2V9"/></svg>
                    }
                    <span style={{ fontSize: 12 }}>{translating ? 'Translating…' : 'Translate'}</span>
                  </button>
                  {showTranslateMenu && !translating && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowTranslateMenu(false)} />
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 200, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>Translate to…</div>
                        <div style={{ maxHeight: 260, overflow: 'hidden auto' }}>
                          {LANGUAGES.filter(l => l.code !== (activeScript.language || 'en')).map(l => {
                            const sel = translateTarget === l.code
                            return (
                              <button key={l.code} onClick={() => setTranslateTarget(l.code)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '7px 12px', border: 'none', background: sel ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: sel ? 'var(--accent)' : 'var(--text-1)', transition: 'background 0.1s', borderLeft: sel ? '3px solid var(--accent)' : '3px solid transparent' }}>
                                {l.label}
                                {sel && <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: 13, height: 13 }}><path d="M4 10l4 4 8-9" /></svg>}
                              </button>
                            )
                          })}
                        </div>
                        <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
                          <button
                            className="btn btn--sm btn--primary"
                            style={{ width: '100%', justifyContent: 'center' }}
                            disabled={!histState.present.trim()}
                            onClick={() => translateScript(translateTarget)}
                          >
                            Translate to {LANGUAGES.find(l => l.code === translateTarget)?.label ?? translateTarget}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <button
                className="btn btn--sm btn--danger"
                onClick={() => setDeleteScriptId(activeScript.id)}
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
                            <option key={vp.profile_id} value={vp.profile_id}>{vp.name}</option>
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
                    color: wordCount > guestLimits.word_limit ? 'var(--err)' : 'var(--text-3)',
                    fontSize: 10,
                  }}>
                    ({wordCount}/{guestLimits.word_limit} guest limit)
                  </span>
                )}
              </span>

              <div style={{ flex: 1 }} />

              {/* Tone preset popup — works on both engines (mapped to each
                  engine's own knobs: XTTS sampling, F5 cfg/rms/sway/pace) */}
              {(() => {
                const activeTone = (activeScript.tone ?? 'natural') as TonePreset
                const activePreset = TONE_PRESETS[activeTone]
                return (
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      title="Voice emotion / style"
                      style={{ gap: 5, paddingRight: 8 }}
                      onClick={() => setShowToneMenu(v => !v)}
                    >
                      <span style={{ fontSize: 13 }}>{activePreset.emoji}</span>
                      <span style={{ fontSize: 12 }}>{activePreset.label}</span>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 10, height: 10, opacity: 0.5 }}><path d="M5 8l5 5 5-5" /></svg>
                    </button>
                    {showToneMenu && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowToneMenu(false)} />
                        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 220, overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>Voice Emotion</div>
                          {(Object.entries(TONE_PRESETS) as [TonePreset, typeof TONE_PRESETS[TonePreset]][]).map(([key, preset]) => {
                            const active = activeTone === key
                            return (
                              <button key={key}
                                onClick={() => { onUpdateScript(activeScript.id, { tone: key, advancedParams: undefined }); setShowToneMenu(false) }}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', border: 'none', background: active ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent' }}
                                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-2)' }}
                                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                              >
                                <span style={{ fontSize: 16, flexShrink: 0 }}>{preset.emoji}</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--accent)' : 'var(--text-1)' }}>{preset.label}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.3 }}>{preset.desc}</span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                    <button
                      title="Advanced style controls"
                      onClick={() => setShowAdvanced(v => !v)}
                      style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${showAdvanced ? 'var(--accent)' : 'var(--border-2)'}`, background: showAdvanced ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: showAdvanced ? 'var(--accent)' : 'var(--text-3)', letterSpacing: '0.3px' }}>
                      ADV
                    </button>
                  </div>
                )
              })()}
              {/* Advanced sliders */}
              {engine !== 'f5' && showAdvanced && (() => {
                const adv = activeScript.advancedParams ?? {}
                const base = TONE_PRESETS[(activeScript.tone ?? 'natural') as TonePreset] ?? TONE_PRESETS.natural
                const temp = adv.temperature ?? base.temperature
                const topK = adv.top_k ?? base.top_k
                const topP = adv.top_p ?? base.top_p
                const set = (key: string, val: number) =>
                  onUpdateScript(activeScript.id, { advancedParams: { ...adv, [key]: val } })
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', background: 'var(--accent-lt)', borderRadius: 6, border: '1px solid var(--accent-mid)', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Temp', key: 'temperature', min: 0.1, max: 1.0, step: 0.05, val: temp },
                      { label: 'Top-K', key: 'top_k',     min: 1,   max: 100,  step: 1,    val: topK },
                      { label: 'Top-P', key: 'top_p',     min: 0.1, max: 1.0,  step: 0.05, val: topP },
                    ].map(({ label, key, min, max, step, val }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{label}</span>
                        <input type="range" min={min} max={max} step={step} value={val}
                          onChange={e => set(key, parseFloat(e.target.value))}
                          style={{ width: 55, accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--mono)', width: 28 }}>
                          {typeof val === 'number' ? (key === 'top_k' ? val : val.toFixed(2)) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })()}

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

              {/* ── Accent language picker ── */}
              {(() => {
                // XTTS is multilingual. F5 speaks only its checkpoint's
                // language(s), reported by the engine as f5_languages.
                const f5Langs = engineCaps.f5_languages ?? []
                const langOptions = engine === 'f5'
                  ? LANGUAGES.filter(l => f5Langs.includes(l.code))
                  : LANGUAGES
                // Disable only when there's nothing meaningful to choose.
                const disabled = engine === 'f5' && langOptions.length <= 1
                const currentLang = LANGUAGES.find(l => l.code === (activeScript.language || 'en'))
                return (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      disabled={disabled}
                      title={disabled ? 'This F5-TTS model speaks one language — switch to XTTS v2, or load a different F5 model for more languages' : 'Accent language'}
                      style={{ gap: 5, paddingRight: 8, opacity: disabled ? 0.45 : 1 }}
                      onClick={() => { if (!disabled) setShowLangMenu(v => !v) }}
                    >
                      <span style={{ fontSize: 12 }}>{currentLang?.label ?? 'English'}</span>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 10, height: 10, opacity: 0.5 }}><path d="M5 8l5 5 5-5" /></svg>
                    </button>
                    {showLangMenu && !disabled && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowLangMenu(false)} />
                        <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 160, maxHeight: 360, overflow: 'hidden auto' }}>
                          <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Accent language</div>
                          {langOptions.map(l => (
                            <button key={l.code} onClick={() => { onUpdateScript(activeScript.id, { language: l.code }); setShowLangMenu(false) }}
                              style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '6px 12px', border: 'none', background: (activeScript.language || 'en') === l.code ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 13, color: 'var(--text-1)', transition: 'background 0.1s', borderLeft: (activeScript.language || 'en') === l.code ? '3px solid var(--accent)' : '3px solid transparent', whiteSpace: 'nowrap' }}>
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}

              {/* ── Voice profile picker ── */}
              {(() => {
                const currentId  = activeScript.profileId ?? voiceProfiles[0]?.profile_id ?? ''
                const isBuiltinSel = currentId.startsWith('builtin:')
                const currentVp  = voiceProfiles.find(vp => vp.profile_id === currentId)
                const builtinVp  = BUILT_IN_VOICES.find(v => v.id === currentId)
                const displayName = isBuiltinSel
                  ? (builtinVp?.name ?? currentId.replace('builtin:', ''))
                  : (currentVp?.name ?? (voiceProfiles[0]?.name ?? 'Voice'))
                // Always show picker — built-in voices now work with both engines
                if (!voiceProfiles.length && !BUILT_IN_VOICES.length) return null
                return (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      style={{ gap: 5, paddingRight: 8, maxWidth: 140 }}
                      title="Voice"
                      onClick={() => setShowVoiceMenu(v => !v)}
                    >
                      <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{displayName}</span>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 10, height: 10, opacity: 0.5, flexShrink: 0 }}><path d="M5 8l5 5 5-5" /></svg>
                    </button>
                    {showVoiceMenu && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowVoiceMenu(false)} />
                        <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 200, minWidth: 190, maxHeight: 320, overflow: 'hidden auto' }}>
                          {voiceProfiles.length > 0 && <>
                            <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)' }}>Your Voices</div>
                            {voiceProfiles.map(vp => (
                              <button key={vp.profile_id} onClick={() => { onUpdateScript(activeScript.id, { profileId: vp.profile_id }); setShowVoiceMenu(false) }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: currentId === vp.profile_id ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', borderLeft: currentId === vp.profile_id ? '3px solid var(--accent)' : '3px solid transparent' }}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent-lt)', border: '1px solid var(--accent-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <svg viewBox="0 0 20 20" fill="none" stroke="var(--accent)" strokeWidth="1.6" style={{ width: 11, height: 11 }}><path d="M12 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /></svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{vp.name ?? vp.profile_id}</div>
                                  {vp.duration && <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{vp.duration.toFixed(1)}s sample</div>}
                                </div>
                                <VoicePlayBtn
                                  id={`custom:${vp.profile_id}`}
                                  url={`/voice-profile/${encodeURIComponent(vp.engine_key ?? vp.profile_id)}/preview`}
                                  playingId={voicePreview.playingId}
                                  loadingId={voicePreview.loadingId}
                                  toggle={voicePreview.toggle}
                                />
                              </button>
                            ))}
                          </>}
                          {/* Built-in library — works with both XTTS and F5 */}
                          {true && <>
                            <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)', borderTop: voiceProfiles.length ? '1px solid var(--border-2)' : undefined, marginTop: voiceProfiles.length ? 4 : 0 }}>Voxora Library</div>
                            {BUILT_IN_VOICES.map(bv => {
                              const speakerName = bv.id.replace('builtin:', '')
                              return (
                                <button key={bv.id} onClick={() => { onUpdateScript(activeScript.id, { profileId: bv.id }); setShowVoiceMenu(false) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', border: 'none', background: currentId === bv.id ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', borderLeft: currentId === bv.id ? '3px solid var(--accent)' : '3px solid transparent' }}>
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: bv.gender === 'F' ? 'rgba(201,66,120,0.10)' : 'rgba(66,120,201,0.10)', border: `1px solid ${bv.gender === 'F' ? 'rgba(201,66,120,0.25)' : 'rgba(66,120,201,0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11 }}>
                                    {bv.gender === 'F' ? '♀' : '♂'}
                                  </div>
                                  <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{bv.name}</div>
                                  <VoicePlayBtn
                                    id={bv.id}
                                    url={`/voice-preview/${encodeURIComponent(speakerName)}`}
                                    playingId={voicePreview.playingId}
                                    loadingId={voicePreview.loadingId}
                                    toggle={voicePreview.toggle}
                                  />
                                </button>
                              )
                            })}
                          </>}
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}

              {/* Engine switcher */}
              <EngineSelector />

              {/* Quota badge (auth users) */}
              {!isGuest && synthQuota && synthQuota.limit > 0 && (
                <span title={`${synthQuota.remaining} of ${synthQuota.limit} syntheses remaining (${synthQuota.period})`}
                  style={{ fontSize: 10, color: synthQuota.remaining === 0 ? 'var(--err)' : 'var(--text-3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                  {synthQuota.remaining}/{synthQuota.limit}
                </span>
              )}

              {/* Generate button */}
              <button
                className="btn btn--primary btn--sm"
                onClick={handleGenerateSingle}
                disabled={synthesizing || bulkGenerating || !histState.present.trim()}
              >
                {synthesizing ? (
                  <><span className="spinner" /> Generating…</>
                ) : bulkGenerating ? (
                  <><span className="spinner" /> Generating {bulkProgress}/{bulkTotal}</>
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