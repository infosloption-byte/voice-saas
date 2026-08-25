import { useEffect, useMemo, useRef, useState } from 'react'
import { icons } from '../lib/constants'
import { fmt, uid } from '../lib/audio'
import { toast } from '../lib/toast'
import './dubbing-studio.css'

/**
 * Dubbing Studio — professional video dubbing UI (CapCut-style editor).
 *
 * Built from scratch per spec. Does not touch DubbingPage.tsx or
 * VideoStudioPage.tsx — this is a new, self-contained page that renders
 * full-window (fixed overlay) so it gets its own app rail + workspace
 * instead of living inside the main sidebar's `.content` area.
 *
 * Per the brief: this ships the exact UI + interaction model first.
 * The pipeline (Whisper / Gemini / XTTS / ffmpeg) is simulated in the
 * browser — matching the "real vs simulated" table in the spec. Local
 * video upload + duration read is genuinely real; synthesis/mux is not.
 */

// ── Types ─────────────────────────────────────────────────────────

type EngineId = 'xtts' | 'f5' | 'chatterbox'
type VoiceId = 'claribel' | 'daisy' | 'myvoice'
type LangCode = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'zh' | 'hi' | 'ar'
type JobStatus = 'queued' | 'transcribing' | 'translating' | 'synthesizing' | 'muxing' | 'done' | 'failed'
type SegStatus = 'ok' | 'overflow' | 'empty' | 'synth_failed'
type PreviewMode = 'src' | 'dub'
type LibFilter = 'all' | 'project' | 'favorites'

interface Segment {
  id: string
  start: number
  end: number
  original: string
  translated: string
  muted: boolean
  voiceId: VoiceId | null
  status: SegStatus
  stretch: number
  hasAudio: boolean
}

interface Job {
  id: string
  filename: string
  duration: number
  poster: string
  posterImage: string | null
  videoUrl: string | null
  isUpload: boolean
  sourceLang: LangCode
  targetLang: LangCode
  voiceId: VoiceId
  engine: EngineId
  status: JobStatus
  progress: number
  error: string | null
  segments: Segment[]
  hasResult: boolean
  favorite: boolean
}

// ── Static data ──────────────────────────────────────────────────

const VOICES: { id: VoiceId; label: string }[] = [
  { id: 'claribel', label: 'Claribel' },
  { id: 'daisy', label: 'Daisy' },
  { id: 'myvoice', label: 'My Voice (cloned)' },
]

const ENGINES: { id: EngineId; label: string; disabled?: boolean; note?: string }[] = [
  { id: 'xtts', label: 'XTTS v2' },
  { id: 'f5', label: 'F5-TTS', disabled: true, note: 'Needs GPU' },
  { id: 'chatterbox', label: 'Chatterbox' },
]

const LANGS: { code: LangCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
]
const langLabel = (c: string) => LANGS.find(l => l.code === c)?.label ?? c.toUpperCase()

const PIPELINE_STAGES: { status: JobStatus; label: string; progress: number }[] = [
  { status: 'queued', label: 'Queued', progress: 0 },
  { status: 'transcribing', label: 'Transcribing audio', progress: 8 },
  { status: 'translating', label: 'Translating script', progress: 28 },
  { status: 'synthesizing', label: 'Synthesizing dubbed voice', progress: 52 },
  { status: 'muxing', label: 'Combining with video', progress: 86 },
  { status: 'done', label: 'Done', progress: 100 },
]

const DEMO_LINES = [
  { start: 0.4, end: 4.3, text: 'Launching the starship — Test 12' },
  { start: 5.1, end: 8.9, text: 'Here it is going down' },
  { start: 9.6, end: 13.4, text: 'Slow motion x1' },
  { start: 14.2, end: 17.6, text: 'Sample Text' },
]

const DEMO_TRANSLATIONS: Partial<Record<LangCode, string[]>> = {
  es: ['Lanzando la nave estelar — Prueba 12', 'Aquí está bajando', 'Cámara lenta x1', 'Texto de muestra'],
  fr: ['Lancement du vaisseau — Essai 12', 'Le voilà qui descend', 'Ralenti x1', 'Exemple de texte'],
  de: ['Start des Raumschiffs — Test 12', 'Hier geht er runter', 'Zeitlupe x1', 'Beispieltext'],
}

const POSTER_GRADIENTS = [
  'linear-gradient(165deg, #04060c 0%, #0b1730 42%, #163258 68%, #2f5590 100%)',
  'linear-gradient(165deg, #05070d 0%, #0d1a35 42%, #1a3a63 68%, #3a6199 100%)',
  'linear-gradient(165deg, #030509 0%, #0a1428 42%, #12294a 68%, #274a82 100%)',
]

