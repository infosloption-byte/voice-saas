import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { api, ApiError } from './api'
import { toast } from './toast'
import { icons, LANGUAGES, TONE_PRESETS, BUILT_IN_VOICES, type TonePreset } from './constants'
import { loadAudioBlob, saveAudioBlob, deleteAudioBlob, historyReducer, fmt, trimSilence, enhanceAudio, audioBufferToWav } from './audio'
import { useTTSEngine, type TTSEngine } from './hooks/useTTSEngine'
import { useEscapeKey } from './hooks/useEscapeKey'
import { type GateType, type GuestUsage } from './hooks/useGuestSession'
import { DEFAULT_GUEST_LIMITS } from './hooks/useGuestLimits'
import type { Project, Script, VoiceProfile, SaveState, EngineCaps, GuestLimits } from './types'

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
  const [showTranslateMenu, setShowTranslateMenu] = useState(false)
  const [translateTarget, setTranslateTarget]   = useState('es')
  const [showAdvanced,     setShowAdvanced]     = useState(false)
  const [synthQuota, setSynthQuota]             = useState<{ remaining: number; limit: number; period: string } | null>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [pendingTranscription, setPendingTranscription] = useState<string | null>(null)
  const [importParagraphs, setImportParagraphs] = useState<string[] | null>(null)
  const [deleteScriptPending, setDeleteScriptPending] = useState(false)
  const [translating, setTranslating]           = useState(false)

  // Escape closes whichever modal is open — highest-priority one wins
  useEscapeKey(() => {
    if (deleteScriptPending)         { setDeleteScriptPending(false); return }
    if (importParagraphs)            { setImportParagraphs(null);     return }
    if (pendingTranscription !== null){ setPendingTranscription(null);return }
    if (showTemplateModal)           { setShowTemplateModal(false);   return }
    if (showTranslateMenu)           { setShowTranslateMenu(false);   return }
  })

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
            if (blob instanceof Blob) {
              await saveAudioBlob(`audio_${sid}`, blob)
              const restored = await loadAudioBlob(`audio_${sid}`)
              if (restored) { setAudioUrl(restored); return }
            }
          } catch { /* server restore failed */ }
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

      const fd = new FormData()
      fd.append('text',        text.trim())
      fd.append('profile_id',  engineKey)
      fd.append('language',    script.language || 'en')
      fd.append('speed',       String(Math.max(0.5, Math.min(2.0, script.speed ?? 1.0))))
      fd.append('tts_engine',  ttsEngine)
      // XTTS-specific knobs (ignored by F5-TTS)
      fd.append('temperature', String(temperature))
      fd.append('top_k',       String(top_k))
      fd.append('top_p',       String(top_p))
      fd.append('gap_ms',      '60')
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
        chunkFd.append('profile_id',  fd.get('profile_id') as string)
        chunkFd.append('language',    fd.get('language') as string)
        chunkFd.append('speed',       fd.get('speed') as string)
        chunkFd.append('tts_engine',  fd.get('tts_engine') as string)
        chunkFd.append('temperature', fd.get('temperature') as string)
        chunkFd.append('top_k',       fd.get('top_k') as string)
        chunkFd.append('top_p',       fd.get('top_p') as string)
        chunkFd.append('gap_ms',      fd.get('gap_ms') as string)
        if (fd.get('repetition_penalty')) chunkFd.append('repetition_penalty', fd.get('repetition_penalty') as string)

        const MAX_RETRIES = 2
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (signal?.aborted) throw new Error('AbortError')
          try {
            return await api.enginePost('/synthesize', chunkFd, signal) as Blob
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
            raw = await api.enginePost('/synthesize', fd, signal) as Blob
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
    try {
      // Check & record quota before running (guests skip — no DB tracking)
      if (!isGuest) {
        try {
          await api.post('/translation/record')
        } catch (quotaErr: unknown) {
          const msg = quotaErr instanceof Error ? quotaErr.message : 'Translation quota reached'
          toast.err(msg)
          setTranslating(false)
          return
        }
      }

      const result = await api.engineJsonPost('/translate', {
        text: source,
        source_lang: activeScript.language || 'en',
        target_lang: targetLang,
      }) as { translated_text: string }

      dispatch({ type: 'SET', value: result.translated_text })
      onUpdateScript(activeScript.id, { language: targetLang })
      toast.ok('Translation complete')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Translation failed'
      toast.err(msg)
    } finally {
      setTranslating(false)
    }
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
    // Guard: surface engine unavailability immediately rather than waiting for a 503
    if (!currentEngineAvailable) {
      setSynthErr(
        engine === 'f5'
          ? 'F5-TTS is not installed on this server. Switch to XTTS v2 or run: pip install f5-tts'
          : 'XTTS v2 is not available on this server.'
      )
      return
    }

    // Check synthesis quota for authenticated users
    try {
      const q = await api.get('/synthesis/quota') as { remaining: number; limit: number; period: string }
      setSynthQuota(q)
      if (q.limit > 0 && q.remaining <= 0) {
        setSynthErr(`Synthesis quota reached (${q.limit} per ${q.period}). Upgrade your plan for more.`)
        return
      }
    } catch {
      // Non-critical — proceed without quota check if endpoint unavailable
    }

    synthAbortRef.current?.abort()
    const controller = new AbortController()
    synthAbortRef.current = controller

    setSynthesizing(true)
    setSynthErr('')

    try {
      const ok = await generateVoiceover(activeScript, histState.present, controller.signal, engine)
      if (ok) {
        const url = await loadAudioBlob(`audio_${activeScript.id}`)
        setAudioUrl(url)
        // Record usage (fire-and-forget; non-critical)
        api.post('/synthesis/record', {}).catch(() => {})
        // Refresh quota display
        api.get('/synthesis/quota').then(q => setSynthQuota(q as typeof synthQuota)).catch(() => {})
      }
      // ok === false means user cancelled — no error to show
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
    if (!voiceProfiles.length) { toast.err('No voice profile found. Record one in Voice Profiles first.'); return }

    // Guest path: use /clone-voice for each pending script, respecting synth gate
    if (isGuest) {
      for (const script of pending) {
        const result = await handleGuestGenerate(script, script.content)
        // Stop the whole batch once the synth limit gate fires — otherwise the
        // gate modal would re-trigger for every remaining script.
        if (result === 'gated') break
      }
      return
    }

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
      setBulkActiveId(script.id)
      try {
        const ok = await generateVoiceover(script, script.content, controller.signal, engine)
        if (!ok && !controller.signal.aborted) setBulkErrors(prev => [...prev, script.title])
      } catch (e) {
        setBulkErrors(prev => [...prev, script.title])
        // Engine is unreachable — no point continuing the batch
        if ((e as Error).message.includes('multiple attempts')) break
      }
      setBulkProgress(p => p + 1)
    }

    setBulkActiveId(null)
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

      {/* Delete script confirm modal */}
      {deleteScriptPending && activeScript && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete Script" onClick={() => setDeleteScriptPending(false)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Delete script?</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              <strong>"{activeScript.title}"</strong> will be permanently deleted. This cannot be undone.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setDeleteScriptPending(false)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => {
                onDeleteScript(activeScript.id)
                setShowScriptList(true)
                setDeleteScriptPending(false)
              }}>{icons.trash} Delete</button>
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

              {/* Translate (XTTS only) */}
              {engine !== 'f5' && (
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
                onClick={() => setDeleteScriptPending(true)}
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

              {/* Tone preset popup (XTTS only) */}
              {engine !== 'f5' && (() => {
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
                const disabled = engine === 'f5'
                const currentLang = LANGUAGES.find(l => l.code === (activeScript.language || 'en'))
                return (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      disabled={disabled}
                      title={disabled ? 'Language selection is only used by XTTS v2' : 'Accent language'}
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
                          {LANGUAGES.map(l => (
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
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{vp.name ?? vp.profile_id}</div>
                                  {vp.duration && <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{vp.duration.toFixed(1)}s sample</div>}
                                </div>
                              </button>
                            ))}
                          </>}
                          {/* Built-in library — works with both XTTS and F5 */}
                          {true && <>
                            <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)', borderTop: voiceProfiles.length ? '1px solid var(--border-2)' : undefined, marginTop: voiceProfiles.length ? 4 : 0 }}>Voxora Library</div>
                            {BUILT_IN_VOICES.map(bv => (
                              <button key={bv.id} onClick={() => { onUpdateScript(activeScript.id, { profileId: bv.id }); setShowVoiceMenu(false) }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', border: 'none', background: currentId === bv.id ? 'var(--accent-lt)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s', borderLeft: currentId === bv.id ? '3px solid var(--accent)' : '3px solid transparent' }}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: bv.gender === 'F' ? 'rgba(201,66,120,0.10)' : 'rgba(66,120,201,0.10)', border: `1px solid ${bv.gender === 'F' ? 'rgba(201,66,120,0.25)' : 'rgba(66,120,201,0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11 }}>
                                  {bv.gender === 'F' ? '♀' : '♂'}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>{bv.name}</div>
                              </button>
                            ))}
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