const FILMSTRIP_FRAMES = 12

function fmtTC(s: number): string {
  const c = Math.max(0, s)
  const m = Math.floor(c / 60)
  const sec = (c % 60).toFixed(2).padStart(5, '0')
  return `${String(m).padStart(2, '0')}:${sec}`
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

// Cheap deterministic hash → stable fake-waveform bars per segment id
function barsFor(id: string, count = 14): number[] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    out.push(0.25 + ((h >>> 8) % 100) / 100 * 0.7)
  }
  return out
}

function buildDemoSegments(target: LangCode): Segment[] {
  const trans = DEMO_TRANSLATIONS[target] ?? DEMO_LINES.map(l => `[${target.toUpperCase()}] ${l.text}`)
  return DEMO_LINES.map((l, i) => ({
    id: uid(), start: l.start, end: l.end, original: l.text, translated: trans[i],
    muted: false, voiceId: null, status: 'ok', stretch: 1, hasAudio: true,
  }))
}

function buildPlaceholderSegments(duration: number, target: LangCode): Segment[] {
  const n = clamp(Math.round(duration / 3), 3, 8)
  const seg = duration / n
  return Array.from({ length: n }).map((_, i) => {
    const start = +(i * seg + 0.2).toFixed(1)
    const end = +Math.min(duration - 0.1, (i + 1) * seg - 0.3).toFixed(1)
    return {
      id: uid(), start, end: Math.max(start + 0.6, end),
      original: `Briefing line ${i + 1}.`,
      translated: `[${target.toUpperCase()}] Briefing line ${i + 1}.`,
      muted: false, voiceId: null, status: 'ok' as SegStatus, stretch: 1, hasAudio: true,
    }
  })
}

function makeDemoJob(filename: string, favorite: boolean, posterIdx: number): Job {
  return {
    id: uid(), filename, duration: 18, poster: POSTER_GRADIENTS[posterIdx], posterImage: null, videoUrl: null, isUpload: false,
    sourceLang: 'en', targetLang: 'es', voiceId: 'claribel', engine: 'xtts',
    status: 'done', progress: 100, error: null,
    segments: buildDemoSegments('es'), hasResult: true, favorite,
  }
}

const INITIAL_JOBS: Job[] = [
  makeDemoJob('part-1 - Trim.mp4', true, 0),
  makeDemoJob('part-4.mp4', false, 1),
  makeDemoJob('part-5.mp4', false, 2),
]

const STATUS_CHIP: Record<SegStatus, string> = { ok: 'Fit', overflow: 'Overran', empty: 'Silent', synth_failed: 'Failed' }

// ── Small local icon (not in the shared set) ────────────────────

const ClapperIcon = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="7.5" width="14" height="9.5" rx="1.4" />
    <path d="M3 7.5l1.6-4h11l1.4 4M6 3.5l1.2 4M10 3.5l1.2 4M14 3.5l1.2 4" />
  </svg>
)

// ── Component ────────────────────────────────────────────────────

export function DubbingStudioPage() {
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS)
  const [selectedJobId, setSelectedJobId] = useState(INITIAL_JOBS[0].id)
  const [selectedSegId, setSelectedSegId] = useState<string | null>(INITIAL_JOBS[0].segments[0]?.id ?? null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('src')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(INITIAL_JOBS[0].segments[0]?.start ?? 0)
  const [zoom, setZoom] = useState(60)
  const [libFilter, setLibFilter] = useState<LibFilter>('all')
  const [search, setSearch] = useState('')
  const [mobileLibOpen, setMobileLibOpen] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'new' | 'retry'; retryJobId?: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [resynthingId, setResynthingId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [draft, setDraft] = useState('')

  const timelineRef = useRef<HTMLDivElement | null>(null)
  const monitorVideoRef = useRef<HTMLVideoElement | null>(null)
  const jobsRef = useRef<Job[]>(jobs)
  useEffect(() => { jobsRef.current = jobs }, [jobs])
  // Revoke every still-live blob URL when the studio unmounts.
  useEffect(() => () => {
    jobsRef.current.forEach(j => { if (j.videoUrl) URL.revokeObjectURL(j.videoUrl) })
  }, [])

  const job = jobs.find(j => j.id === selectedJobId) ?? null
  const segment = job?.segments.find(s => s.id === selectedSegId) ?? null
  const activeCaption = job?.segments.find(s => time >= s.start && time <= s.end) ?? null

  useEffect(() => { setDraft(segment?.translated ?? '') }, [segment?.id])

  // Playhead animation — only for jobs with no real file (simulated demo/placeholder clips).
  // Real uploads are driven by the <video> element's own timeupdate event instead (see effects below).
  useEffect(() => {
    if (!playing || !job || job.videoUrl) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setTime(t => {
        const nt = t + dt
        if (nt >= job.duration) { setPlaying(false); return job.duration }
        return nt
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, job?.id, job?.duration, job?.videoUrl])

  // Real video playback — keep the <video> element's play/pause state in sync.
  useEffect(() => {
    const v = monitorVideoRef.current
    if (!v || !job?.videoUrl) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing, job?.id, job?.videoUrl])

  // Real video playback — seek the element when `time` changes for a reason other than
  // its own playback (clicking the timeline, selecting a segment, skip-back, etc). The
  // threshold lets normal timeupdate ticks pass through without fighting themselves.
  useEffect(() => {
    const v = monitorVideoRef.current
    if (!v || !job?.videoUrl) return
    if (Math.abs(v.currentTime - time) > 0.35) v.currentTime = time
  }, [time, job?.id, job?.videoUrl])

  // Keyboard shortcuts (ignored while typing)
  useEffect(() => {
    function isTyping(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    }
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return
      if (e.code === 'Space') { e.preventDefault(); if (job) setPlaying(p => !p) }
      else if (e.key === 'ArrowLeft') { setTime(t => clamp(t - 1, 0, job?.duration ?? 0)) }
      else if (e.key === 'ArrowRight') { setTime(t => clamp(t + 1, 0, job?.duration ?? 0)) }
      else if (e.key === 'Escape') {
        if (dialog) setDialog(null)
        else if (deleteConfirmId) setDeleteConfirmId(null)
        else setSelectedSegId(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [job?.duration, dialog, deleteConfirmId])

  function updateSegment(segId: string, patch: Partial<Segment>) {
    if (!job) return
    setJobs(js => js.map(j => j.id !== job.id ? j : { ...j, segments: j.segments.map(s => s.id === segId ? { ...s, ...patch } : s) }))
  }

  function selectJob(id: string) {
    const j = jobs.find(x => x.id === id)
    if (!j) return
    setSelectedJobId(id)
    setPlaying(false)
    const first = j.segments[0]
    setSelectedSegId(first?.id ?? null)
    setTime(first?.start ?? 0)
    setPreviewMode('src')
    setMobileLibOpen(false)
  }

  function selectSegment(segId: string) {
    setSelectedSegId(segId)
    const s = job?.segments.find(x => x.id === segId)
    if (s) setTime(s.start)
  }

  function seekTimeline(clientX: number) {
    if (!job || !timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = clientX - rect.left + timelineRef.current.scrollLeft
    const t = clamp(x / zoom, 0, job.duration)
    setTime(t)
    const covering = job.segments.find(s => t >= s.start && t <= s.end)
    if (covering) setSelectedSegId(covering.id)
  }

  function runPipeline(jobId: string) {
    let i = 0
    const step = () => {
      const stage = PIPELINE_STAGES[i]
      setJobs(js => js.map(j => j.id === jobId ? { ...j, status: stage.status, progress: stage.progress } : j))
      if (stage.status === 'done') {
        setJobs(js => js.map(j => j.id === jobId ? { ...j, hasResult: true } : j))
        toast.ok('Dubbing complete')
        return
      }
      i++
      setTimeout(step, 700 + Math.random() * 700)
    }
    step()
  }

  function resynthesize(segId: string) {
    setResynthingId(segId)
    setTimeout(() => {
      updateSegment(segId, { status: 'ok', hasAudio: true })
      setResynthingId(null)
      toast.ok('Line resynthesized')
    }, 1100)
  }

  function applyChanges() {
    if (!job) return
    setApplying(true)
    setJobs(js => js.map(j => j.id === job.id ? { ...j, status: 'muxing', progress: 86 } : j))
    setTimeout(() => {
      setJobs(js => js.map(j => j.id === job.id ? { ...j, status: 'done', progress: 100, hasResult: true } : j))
      setApplying(false)
      setPreviewMode('dub')
      toast.ok('Remuxed')
    }, 1400)
  }

  function requestDelete(id: string) { setDeleteConfirmId(id) }

  function confirmDelete(id: string) {
    setJobs(js => {
      const target = js.find(j => j.id === id)
      if (target?.videoUrl) URL.revokeObjectURL(target.videoUrl)
      const next = js.filter(j => j.id !== id)
      if (selectedJobId === id) {
        const n = next[0]
        setSelectedJobId(n?.id ?? '')
        setSelectedSegId(n?.segments[0]?.id ?? null)
        setTime(n?.segments[0]?.start ?? 0)
      }
      return next
    })
    setDeleteConfirmId(null)
    toast.ok('Job deleted')
  }

  function toggleFavorite(id: string) {
    setJobs(js => js.map(j => j.id === id ? { ...j, favorite: !j.favorite } : j))
  }

  function handleExport() {
    if (!job?.hasResult) return
    const base = job.filename.replace(/\.[^.]+$/, '')
    const manifest = `Voxora Dubbing Studio export\nSource: ${job.filename}\nLanguage: ${langLabel(job.sourceLang)} → ${langLabel(job.targetLang)}\nVoice: ${VOICES.find(v => v.id === job.voiceId)?.label}\nSegments: ${job.segments.length}\n`
    const blob = new Blob([manifest], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `dubbed_${base}.txt`; a.click()
    URL.revokeObjectURL(url)
    toast.ok(`Exported dubbed_${job.filename}`)
  }

  function submitDialog(form: { voiceId: VoiceId; engine: EngineId; sourceLang: 'auto' | LangCode; targetLang: LangCode; file: File | null; uploadDuration: number | null; videoUrl: string | null; posterImage: string | null }) {
    if (!dialog) return
    if (dialog.mode === 'new') {
      const filename = form.file?.name ?? `upload-${Date.now()}.mp4`
      const isUpload = !!form.file
      const duration = form.uploadDuration ?? 18
      const segments = isUpload ? buildPlaceholderSegments(duration, form.targetLang) : buildDemoSegments(form.targetLang)
      const newJob: Job = {
        id: uid(), filename, duration, poster: POSTER_GRADIENTS[jobs.length % POSTER_GRADIENTS.length],
        posterImage: form.posterImage, videoUrl: form.videoUrl, isUpload,
        sourceLang: form.sourceLang === 'auto' ? 'en' : form.sourceLang, targetLang: form.targetLang,
        voiceId: form.voiceId, engine: form.engine, status: 'queued', progress: 0, error: null,
        segments, hasResult: false, favorite: false,
      }
      setJobs(js => [newJob, ...js])
      setSelectedJobId(newJob.id); setSelectedSegId(segments[0]?.id ?? null); setTime(segments[0]?.start ?? 0)
      setPreviewMode('src'); setPlaying(false); setDialog(null)
      runPipeline(newJob.id)
    } else if (dialog.mode === 'retry' && dialog.retryJobId) {
      const orig = jobs.find(j => j.id === dialog.retryJobId)
      if (!orig) return
      const segments = orig.isUpload ? buildPlaceholderSegments(orig.duration, form.targetLang) : buildDemoSegments(form.targetLang)
      const newJob: Job = {
        ...orig, id: uid(), sourceLang: form.sourceLang === 'auto' ? orig.sourceLang : form.sourceLang,
        targetLang: form.targetLang, voiceId: form.voiceId, engine: form.engine,
        status: 'queued', progress: 0, error: null, segments, hasResult: false, favorite: false,
      }
      setJobs(js => [newJob, ...js])
      setSelectedJobId(newJob.id); setSelectedSegId(segments[0]?.id ?? null); setTime(segments[0]?.start ?? 0)
      setPreviewMode('src'); setPlaying(false); setDialog(null)
      runPipeline(newJob.id)
    }
  }

  const filteredJobs = useMemo(() => jobs.filter(j => {
    if (libFilter === 'favorites' && !j.favorite) return false
    if (search.trim() && !j.filename.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }), [jobs, libFilter, search])

  const tickStep = zoom >= 100 ? 1 : zoom >= 50 ? 2 : 5
  const ticks = job ? Array.from({ length: Math.floor(job.duration / tickStep) + 1 }, (_, i) => i * tickStep) : []
  const timelineWidth = job ? Math.max(job.duration * zoom, 320) : 320

  return (
    <div className="dubstudio">
      {/* ── Stage ────────────────────────────────────────────── */}
      <div className="ds-stage">
        <header className="ds-topbar">
          <button className="ds-icon-btn ds-topbar__clap" onClick={() => setMobileLibOpen(o => !o)} title="Toggle files">
            {ClapperIcon}
          </button>
          <div className="ds-topbar__crumb">
            <span className="ds-topbar__crumb-dim">Projects /</span>
            <span className="ds-topbar__crumb-name">{job ? job.filename : 'No project'}</span>
          </div>
          {job && (
            <span className="ds-lang-tag">{langLabel(job.sourceLang)} → {langLabel(job.targetLang)}</span>
          )}
          <div className="ds-topbar__spacer" />
          {job && job.status !== 'done' && job.status !== 'failed' && (
            <span className="ds-topbar__progress">{job.progress}%</span>
          )}
          <button
            className="btn btn--primary ds-topbar__export"
            disabled={!job?.hasResult}
            onClick={handleExport}
          >
            {icons.download}<span>Export</span>
          </button>
          <button
            className="ds-icon-btn"
            title="Retry"
            disabled={!job}
            onClick={() => job && setDialog({ mode: 'retry', retryJobId: job.id })}
          >
            {icons.redo}
          </button>
          <div className="ds-delete-wrap">
            <button className="ds-icon-btn ds-icon-btn--danger" title="Delete" disabled={!job} onClick={() => job && requestDelete(job.id)}>
              {icons.trash}
            </button>
            {deleteConfirmId === job?.id && (
              <div className="ds-delete-confirm">
                <span>Delete this job?</span>
                <button className="btn btn--ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                <button className="btn btn--danger" onClick={() => job && confirmDelete(job.id)}>Confirm</button>
              </div>
            )}
          </div>
        </header>

        <div className="ds-workspace">
          {/* ── Media library ─────────────────────────────────── */}
          <aside className={`ds-library ${mobileLibOpen ? 'ds-library--open' : ''}`}>
            <div className="ds-library__head">
              <button className="btn btn--primary ds-library__add" onClick={() => setDialog({ mode: 'new' })}>
                {icons.plus}<span>Add files</span>
              </button>
            </div>
            <div className="ds-library__chips">
              {(['all', 'project', 'favorites'] as LibFilter[]).map(f => (
                <button key={f} className={`ds-chip ${libFilter === f ? 'ds-chip--active' : ''}`} onClick={() => setLibFilter(f)}>
                  {f === 'all' ? 'All' : f === 'project' ? 'This project' : 'Favorites'}
                </button>
              ))}
            </div>
            <div className="ds-library__search">
              {icons.search}
              <input placeholder="Search by filename" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="ds-library__grid">
              {filteredJobs.length === 0 && <div className="ds-library__empty">No files match.</div>}
              {filteredJobs.map(j => {
                const running = j.status !== 'done' && j.status !== 'failed'
                const stageLabel = PIPELINE_STAGES.find(s => s.status === j.status)?.label ?? j.status
                return (
                  <button key={j.id} className={`ds-card ${j.id === selectedJobId ? 'ds-card--active' : ''}`} onClick={() => selectJob(j.id)}>
                    <div
                      className="ds-card__thumb"
                      style={j.posterImage ? { background: `center/cover no-repeat url(${j.posterImage})` } : { background: j.poster }}
                    >
                      <span className="ds-card__dur">{fmt(Math.round(j.duration))}</span>
                      {running && <span className="ds-card__stage">{stageLabel}</span>}
                      <button
                        className={`ds-card__fav ${j.favorite ? 'ds-card__fav--on' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleFavorite(j.id) }}
                        title="Favorite"
                      >{icons.star}</button>
                    </div>
                    <div className="ds-card__meta">
                      <span className="ds-card__name">{j.filename}</span>
                      <span className="ds-card__langs">{langLabel(j.sourceLang)} → {langLabel(j.targetLang)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="ds-library__drop" onClick={() => setDialog({ mode: 'new' })}>
              Drop files here or click to upload
            </div>
          </aside>

          {/* ── Monitor + Inspector ───────────────────────────── */}
          <div className="ds-monitorrow">
            <div className="ds-monitor" onClick={() => job && setPlaying(p => !p)}>
              {job ? (
                <>
                  {job.videoUrl ? (
                    <video
                      key={job.id}
                      ref={monitorVideoRef}
                      className="ds-monitor__video"
                      src={job.videoUrl}
                      poster={job.posterImage ?? undefined}
                      muted
                      playsInline
                      onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                      onEnded={() => setPlaying(false)}
                    />
                  ) : (
                    <div className="ds-monitor__frame" style={{ background: job.poster }}>
                      <div className="ds-monitor__glow" style={{ opacity: playing ? 0.85 : 0.55 }} />
                    </div>
                  )}
                  <span className="ds-monitor__tc">{fmtTC(time)} · {previewMode === 'src' ? 'SRC' : 'DUB'}</span>
                  {activeCaption && (
                    <span className="ds-monitor__caption">
                      {previewMode === 'src'
                        ? activeCaption.original
                        : (activeCaption.muted ? activeCaption.original : activeCaption.translated)}
                    </span>
                  )}
                  {job.status !== 'done' && job.status !== 'failed' && (
                    <div className="ds-monitor__pipeline">
                      <div className="ds-monitor__pipeline-bar"><div style={{ width: `${job.progress}%` }} /></div>
                      <span>{PIPELINE_STAGES.find(s => s.status === job.status)?.label}</span>
                    </div>
                  )}
                  {!playing && <span className="ds-monitor__playhint">{icons.play}</span>}
                </>
              ) : (
                <span className="ds-monitor__empty">Add a video to start dubbing</span>
              )}
            </div>

            <aside className="ds-inspector">
              {!job && <div className="ds-inspector__empty">Select a clip on the timeline to see details here.</div>}
              {job && !segment && (
                <div className="ds-inspector__job">
                  <h4>{job.filename}</h4>
                  <dl>
                    <dt>Voice</dt><dd>{VOICES.find(v => v.id === job.voiceId)?.label}</dd>
                    <dt>Engine</dt><dd>{ENGINES.find(e => e.id === job.engine)?.label}</dd>
                    <dt>Status</dt><dd className="ds-cap">{job.status}</dd>
                  </dl>
                  <p className="ds-inspector__hint">Select a line on the timeline to edit its translation, swap the voice, or mute it.</p>
                </div>
              )}
              {job && segment && (
                <div className="ds-inspector__seg">
                  <div className="ds-inspector__row">
                    <span className="ds-inspector__range">{fmt(Math.round(segment.start))} – {fmt(Math.round(segment.end))}</span>
                    {segment.stretch !== 1 && <span className="ds-inspector__stretch">{segment.stretch.toFixed(2)}×</span>}
                    <span className={`ds-status-chip ds-status-chip--${segment.status}`}>{STATUS_CHIP[segment.status]}</span>
                  </div>

                  <label className="ds-field">
                    <span>Original</span>
                    <div className="ds-field__readonly">{segment.original}</div>
                  </label>

                  <label className="ds-field">
                    <span>Translated line</span>
                    <textarea
                      value={draft}
                      disabled={segment.muted || resynthingId === segment.id}
                      onChange={e => setDraft(e.target.value)}
                      onBlur={() => updateSegment(segment.id, { translated: draft })}
                      rows={3}
                    />
                  </label>

                  <label className="ds-field">
                    <span>Voice override</span>
                    <select
                      value={segment.voiceId ?? ''}
                      onChange={e => updateSegment(segment.id, { voiceId: (e.target.value || null) as VoiceId | null })}
                    >
                      <option value="">Job default ({VOICES.find(v => v.id === job.voiceId)?.label})</option>
                      {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </label>

                  <label className="ds-field ds-field--row">
                    <input type="checkbox" checked={segment.muted} onChange={e => updateSegment(segment.id, { muted: e.target.checked })} />
                    <span>Mute — keep original audio for this line</span>
                  </label>

                  <div className="ds-inspector__actions">
                    <button className="btn btn--ghost" disabled={resynthingId === segment.id} onClick={() => resynthesize(segment.id)}>
                      {resynthingId === segment.id ? 'Resynthesizing…' : 'Resynthesize'}
                    </button>
                    <button className="btn btn--primary" disabled={applying} onClick={applyChanges}>
                      {applying ? 'Applying…' : 'Apply changes'}
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* ── Mobile compact strip ──────────────────────────── */}
          <div className="ds-mobstrip">
            {segment ? (
              <>
                <span className="ds-mobstrip__line">{segment.muted ? segment.original : segment.translated}</span>
                <button className="ds-icon-btn" onClick={() => updateSegment(segment.id, { muted: !segment.muted })}>
                  {segment.muted ? icons.silence : icons.volume}
                </button>
                <button className="ds-icon-btn" disabled={resynthingId === segment.id} onClick={() => resynthesize(segment.id)}>{icons.bolt}</button>
              </>
            ) : <span className="ds-mobstrip__line ds-mobstrip__line--dim">No line selected</span>}
          </div>

          {/* ── Transport ──────────────────────────────────────── */}
          <div className="ds-transport">
            <button className="ds-icon-btn" title="Skip back" disabled={!job} onClick={() => { setTime(0); setPlaying(false) }}>{icons.rewind}</button>
            <button className="ds-icon-btn ds-icon-btn--play" title="Play / pause" disabled={!job} onClick={() => setPlaying(p => !p)}>
              {playing ? icons.pause : icons.play}
            </button>
            <button className="ds-icon-btn" title="Stop" disabled={!job} onClick={() => { setTime(0); setPlaying(false) }}>{icons.stop}</button>
            <button
              className="ds-icon-btn"
              title="Mute / unmute selected line"
              disabled={!segment}
              onClick={() => segment && updateSegment(segment.id, { muted: !segment.muted })}
            >
              {segment?.muted ? icons.silence : icons.volume}
            </button>

            <div className="ds-transport__modes">
              <button className={`ds-modebtn ${previewMode === 'src' ? 'ds-modebtn--active' : ''}`} onClick={() => setPreviewMode('src')}>Original</button>
              <button
                className={`ds-modebtn ${previewMode === 'dub' ? 'ds-modebtn--active' : ''}`}
                disabled={!job?.hasResult}
                onClick={() => setPreviewMode('dub')}
              >Dubbed</button>
            </div>

            <div className="ds-transport__zoom">
              {icons.zoomOut}
              <input type="range" min={32} max={160} value={zoom} onChange={e => setZoom(Number(e.target.value))} />
              {icons.zoomIn}
            </div>

            <span className="ds-transport__tc">{job ? `${fmtTC(time)} / ${fmtTC(job.duration)}` : '—'}</span>

            <button className="btn btn--primary ds-transport__newdub" onClick={() => setDialog({ mode: 'new' })}>
              {icons.plus}<span>New dub</span>
            </button>
          </div>

          {/* ── Timeline ───────────────────────────────────────── */}
          <div className="ds-timeline" ref={timelineRef}>
            {job ? (
              <div className="ds-timeline__inner" style={{ width: timelineWidth }}>
                <div className="ds-ruler" onMouseDown={e => seekTimeline(e.clientX)}>
                  {ticks.map(t => (
                    <span key={t} className="ds-ruler__tick" style={{ left: t * zoom }}>{fmt(t)}</span>
                  ))}
                </div>

                <div className="ds-lane ds-lane--orig" onMouseDown={e => { if (e.target === e.currentTarget) seekTimeline(e.clientX) }}>
                  {job.segments.map(s => (
                    <button
                      key={s.id}
                      className={`ds-clip ds-clip--orig ${s.id === selectedSegId ? 'ds-clip--selected' : ''}`}
                      style={{ left: s.start * zoom, width: Math.max(4, (s.end - s.start) * zoom) }}
                      onClick={ev => { ev.stopPropagation(); selectSegment(s.id) }}
                    >
                      {s.id === selectedSegId && <><span className="ds-clip__handle ds-clip__handle--l" /><span className="ds-clip__handle ds-clip__handle--r" /></>}
                      <span className="ds-clip__text">{s.original}</span>
                    </button>
                  ))}
                </div>

                <div className="ds-lane ds-lane--dub" onMouseDown={e => { if (e.target === e.currentTarget) seekTimeline(e.clientX) }}>
                  {job.segments.map(s => (
                    <button
                      key={s.id}
                      className={`ds-clip ds-clip--dub ${s.muted ? 'ds-clip--muted' : ''} ${s.id === selectedSegId ? 'ds-clip--selected' : ''}`}
                      style={{ left: s.start * zoom, width: Math.max(4, (s.end - s.start) * zoom) }}
                      onClick={ev => { ev.stopPropagation(); selectSegment(s.id) }}
                    >
                      {s.id === selectedSegId && <><span className="ds-clip__handle ds-clip__handle--l" /><span className="ds-clip__handle ds-clip__handle--r" /></>}
                      {s.muted ? <span className="ds-clip__muted">muted</span> : (
                        <span className="ds-clip__wave">
                          {barsFor(s.id).map((h, i) => <i key={i} style={{ height: `${h * 100}%` }} />)}
                        </span>
                      )}
                      <span className="ds-clip__text">{s.translated}</span>
                    </button>
                  ))}
                </div>

                <div className="ds-lane ds-lane--video" onMouseDown={e => seekTimeline(e.clientX)}>
                  {Array.from({ length: FILMSTRIP_FRAMES }).map((_, i) => (
                    <div
                      key={i}
                      className="ds-frame"
                      style={job.posterImage
                        ? { background: `center/cover no-repeat url(${job.posterImage})`, filter: `brightness(${0.65 + (i % 5) * 0.07})` }
                        : { filter: `brightness(${0.55 + (i % 5) * 0.09})` }}
                    />
                  ))}
                </div>

                <div className="ds-playhead" style={{ left: time * zoom }} />
              </div>
            ) : (
              <div className="ds-timeline__empty" onClick={() => setDialog({ mode: 'new' })}>Drop files here or click to upload</div>
            )}
          </div>
        </div>
      </div>

      {dialog && (
        <NewDubDialog
          mode={dialog.mode}
          retryJob={dialog.retryJobId ? jobs.find(j => j.id === dialog.retryJobId) ?? null : null}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      )}
    </div>
  )
}

// ── New Dub / Retry modal ──────────────────────────────────────

function captureFrame(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 320
    canvas.height = video.videoHeight || 180
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

function NewDubDialog({
  mode, retryJob, onClose, onSubmit,
}: {
  mode: 'new' | 'retry'
  retryJob: Job | null
  onClose: () => void
  onSubmit: (form: { voiceId: VoiceId; engine: EngineId; sourceLang: 'auto' | LangCode; targetLang: LangCode; file: File | null; uploadDuration: number | null; videoUrl: string | null; posterImage: string | null }) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [uploadDuration, setUploadDuration] = useState<number | null>(null)
  const [posterImage, setPosterImage] = useState<string | null>(null)
  const [voiceId, setVoiceId] = useState<VoiceId>(retryJob?.voiceId ?? 'claribel')
  const [engine, setEngine] = useState<EngineId>(retryJob?.engine ?? 'xtts')
  const [sourceLang, setSourceLang] = useState<'auto' | LangCode>(retryJob?.sourceLang ?? 'auto')
  const [targetLang, setTargetLang] = useState<LangCode>(retryJob?.targetLang ?? 'es')
  const [dragOver, setDragOver] = useState(false)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const submittedRef = useRef(false)
  const urlRef = useRef<string | null>(null)

  // Revoke the blob URL on unmount unless it was handed off to a real job via Start dubbing.
  useEffect(() => () => {
    if (!submittedRef.current && urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  function pickFile(f: File) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(f)
    urlRef.current = url
    setFile(f)
    setVideoUrl(url)
    setUploadDuration(null)
    setPosterImage(null)
  }

  function clearFile() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setFile(null); setVideoUrl(null); setUploadDuration(null); setPosterImage(null)
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) pickFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  function onPreviewLoadedMeta() {
    const v = previewRef.current
    if (!v) return
    const d = v.duration && isFinite(v.duration) ? v.duration : 18
    setUploadDuration(d)
    // Nudge to a representative frame so the captured poster isn't a black first frame.
    v.currentTime = Math.min(d / 3, 3)
  }

  function onPreviewSeeked() {
    const v = previewRef.current
    if (!v) return
    const frame = captureFrame(v)
    if (frame) setPosterImage(frame)
  }

  const canStart = mode === 'retry' || !!file

  function start() {
    submittedRef.current = true
    onSubmit({ voiceId, engine, sourceLang, targetLang, file, uploadDuration, videoUrl, posterImage })
  }

  return (
    <div className="ds-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ds-modal">
        <div className="ds-modal__head">
          <h3>{mode === 'new' ? 'New dub' : 'Dub again'}</h3>
          <button className="ds-icon-btn" onClick={onClose}>{icons.close}</button>
        </div>

        {mode === 'new' ? (
          file ? (
            <div className="ds-preview">
              <video
                ref={previewRef}
                className="ds-preview__video"
                src={videoUrl ?? undefined}
                controls
                muted
                playsInline
                onLoadedMetadata={onPreviewLoadedMeta}
                onSeeked={onPreviewSeeked}
              />
              <div className="ds-preview__meta">
                <span className="ds-preview__name">{file.name}</span>
                <span className="ds-preview__dur">{uploadDuration ? fmtTC(uploadDuration) : 'Reading…'}</span>
                <button type="button" className="btn btn--ghost" onClick={clearFile}>Change file</button>
              </div>
            </div>
          ) : (
            <label
              className={`ds-dropzone ${dragOver ? 'ds-dropzone--over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" hidden onChange={onFilePick} />
              {icons.upload}
              <span>Drop or pick a video</span>
              <span className="ds-dropzone__hint">MP4, MOV, WebM, MKV · max 200 MB</span>
            </label>
          )
        ) : (
          <div className="ds-retrynote">
            <strong>{retryJob?.filename}</strong> will be reused — no re-upload needed.
            <span className="ds-retrynote__prev">Last run: {langLabel(retryJob?.sourceLang ?? 'en')} → {langLabel(retryJob?.targetLang ?? 'es')} · {VOICES.find(v => v.id === retryJob?.voiceId)?.label}</span>
          </div>
        )}

        <label className="ds-field">
          <span>Voice</span>
          <select value={voiceId} onChange={e => setVoiceId(e.target.value as VoiceId)}>
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>

        <div className="ds-field">
          <span>Engine</span>
          <div className="ds-engine-row">
            {ENGINES.map(en => (
              <button
                key={en.id}
                type="button"
                disabled={en.disabled}
                className={`ds-engine-opt ${engine === en.id ? 'ds-engine-opt--active' : ''}`}
                onClick={() => setEngine(en.id)}
              >
                {en.label}
                {en.note && <em>{en.note}</em>}
              </button>
            ))}
          </div>
        </div>

        <div className="ds-modal__langs">
          <label className="ds-field">
            <span>Source language</span>
            <select value={sourceLang} onChange={e => setSourceLang(e.target.value as 'auto' | LangCode)}>
              <option value="auto">Auto-detect</option>
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <label className="ds-field">
            <span>Target language</span>
            <select value={targetLang} onChange={e => setTargetLang(e.target.value as LangCode)}>
              {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>

        <button className="btn btn--primary ds-modal__start" disabled={!canStart} onClick={start}>
          Start dubbing
        </button>
      </div>
    </div>
  )
}
