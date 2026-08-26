import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { icons, LANGUAGES } from '../lib/constants'
import { fmt } from '../lib/audio'
import { toast } from '../lib/toast'
import { useTTSEngine } from '../hooks/useTTSEngine'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { EngineSwitcher } from '../components/EngineSwitcher'
import { DubbingTimelineEditor } from '../components/DubbingTimelineEditor'
import type { VoiceProfile, EngineCaps, VideoProjectAsset, VideoProjectAssetTranscriptSegment } from '../lib/types'
import './dubbing-studio.css'

/**
 * Dubbing Studio — professional video dubbing UI (CapCut-style editor).
 *
 * Wired to the real backend (Aug 25, 2026 pass) — see docs/ENHANCEMENT_TASKS.md
 * task #6b for the audit this closes out. This replaces the mock Job/Segment
 * model that used to live here with the same DubbingJob API DubbingPage.tsx
 * and DubbingTimelineEditor.tsx already used, and reuses (rather than
 * reimplements) DubbingTimelineEditor for the ready_for_review review step —
 * that component already has split/merge/undo-redo/thumbnail-filmstrip/
 * save+finalize wired up and debugged (two regressions were already found
 * and fixed there on Aug 23), so re-deriving that logic a second time in a
 * different UI shell would just reintroduce the same bug surface with no
 * upside. DubbingPage.tsx and VideoStudioPage.tsx are retired in this same
 * pass — this page is now the only dubbing UI in the app.
 *
 * Known gaps vs. the old mock (because the real backend doesn't support
 * them, not because they were skipped):
 *  - No per-segment "Resynthesize" — the backend has no single-line
 *    resynthesis endpoint. Editing happens during ready_for_review
 *    (Save changes) and (re)synthesis happens for the whole job at once
 *    (Generate dubbed video / Retry).
 *  - No segment/waveform view once a job is 'done' — the backend only
 *    exposes the segment breakdown while a job is 'ready_for_review'
 *    (matches DubbingPage's own capability).
 *  - Card thumbnails are a real captured frame only for videos uploaded
 *    in this browser session (captured client-side before upload); jobs
 *    loaded from a fresh page load fall back to a color placeholder,
 *    since the backend doesn't store/serve a poster image.
 *  - "Favorite" is a client-only, localStorage-backed marker — there's no
 *    backend field for it.
 */

// ── Types ─────────────────────────────────────────────────────────

type EngineId = 'xtts' | 'f5' | 'chatterbox'
type JobStatus = 'queued' | 'transcribing' | 'translating' | 'ready_for_review' | 'synthesizing' | 'muxing' | 'done' | 'failed'
type PreviewMode = 'src' | 'dub'
type LibFilter = 'all' | 'favorites'

interface JobRow {
  job_id: string
  status: JobStatus
  progress: number
  error: string | null
  original_filename: string | null
  source_language: string | null
  target_language: string
  voice_profile_id: string
  voice_name: string
  engine: string | null
  segment_count: number | null
  segment_overflow_count: number | null
  duration_seconds: number | null
  has_source: boolean
  has_result: boolean
  created_at: string | null
}

// ── Static data / constants (carried over from DubbingPage.tsx,
//    which this page now supersedes) ─────────────────────────────

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024   // mirrors VideoDubbingController::MAX_UPLOAD_KB (204800 KB)
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
const LIST_POLL_MS = 6000   // /dubbing is throttled 60/min — 6s stays well under that regardless of job count
const FAVORITES_KEY = 'vo_dubstudio_favorites'

const STAGE_META: Record<JobStatus, { label: string; pct: number }> = {
  queued:           { label: 'Queued',                    pct: 0 },
  transcribing:     { label: 'Transcribing audio',        pct: 5 },
  translating:      { label: 'Translating script',        pct: 40 },
  ready_for_review: { label: 'Ready to review',           pct: 90 },
  synthesizing:     { label: 'Synthesizing dubbed voice', pct: 55 },
  muxing:           { label: 'Combining with video',      pct: 90 },
  done:             { label: 'Done',                      pct: 100 },
  failed:           { label: 'Failed',                    pct: 0 },
}

const POSTER_GRADIENTS = [
  'linear-gradient(165deg, #04060c 0%, #0b1730 42%, #163258 68%, #2f5590 100%)',
  'linear-gradient(165deg, #05070d 0%, #0d1a35 42%, #1a3a63 68%, #3a6199 100%)',
  'linear-gradient(165deg, #030509 0%, #0a1428 42%, #12294a 68%, #274a82 100%)',
]

function langLabel(code: string | null): string {
  if (!code) return 'Auto-detect'
  return LANGUAGES.find(l => l.code === code)?.label ?? code.toUpperCase()
}

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '--:--'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function isJobRunning(j: JobRow): boolean {
  return j.status !== 'done' && j.status !== 'failed' && j.status !== 'ready_for_review'
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function saveFavorites(s: Set<string>) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

const CARD_ORDER_KEY = 'vo_dubstudio_card_order'

function loadCardOrder(): string[] {
  try {
    const raw = localStorage.getItem(CARD_ORDER_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCardOrder(order: string[]) {
  try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order)) } catch { /* ignore */ }
}

/**
 * Fetches a job's real thumbnail — the same server-generated filmstrip
 * sprite DubbingTimelineEditor uses for its review-timeline frames
 * (GET /dubbing/{jobId}/thumbnails + .../sprite.jpg), except here we only
 * need one frame (the first), so rather than repeat the filmstrip's
 * CSS background-position/background-size tiling approach on every card,
 * we crop just that one tile out with a canvas once and cache the result
 * as a small data URL — same shape as the client-captured posterImage,
 * so both can share one rendering path on the card.
 */
async function fetchRealThumbnail(jobId: string): Promise<string | null> {
  try {
    const [meta, spriteBlob] = await Promise.all([
      api.fetchDubbingThumbnailMeta(jobId),
      api.fetchDubbingThumbnailSprite(jobId),
    ])
    const spriteUrl = URL.createObjectURL(spriteBlob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = reject
        el.src = spriteUrl
      })
      const canvas = document.createElement('canvas')
      canvas.width = meta.thumb_width
      canvas.height = meta.thumb_height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // Frame 0 lives at column 0, row 0 of the sprite — no offset needed.
      ctx.drawImage(img, 0, 0, meta.thumb_width, meta.thumb_height, 0, 0, meta.thumb_width, meta.thumb_height)
      return canvas.toDataURL('image/jpeg', 0.75)
    } finally {
      URL.revokeObjectURL(spriteUrl)
    }
  } catch {
    // Source video may have been pruned, job may still be queued with no
    // frames extractable yet, etc. — card falls back to the gradient.
    return null
  }
}

// ── Small local icon (not in the shared set) ────────────────────

const ClapperIcon = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="7.5" width="14" height="9.5" rx="1.4" />
    <path d="M3 7.5l1.6-4h11l1.4 4M6 3.5l1.2 4M10 3.5l1.2 4M14 3.5l1.2 4" />
  </svg>
)

// ── Component ────────────────────────────────────────────────────

export function DubbingStudioPage({ voiceProfiles, engineCaps, videoProjectId, onBackToProjects }: {
  voiceProfiles: VoiceProfile[]
  engineCaps?: EngineCaps
  /** Task #15 (Video Studio) Phase 1 — scopes the media library to one project's bin and tags new uploads with it. Null/omitted falls back to the pre-Phase-1 flat "every job I've ever submitted" list, for any stale restored session predating this prop (see App.tsx's openVideoProject docblock). */
  videoProjectId?: string | null
  /** Task #15 Phase 1 — makes the "Video Projects /" breadcrumb a real link back to VideoProjectsPage instead of decorative text. Omitted in the same legacy/unscoped case as videoProjectId. */
  onBackToProjects?: () => void
}) {
  const caps: EngineCaps = engineCaps ?? { xtts: false, f5: false }
  const { engine, setEngine } = useTTSEngine()

  // ── Jobs list — real jobs, polled the same way DubbingPage did ────
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [listLoaded, setListLoaded] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshList = useCallback(async () => {
    try {
      const res = await api.listDubbingJobs(videoProjectId ?? undefined) as { jobs: JobRow[] }
      setJobs(res.jobs ?? [])
    } catch {
      // Transient network hiccup — next poll tick will retry.
    } finally {
      setListLoaded(true)
    }
  }, [videoProjectId])

  useEffect(() => {
    refreshList()
    pollRef.current = setInterval(refreshList, LIST_POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refreshList])

  // ── Bin assets — task #15 Phase 2 (uploads) + Phase 4 (extract/
  // resynthesize). Plain (not-yet-dubbed) uploads live in
  // video_project_assets, separate from the DubbingJob-backed cards
  // above. Only meaningful with a project open (assets are inherently
  // project-scoped — see the migration). Phase 2's addAsset() is
  // synchronous so didn't need polling on its own, but Phase 4's
  // extractAudio()/resynthesize() run as background jobs — see the
  // separate poll effect below for why refreshAssets() now DOES get
  // polled, unlike when this comment was first written.
  const [assets, setAssets] = useState<VideoProjectAsset[]>([])

  const refreshAssets = useCallback(async () => {
    if (!videoProjectId) { setAssets([]); return }
    try {
      const res = await api.fetchVideoProject(videoProjectId) as { assets?: VideoProjectAsset[] }
      setAssets(res.assets ?? [])
    } catch {
      // Transient network hiccup — next explicit upload/delete will retry via its own call.
    }
  }, [videoProjectId])

  useEffect(() => { refreshAssets() }, [refreshAssets])

  // Task #15 Phase 4 — poll only while something is actually in flight
  // (an extracted_audio/synthesized_audio asset still 'processing'); an
  // all-ready/failed bin has nothing left to watch for, so this doesn't
  // run a second permanent interval alongside the jobs list's.
  useEffect(() => {
    if (!assets.some(a => a.status === 'processing')) return
    const id = setInterval(refreshAssets, LIST_POLL_MS)
    return () => clearInterval(id)
  }, [assets, refreshAssets])

  // Assets not already represented by a job card above (a dubbed/dubbing
  // asset shows through its DubbingJob card instead — see the jobs list;
  // rendering both would duplicate the same clip twice in the library).
  const plainAssets = useMemo(() => assets.filter(a => !a.dubbing_job_id), [assets])

  const [uploadingCount, setUploadingCount] = useState(0)
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null)

  async function uploadFiles(files: FileList | File[]) {
    if (!videoProjectId) return
    const list = Array.from(files)
    if (list.length === 0) return
    setUploadingCount(c => c + list.length)
    // Sequential, not Promise.all: addAsset() is throttled 5/min server-side
    // (see routes/api.php) — firing many uploads in parallel would just
    // trip that limit for large multi-file drops instead of uploading faster.
    for (const file of list) {
      try {
        await api.addVideoProjectAsset(videoProjectId, file)
      } catch (e) {
        toast.err(e instanceof ApiError ? `${file.name}: ${e.message}` : `${file.name}: upload failed.`)
      } finally {
        setUploadingCount(c => Math.max(0, c - 1))
      }
    }
    refreshAssets()
  }

  function triggerFilePicker() {
    bulkFileInputRef.current?.click()
  }

  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null)
  async function deleteAsset(assetId: string) {
    if (!videoProjectId) return
    setDeletingAssetId(assetId)
    try {
      await api.deleteVideoProjectAsset(videoProjectId, assetId)
      setAssets(prev => prev.filter(a => a.id !== assetId))
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to delete file.')
    } finally {
      setDeletingAssetId(null)
    }
  }

  // Task #15 Phase 4, step 1 — "Extract audio & clone voice". No dialog
  // needed for this step (unlike dubClip()'s 'dub' mode) — extraction
  // takes no parameters, it's the resynthesize step afterward that needs
  // a voice/language picker, once there's a transcript to review.
  const [extractingAssetId, setExtractingAssetId] = useState<string | null>(null)
  async function extractAudio(assetId: string) {
    if (!videoProjectId) return
    setExtractingAssetId(assetId)
    try {
      await api.extractVideoProjectAudio(videoProjectId, assetId)
      refreshAssets()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to start audio extraction.')
    } finally {
      setExtractingAssetId(null)
    }
  }

  // Task #15 Phase 4, review step — which extracted_audio asset's
  // transcript is currently open in TranscriptReviewDialog, if any.
  const [transcriptAssetId, setTranscriptAssetId] = useState<string | null>(null)

  // Lazily backfill real thumbnails for any job that doesn't already have
  // a client-captured poster (i.e. everything from before this page load).
  // Capped to 3 concurrent requests so a big library doesn't slam the
  // thumbnails endpoint the moment the list loads — it's cheap after the
  // first call per job (server caches the sprite), but the *first* call
  // per job still does a real ffmpeg extraction.
  useEffect(() => {
    const pending = jobs.filter(j =>
      j.has_source &&
      !posterImages[j.job_id] &&
      !realThumbnails[j.job_id] &&
      !thumbFetchState.current.has(j.job_id)
    )
    if (pending.length === 0) return

    let cancelled = false
    const CONCURRENCY = 3
    let cursor = 0

    async function worker() {
      while (!cancelled) {
        const j = pending[cursor++]
        if (!j) return
        thumbFetchState.current.add(j.job_id)
        const url = await fetchRealThumbnail(j.job_id)
        if (!cancelled && url) setRealThumbnails(prev => ({ ...prev, [j.job_id]: url }))
      }
    }
    for (let i = 0; i < CONCURRENCY; i++) worker()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('src')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [libFilter, setLibFilter] = useState<LibFilter>('all')
  const [search, setSearch] = useState('')
  const [mobileLibOpen, setMobileLibOpen] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'new' | 'retry' | 'dub'; retryJobId?: string; dubAssetId?: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())

  // Real preview media — fetched blobs, one per job, cached across selections.
  const [previewUrls, setPreviewUrls] = useState<Record<string, { source?: string; result?: string }>>({})
  const [previewLoading, setPreviewLoading] = useState(false)
  // Client-side captured poster frames — only known for videos uploaded this session.
  const [posterImages, setPosterImages] = useState<Record<string, string>>({})
  // Real server-side thumbnails (fetched lazily, see effect below) — fills
  // in for jobs posterImages doesn't cover, i.e. anything loaded from a
  // fresh page load rather than uploaded this session.
  const [realThumbnails, setRealThumbnails] = useState<Record<string, string>>({})
  const thumbFetchState = useRef<Set<string>>(new Set())   // job_ids already fetched or in flight, this session

  // Manual card order (drag-and-drop) — client-only, persisted locally.
  // Backend has no "display order" concept for dubbing jobs; this is purely
  // an organizational aid layered on top of the real job list.
  const [cardOrder, setCardOrder] = useState<string[]>(() => loadCardOrder())
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const monitorVideoRef = useRef<HTMLVideoElement | null>(null)

  const job = jobs.find(j => j.job_id === selectedJobId) ?? null
  const activeUrls = job ? previewUrls[job.job_id] : undefined
  const activeSrc = previewMode === 'dub' ? activeUrls?.result : activeUrls?.source

  // Revoke every still-live blob URL when the studio unmounts.
  const previewUrlsRef = useRef(previewUrls)
  useEffect(() => { previewUrlsRef.current = previewUrls }, [previewUrls])
  useEffect(() => () => {
    Object.values(previewUrlsRef.current).forEach(u => {
      if (u.source) URL.revokeObjectURL(u.source)
      if (u.result) URL.revokeObjectURL(u.result)
    })
  }, [])

  // ── Real preview media loading (mirrors DubbingPage's loadPreviewMedia) ──
  const loadPreviewMedia = useCallback(async (j: JobRow) => {
    // The review timeline (ready_for_review) fetches the source video itself
    // via DubbingTimelineEditor, and isn't shown through this monitor at all.
    if (j.status === 'ready_for_review') return

    const cached = previewUrls[j.job_id]
    const needResult = j.has_result && !cached?.result
    const needSource = j.has_source && !cached?.source
    if (!needResult && !needSource) return

    setPreviewLoading(true)
    try {
      const [resultBlob, sourceBlob] = await Promise.all([
        needResult ? api.fetchDubbingResult(j.job_id).catch(() => null) : Promise.resolve(null),
        needSource ? api.fetchDubbingSource(j.job_id).catch(() => null) : Promise.resolve(null),
      ])
      setPreviewUrls(prev => ({
        ...prev,
        [j.job_id]: {
          source: sourceBlob ? URL.createObjectURL(sourceBlob) : prev[j.job_id]?.source,
          result: resultBlob ? URL.createObjectURL(resultBlob) : prev[j.job_id]?.result,
        },
      }))
    } finally {
      setPreviewLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectJob(id: string) {
    const j = jobs.find(x => x.job_id === id)
    if (!j) return
    setSelectedJobId(id)
    setPlaying(false)
    setTime(0)
    setPreviewMode(j.has_result ? 'dub' : 'src')
    setMobileLibOpen(false)
    loadPreviewMedia(j)
  }

  // Keep media in sync if the selected job transitions (e.g. finishes)
  // while its panel is already open.
  useEffect(() => {
    if (job) loadPreviewMedia(job)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.job_id, job?.has_result, job?.has_source, job?.status])

  // Real video playback — keep the <video> element's play/pause state in sync.
  useEffect(() => {
    const v = monitorVideoRef.current
    if (!v || !activeSrc) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing, activeSrc])

  // Keyboard shortcuts (ignored while typing)
  useEscapeKey(() => {
    if (dialog) setDialog(null)
    else if (transcriptAssetId) setTranscriptAssetId(null)
    else if (deleteConfirmId) setDeleteConfirmId(null)
  }, !!dialog || !!transcriptAssetId || !!deleteConfirmId)

  useEffect(() => {
    function isTyping(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    }
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target) || dialog || transcriptAssetId) return
      if (e.code === 'Space' && job && activeSrc) { e.preventDefault(); setPlaying(p => !p) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [job, activeSrc, dialog, transcriptAssetId])

  function toggleFavorite(id: string) {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      saveFavorites(next)
      return next
    })
  }

  function reorderCards(draggedId: string, targetId: string) {
    if (draggedId === targetId) return
    setCardOrder(prev => {
      // Base ordering: whatever's already explicit, then every job the
      // user hasn't touched yet, newest-first (jobs' own list order).
      const known = new Set(prev)
      const base = [...prev, ...jobs.map(j => j.job_id).filter(id => !known.has(id))]
      const from = base.indexOf(draggedId)
      const to = base.indexOf(targetId)
      if (from === -1 || to === -1) return prev
      const next = [...base]
      next.splice(from, 1)
      next.splice(to, 0, draggedId)
      saveCardOrder(next)
      return next
    })
  }

  function requestDelete(id: string) { setDeleteConfirmId(id) }

  async function confirmDelete(id: string) {
    setDeletingId(id)
    try {
      await api.deleteDubbingJob(id)
      setJobs(js => js.filter(j => j.job_id !== id))
      setPreviewUrls(prev => {
        const { [id]: gone, ...rest } = prev
        if (gone?.source) URL.revokeObjectURL(gone.source)
        if (gone?.result) URL.revokeObjectURL(gone.result)
        return rest
      })
      if (selectedJobId === id) setSelectedJobId(null)
      toast.ok('Job deleted')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not delete this job.')
    } finally {
      setDeletingId(null)
      setDeleteConfirmId(null)
    }
  }

  async function handleExport() {
    if (!job?.has_result) return
    try {
      const cached = previewUrls[job.job_id]?.result
      const blob = cached ? await fetch(cached).then(r => r.blob()) : await api.fetchDubbingResult(job.job_id)
      const url = cached ?? URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dubbed_${job.original_filename ?? job.job_id}.mp4`
      a.click()
      if (!cached) URL.revokeObjectURL(url)
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Download failed.')
    }
  }

  const filteredJobs = useMemo(() => {
    const filtered = jobs.filter(j => {
      if (libFilter === 'favorites' && !favorites.has(j.job_id)) return false
      if (search.trim() && !(j.original_filename ?? '').toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
    // Manual drag order wins where the user has set one; anything not yet
    // touched keeps the API's own (newest-first) relative order, and sorts
    // ahead of anything the user HAS manually ordered — a brand new job
    // shouldn't get buried by an old manual arrangement.
    if (cardOrder.length === 0) return filtered
    const rank = new Map(cardOrder.map((id, i) => [id, i]))
    return [...filtered].sort((a, b) => {
      const ra = rank.get(a.job_id)
      const rb = rank.get(b.job_id)
      if (ra === undefined && rb === undefined) return 0
      if (ra === undefined) return -1
      if (rb === undefined) return 1
      return ra - rb
    })
  }, [jobs, libFilter, search, favorites, cardOrder])

  return (
    <div className="dubstudio">
      {/* ── Stage ────────────────────────────────────────────── */}
      <div className="ds-stage">
        <header className="ds-topbar">
          <button className="ds-icon-btn ds-topbar__clap" onClick={() => setMobileLibOpen(o => !o)} title="Toggle files">
            {ClapperIcon}
          </button>
          <div className="ds-topbar__crumb">
            {onBackToProjects ? (
              <button className="ds-topbar__crumb-dim ds-topbar__crumb-link" onClick={onBackToProjects} type="button">
                Video Projects /
              </button>
            ) : (
              <span className="ds-topbar__crumb-dim">Video Projects /</span>
            )}
            <span className="ds-topbar__crumb-name">{job ? (job.original_filename ?? 'Untitled') : 'No project'}</span>
          </div>
          {job && (
            <span className="ds-lang-tag">{langLabel(job.source_language)} → {langLabel(job.target_language)}</span>
          )}
          <div className="ds-topbar__spacer" />
          {job && isJobRunning(job) && (
            <span className="ds-topbar__progress">{job.progress ?? STAGE_META[job.status].pct}%</span>
          )}
          <button
            className="btn btn--primary ds-topbar__export"
            disabled={!job?.has_result}
            onClick={handleExport}
          >
            {icons.download}<span>Export</span>
          </button>
          <button
            className="ds-icon-btn"
            title="Retry"
            disabled={!job || !job.has_source}
            onClick={() => job && setDialog({ mode: 'retry', retryJobId: job.job_id })}
          >
            {icons.redo}
          </button>
          <div className="ds-delete-wrap">
            <button className="ds-icon-btn ds-icon-btn--danger" title="Delete" disabled={!job} onClick={() => job && requestDelete(job.job_id)}>
              {icons.trash}
            </button>
            {deleteConfirmId === job?.job_id && (
              <div className="ds-delete-confirm">
                <span>Delete this job?</span>
                <button className="btn btn--ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                <button className="btn btn--danger" disabled={deletingId === job?.job_id} onClick={() => job && confirmDelete(job.job_id)}>
                  {deletingId === job?.job_id ? <span className="spinner" /> : 'Confirm'}
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="ds-workspace">
          {/* ── Media library ─────────────────────────────────── */}
          <aside className={`ds-library ${mobileLibOpen ? 'ds-library--open' : ''}`}>
            <div className="ds-library__head">
              <button
                className="btn btn--primary ds-library__add"
                onClick={() => (videoProjectId ? triggerFilePicker() : setDialog({ mode: 'new' }))}
                title={videoProjectId ? 'Upload video, audio, or image files to this project' : undefined}
              >
                {icons.plus}<span>Add files</span>
              </button>
              {/* Hidden picker backing the button above and the drop zone
                  below — task #15 Phase 2. Only used in project context;
                  see the button's onClick for the legacy (no project)
                  fallback to the dub dialog, kept for any pre-Phase-1
                  restored session (see DubbingStudioPage's own props docblock). */}
              <input
                ref={bulkFileInputRef}
                type="file"
                multiple
                accept="video/*,audio/*,image/*"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
              />
            </div>
            <div className="ds-library__chips">
              {(['all', 'favorites'] as LibFilter[]).map(f => (
                <button key={f} className={`ds-chip ${libFilter === f ? 'ds-chip--active' : ''}`} onClick={() => setLibFilter(f)}>
                  {f === 'all' ? 'All' : 'Favorites'}
                </button>
              ))}
            </div>
            <div className="ds-library__search">
              {icons.search}
              <input placeholder="Search by filename" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="ds-library__grid">
              {!listLoaded && <div className="ds-library__empty">Loading…</div>}
              {listLoaded && filteredJobs.length === 0 && plainAssets.length === 0 && uploadingCount === 0 && (
                <div className="ds-library__empty">No files match.</div>
              )}
              {filteredJobs.map((j, i) => {
                const running = isJobRunning(j)
                const stageLabel = STAGE_META[j.status]?.label ?? j.status
                // Prefer a client-captured frame (instant, this-session
                // uploads only) over the real server thumbnail, then fall
                // back to the color placeholder while neither is ready yet.
                const poster = posterImages[j.job_id] ?? realThumbnails[j.job_id]
                return (
                  <button
                    key={j.job_id}
                    className={`ds-card ${j.job_id === selectedJobId ? 'ds-card--active' : ''} ${draggingId === j.job_id ? 'ds-card--dragging' : ''} ${dragOverId === j.job_id ? 'ds-card--dragover' : ''}`}
                    onClick={() => selectJob(j.job_id)}
                    draggable
                    onDragStart={e => { setDraggingId(j.job_id); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                    onDragOver={e => { e.preventDefault(); if (draggingId && draggingId !== j.job_id) setDragOverId(j.job_id) }}
                    onDragLeave={() => setDragOverId(prev => (prev === j.job_id ? null : prev))}
                    onDrop={e => { e.preventDefault(); if (draggingId) reorderCards(draggingId, j.job_id); setDraggingId(null); setDragOverId(null) }}
                  >
                    <div
                      className="ds-card__thumb"
                      style={poster ? { background: `center/cover no-repeat url(${poster})` } : { background: POSTER_GRADIENTS[i % POSTER_GRADIENTS.length] }}
                    >
                      <span className="ds-card__dur">{fmtDuration(j.duration_seconds)}</span>
                      {running && <span className="ds-card__stage">{stageLabel}</span>}
                      {j.status === 'ready_for_review' && <span className="ds-card__stage">Ready to review</span>}
                      {j.status === 'failed' && <span className="ds-card__stage">Failed</span>}
                      <button
                        className={`ds-card__fav ${favorites.has(j.job_id) ? 'ds-card__fav--on' : ''}`}
                        onClick={e => { e.stopPropagation(); toggleFavorite(j.job_id) }}
                        title="Favorite"
                      >{icons.star}</button>
                    </div>
                    <div className="ds-card__meta">
                      <span className="ds-card__name">{j.original_filename ?? 'Untitled'}</span>
                      <span className="ds-card__langs">{langLabel(j.source_language)} → {langLabel(j.target_language)}</span>
                    </div>
                  </button>
                )
              })}

              {/* Task #15 Phase 2 — plain bin assets (not yet dubbed):
                  images, audio, and videos uploaded via "Add files" that
                  haven't had "Dub this clip" run on them. No selection/
                  preview interaction wired yet — that's Phase 3 (dubClip())
                  and Phase 5 (timeline); Phase 2 is upload+list+delete only. */}
              {plainAssets.map(a => (
                <div key={a.id} className="ds-card ds-card--asset">
                  <div className="ds-card__thumb" style={{ background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                    {a.kind === 'image' ? (
                      <img src={api.videoProjectAssetFileUrl(videoProjectId!, a.id)} alt={a.original_filename ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span>{a.kind === 'audio' ? '🎵' : '🎞️'}</span>
                    )}
                    {a.duration_seconds != null && <span className="ds-card__dur">{fmtDuration(a.duration_seconds)}</span>}
                    <button
                      className="ds-card__fav"
                      onClick={e => { e.stopPropagation(); deleteAsset(a.id) }}
                      title="Delete file"
                      disabled={deletingAssetId === a.id}
                    >
                      {deletingAssetId === a.id ? <span className="spinner" style={{ width: 9, height: 9 }} /> : icons.trash}
                    </button>
                  </div>
                  <div className="ds-card__meta">
                    <span className="ds-card__name">{a.original_filename ?? 'Untitled'}</span>
                    {/* Task #15 Phase 3/4 — a plain video asset gets both
                        "Dub this clip" and "Extract audio & clone voice";
                        audio/image assets get their own status/action
                        below instead. */}
                    {a.kind === 'video' && (
                      <div className="ds-card__btnrow">
                        <button
                          type="button"
                          className="btn btn--ghost ds-card__dubbtn"
                          onClick={e => { e.stopPropagation(); setDialog({ mode: 'dub', dubAssetId: a.id }) }}
                        >
                          Dub this clip
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost ds-card__dubbtn"
                          onClick={e => { e.stopPropagation(); extractAudio(a.id) }}
                          disabled={extractingAssetId === a.id}
                        >
                          {extractingAssetId === a.id ? 'Starting…' : 'Clone voice'}
                        </button>
                      </div>
                    )}
                    {a.kind === 'audio' && a.source === 'extracted_audio' && (
                      a.status === 'processing' ? (
                        <span className="ds-card__langs">Transcribing…</span>
                      ) : a.status === 'failed' ? (
                        <span className="ds-card__langs" title={a.error ?? undefined}>Failed — {a.error ? a.error.slice(0, 40) : 'try again'}</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost ds-card__dubbtn"
                          onClick={e => { e.stopPropagation(); setTranscriptAssetId(a.id) }}
                        >
                          Review & clone voice
                        </button>
                      )
                    )}
                    {a.kind === 'audio' && a.source === 'synthesized_audio' && (
                      a.status === 'processing' ? (
                        <span className="ds-card__langs">Synthesizing…</span>
                      ) : a.status === 'failed' ? (
                        <span className="ds-card__langs" title={a.error ?? undefined}>Failed — {a.error ? a.error.slice(0, 40) : 'try again'}</span>
                      ) : (
                        <span className="ds-card__langs">Cloned voice</span>
                      )
                    )}
                    {a.kind === 'audio' && a.source === 'upload' && (
                      <span className="ds-card__langs">Audio</span>
                    )}
                    {a.kind === 'image' && (
                      <span className="ds-card__langs">Image</span>
                    )}
                  </div>
                </div>
              ))}

              {uploadingCount > 0 && (
                <div className="ds-card ds-card--asset" style={{ opacity: 0.6 }}>
                  <div className="ds-card__thumb" style={{ background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="spinner" />
                  </div>
                  <div className="ds-card__meta">
                    <span className="ds-card__name">Uploading {uploadingCount} file{uploadingCount !== 1 ? 's' : ''}…</span>
                  </div>
                </div>
              )}
            </div>
            <div
              className="ds-library__drop"
              onClick={() => (videoProjectId ? triggerFilePicker() : setDialog({ mode: 'new' }))}
              onDragOver={e => { if (videoProjectId) e.preventDefault() }}
              onDrop={e => {
                if (!videoProjectId) return
                e.preventDefault()
                if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
              }}
            >
              Drop files here or click to upload
            </div>
          </aside>

          {/* ── Main panel ───────────────────────────────────── */}
          {job && job.status === 'ready_for_review' ? (
            <div className="ds-review-panel">
              <DubbingTimelineEditor
                key={job.job_id}
                jobId={job.job_id}
                targetLanguage={job.target_language}
                onFinalized={refreshList}
              />
            </div>
          ) : (
            <>
              <div className="ds-monitorrow">
                <div className="ds-monitor" onClick={() => job && activeSrc && setPlaying(p => !p)}>
                  {job ? (
                    <>
                      {activeSrc ? (
                        <video
                          key={`${job.job_id}-${previewMode}`}
                          ref={monitorVideoRef}
                          className="ds-monitor__video"
                          src={activeSrc}
                          muted
                          playsInline
                          onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                          onLoadedMetadata={e => setTime(e.currentTarget.currentTime)}
                          onEnded={() => setPlaying(false)}
                        />
                      ) : (
                        <div className="ds-monitor__frame" style={{ background: POSTER_GRADIENTS[0] }}>
                          <div className="ds-monitor__glow" style={{ opacity: previewLoading ? 0.85 : 0.5 }} />
                        </div>
                      )}
                      <span className="ds-monitor__tc">{fmt(Math.floor(time))} · {previewMode === 'src' ? 'SRC' : 'DUB'}</span>
                      {isJobRunning(job) && (
                        <div className="ds-monitor__pipeline">
                          <div className="ds-monitor__pipeline-bar"><div style={{ width: `${job.progress ?? STAGE_META[job.status].pct}%` }} /></div>
                          <span>{STAGE_META[job.status].label}</span>
                        </div>
                      )}
                      {activeSrc && !playing && <span className="ds-monitor__playhint">{icons.play}</span>}
                    </>
                  ) : (
                    <span className="ds-monitor__empty">Add a video to start dubbing</span>
                  )}
                </div>

                <aside className="ds-inspector">
                  {!job && <div className="ds-inspector__empty">Select a clip on the left to see details here.</div>}
                  {job && (
                    <div className="ds-inspector__job">
                      <h4>{job.original_filename ?? 'Untitled'}</h4>
                      <dl>
                        <dt>Voice</dt><dd>{job.voice_name}</dd>
                        <dt>Engine</dt><dd>{job.engine ?? '—'}</dd>
                        <dt>Status</dt><dd className="ds-cap">{STAGE_META[job.status]?.label ?? job.status}</dd>
                        {typeof job.segment_count === 'number' && (
                          <><dt>Segments</dt><dd>{job.segment_count}</dd></>
                        )}
                      </dl>
                      {job.status === 'failed' && job.error && (
                        <p className="ds-inspector__hint" style={{ color: 'var(--danger, #d9534f)' }}>{job.error}</p>
                      )}
                      {typeof job.segment_overflow_count === 'number' && job.segment_overflow_count > 0 && job.status === 'done' && (
                        <p className="ds-inspector__hint">{job.segment_overflow_count} segment(s) drifted slightly from original timing.</p>
                      )}
                      {job.status === 'done' && (
                        <p className="ds-inspector__hint">Editing is only available while a job is ready for review. Use Retry to dub again with different settings.</p>
                      )}
                    </div>
                  )}
                </aside>
              </div>

              {/* ── Transport ──────────────────────────────────────── */}
              <div className="ds-transport">
                <button className="ds-icon-btn" title="Skip back" disabled={!activeSrc} onClick={() => { if (monitorVideoRef.current) monitorVideoRef.current.currentTime = 0; setTime(0) }}>{icons.rewind}</button>
                <button className="ds-icon-btn ds-icon-btn--play" title="Play / pause" disabled={!activeSrc} onClick={() => setPlaying(p => !p)}>
                  {playing ? icons.pause : icons.play}
                </button>
                <button className="ds-icon-btn" title="Stop" disabled={!activeSrc} onClick={() => { if (monitorVideoRef.current) monitorVideoRef.current.currentTime = 0; setTime(0); setPlaying(false) }}>{icons.stop}</button>

                <div className="ds-transport__modes">
                  <button className={`ds-modebtn ${previewMode === 'src' ? 'ds-modebtn--active' : ''}`} disabled={!job?.has_source} onClick={() => setPreviewMode('src')}>Original</button>
                  <button
                    className={`ds-modebtn ${previewMode === 'dub' ? 'ds-modebtn--active' : ''}`}
                    disabled={!job?.has_result}
                    onClick={() => setPreviewMode('dub')}
                  >Dubbed</button>
                </div>

                <input
                  type="range"
                  className="ds-scrubber"
                  min={0}
                  max={job?.duration_seconds ?? 100}
                  step={0.1}
                  value={time}
                  disabled={!activeSrc}
                  onChange={e => {
                    const t = Number(e.target.value)
                    setTime(t)
                    if (monitorVideoRef.current) monitorVideoRef.current.currentTime = t
                  }}
                  style={{ flex: 1, minWidth: 80 }}
                />

                <span className="ds-transport__tc">{job ? `${fmt(Math.floor(time))} / ${fmtDuration(job.duration_seconds)}` : '—'}</span>

                <button className="btn btn--primary ds-transport__newdub" onClick={() => setDialog({ mode: 'new' })}>
                  {icons.plus}<span>New dub</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {dialog && (
        <NewDubDialog
          mode={dialog.mode}
          retryJob={dialog.retryJobId ? jobs.find(j => j.job_id === dialog.retryJobId) ?? null : null}
          dubAsset={dialog.dubAssetId ? plainAssets.find(a => a.id === dialog.dubAssetId) ?? null : null}
          voiceProfiles={voiceProfiles}
          engine={engine}
          setEngine={setEngine}
          engineCaps={caps}
          videoProjectId={videoProjectId}
          onClose={() => setDialog(null)}
          onSubmitted={(jobId, poster) => {
            if (poster) setPosterImages(p => ({ ...p, [jobId]: poster }))
            setDialog(null)
            refreshList()
            // Task #15 Phase 3 — the source asset's new dubbed sibling
            // needs to disappear from plainAssets right away (it now has
            // a dubbing_job_id), not wait for the next unrelated refetch.
            refreshAssets()
          }}
        />
      )}

      {/* Task #15 Phase 4, review step — matched by looking the asset up
          in `assets` (not `plainAssets`): an extracted_audio asset never
          has a dubbing_job_id, so it's always in plainAssets too, but
          going through the same source list the cards render from keeps
          this in sync with the poll effect without a second lookup path. */}
      {transcriptAssetId && (() => {
        const transcriptAsset = assets.find(a => a.id === transcriptAssetId)
        return transcriptAsset ? (
          <TranscriptReviewDialog
            asset={transcriptAsset}
            voiceProfiles={voiceProfiles}
            engine={engine}
            setEngine={setEngine}
            engineCaps={caps}
            videoProjectId={videoProjectId!}
            onClose={() => setTranscriptAssetId(null)}
            onResynthesized={() => {
              setTranscriptAssetId(null)
              refreshAssets()
            }}
          />
        ) : null
      })()}
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
  mode, retryJob, dubAsset, voiceProfiles, engine, setEngine, engineCaps, videoProjectId, onClose, onSubmitted,
}: {
  mode: 'new' | 'retry' | 'dub'
  retryJob: JobRow | null
  /** Task #15 Phase 3 — the plain bin asset being dubbed, when mode === 'dub'. */
  dubAsset: VideoProjectAsset | null
  voiceProfiles: VoiceProfile[]
  engine: EngineId
  setEngine: (e: EngineId) => void
  engineCaps: EngineCaps
  /** Task #15 (Video Studio) Phase 1 — tags a new upload with the current project (retries don't need this passed through; VideoDubbingController::retry() already carries the source job's project association forward server-side). Required (not just tagging) when mode === 'dub' — dubVideoProjectAsset() is itself a project-scoped endpoint. */
  videoProjectId?: string | null
  onClose: () => void
  onSubmitted: (jobId: string, poster: string | null) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [posterImage, setPosterImage] = useState<string | null>(null)
  const [profileId, setProfileId] = useState(retryJob?.voice_profile_id ?? voiceProfiles[0]?.profile_id ?? '')
  const [sourceLang, setSourceLang] = useState(retryJob?.source_language ?? '')
  const [targetLang, setTargetLang] = useState(retryJob?.target_language ?? 'es')
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  function pickFile(f: File) {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      toast.err('Unsupported file type. Use MP4, MOV, MKV, or WebM.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.err(`File is too large (${(f.size / 1024 / 1024).toFixed(0)}MB). Max is 200MB.`)
      return
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(f)
    urlRef.current = url
    setFile(f)
    setVideoUrl(url)
    setPosterImage(null)
  }

  function clearFile() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setFile(null); setVideoUrl(null); setPosterImage(null)
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
    const d = v.duration && isFinite(v.duration) ? v.duration : 3
    v.currentTime = Math.min(d / 3, 3)
  }

  function onPreviewSeeked() {
    const v = previewRef.current
    if (!v) return
    const frame = captureFrame(v)
    if (frame) setPosterImage(frame)
  }

  const effectiveProfileId = profileId || voiceProfiles[0]?.profile_id || ''
  const canStart = (mode === 'retry' || mode === 'dub' || !!file) && !!effectiveProfileId && !!targetLang && !submitting

  async function start() {
    if (!effectiveProfileId) { toast.err('Choose a voice to dub with.'); return }
    if (!targetLang) { toast.err('Choose a target language.'); return }

    if (mode === 'retry' && retryJob) {
      setSubmitting(true)
      try {
        const res = await api.retryDubbingJob(retryJob.job_id, {
          target_language: targetLang,
          source_language: sourceLang || undefined,
          voice_profile_id: effectiveProfileId,
          engine,
        }) as { job_id?: string }
        toast.ok('Dubbing job queued.')
        onSubmitted(res?.job_id ?? retryJob.job_id, null)
      } catch (e) {
        toast.err(e instanceof ApiError ? e.message : 'Failed to start dubbing.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (mode === 'dub') {
      if (!dubAsset || !videoProjectId) { toast.err('This clip is no longer available.'); return }
      setSubmitting(true)
      try {
        const res = await api.dubVideoProjectAsset(videoProjectId, dubAsset.id, {
          target_language: targetLang,
          source_language: sourceLang || undefined,
          voice_profile_id: effectiveProfileId,
          engine,
        })
        toast.ok('Dubbing job queued.')
        onSubmitted(res.job_id, null)
      } catch (e) {
        toast.err(e instanceof ApiError ? e.message : 'Failed to start dubbing.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (!file) { toast.err('Choose a video file first.'); return }

    setSubmitting(true)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('target_language', targetLang)
      if (sourceLang) fd.append('source_language', sourceLang)
      fd.append('voice_profile_id', effectiveProfileId)
      fd.append('engine', engine)
      if (videoProjectId) fd.append('video_project_id', videoProjectId)

      const res = await api.postWithProgress('/dubbing/submit', fd, setUploadProgress) as { job_id?: string }
      toast.ok('Dubbing job queued.')
      onSubmitted(res?.job_id ?? '', posterImage)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to start dubbing.')
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
    }
  }

  return (
    <div className="ds-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose() }}>
      <div className="ds-modal">
        <div className="ds-modal__head">
          <h3>{mode === 'new' ? 'New dub' : mode === 'dub' ? 'Dub this clip' : 'Dub again'}</h3>
          <button className="ds-icon-btn" onClick={onClose} disabled={submitting}>{icons.close}</button>
        </div>

        {mode === 'dub' ? (
          <div className="ds-retrynote">
            <strong>{dubAsset?.original_filename ?? 'This clip'}</strong> will be dubbed from your project's media bin — no re-upload needed.
          </div>
        ) : mode === 'new' ? (
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
                <span className="ds-preview__dur">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                <button type="button" className="btn btn--ghost" onClick={clearFile} disabled={submitting}>Change file</button>
              </div>
            </div>
          ) : (
            <label
              className={`ds-dropzone ${dragOver ? 'ds-dropzone--over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={onFilePick} />
              {icons.upload}
              <span>Drop or pick a video</span>
              <span className="ds-dropzone__hint">MP4, MOV, WebM, MKV · max 200 MB</span>
            </label>
          )
        ) : (
          <div className="ds-retrynote">
            <strong>{retryJob?.original_filename}</strong> will be reused — no re-upload needed.
            <span className="ds-retrynote__prev">Last run: {langLabel(retryJob?.source_language ?? null)} → {langLabel(retryJob?.target_language ?? null)} · {retryJob?.voice_name}</span>
          </div>
        )}

        <label className="ds-field">
          <span>Voice</span>
          {voiceProfiles.length === 0 ? (
            <div className="ds-inspector__hint">No saved voice profiles yet — record one in Voice Profiles first.</div>
          ) : (
            <select value={effectiveProfileId} onChange={e => setProfileId(e.target.value)}>
              {voiceProfiles.map(v => <option key={v.profile_id} value={v.profile_id}>{v.name}</option>)}
            </select>
          )}
        </label>

        <div className="ds-field">
          <span>Engine</span>
          <EngineSwitcher engine={engine} setEngine={setEngine} engineCaps={engineCaps} />
        </div>

        <div className="ds-modal__langs">
          <label className="ds-field">
            <span>Source language</span>
            <select value={sourceLang} onChange={e => setSourceLang(e.target.value)}>
              <option value="">Auto-detect</option>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <label className="ds-field">
            <span>Target language</span>
            <select value={targetLang} onChange={e => setTargetLang(e.target.value)}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>

        <button className="btn btn--primary ds-modal__start" disabled={!canStart} onClick={start}>
          {submitting
            ? (mode === 'new' && uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Starting…')
            : 'Start dubbing'}
        </button>
      </div>
    </div>
  )
}

// ── Transcript review / resynthesize modal ──────────────────────
//
// Task #15 Phase 4, review + step 2. Opened from the "Review & clone
// voice" button on a 'ready' extracted_audio card. Lets the user fix
// transcription mistakes (PATCH .../transcript) before spending
// synthesis quota, then pick a voice/engine/language and kick off
// resynthesize() — same "save edits, then submit" two-call shape as
// DubbingTimelineEditor's own review step, just without that
// component's segment-timing/split/merge machinery: there's no target
// video window here for a segment to fit, so all this needs is
// editable text per segment plus the same voice/engine/language picker
// NewDubDialog already uses for dubbing.

function TranscriptReviewDialog({
  asset, voiceProfiles, engine, setEngine, engineCaps, videoProjectId, onClose, onResynthesized,
}: {
  /** The 'extracted_audio' asset being reviewed — always 'ready' with a non-empty transcript_json by the time this dialog can be opened (see the card's own status gating). */
  asset: VideoProjectAsset
  voiceProfiles: VoiceProfile[]
  engine: EngineId
  setEngine: (e: EngineId) => void
  engineCaps: EngineCaps
  videoProjectId: string
  onClose: () => void
  /** Called once resynthesize() has been queued — parent closes the dialog and refetches the bin so the new synthesized_audio card shows up. */
  onResynthesized: () => void
}) {
  const [segments, setSegments] = useState<VideoProjectAssetTranscriptSegment[]>(asset.transcript_json ?? [])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileId, setProfileId] = useState(voiceProfiles[0]?.profile_id ?? '')
  const [targetLang, setTargetLang] = useState('en')
  const [submitting, setSubmitting] = useState(false)

  function editSegment(id: string, text: string) {
    setSegments(prev => prev.map(s => (s.id === id ? { ...s, text } : s)))
    setDirty(true)
  }

  /** Saves any edited segment text. Returns false (and toasts) on failure so callers can bail out of a follow-on action (e.g. resynthesize). */
  async function saveTranscript(): Promise<boolean> {
    if (!dirty) return true
    setSaving(true)
    try {
      const res = await api.updateVideoProjectAssetTranscript(
        videoProjectId, asset.id,
        segments.map(s => ({ id: s.id, text: s.text }))
      )
      setSegments(res.segments)
      setDirty(false)
      return true
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to save transcript changes.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const effectiveProfileId = profileId || voiceProfiles[0]?.profile_id || ''
  const canSubmit = !!effectiveProfileId && !!targetLang && !submitting && !saving && segments.length > 0

  async function cloneVoice() {
    if (!effectiveProfileId) { toast.err('Choose a voice to clone.'); return }
    if (dirty && !(await saveTranscript())) return

    setSubmitting(true)
    try {
      await api.resynthesizeVideoProjectAsset(videoProjectId, asset.id, {
        voice_profile_id: effectiveProfileId,
        engine,
        language: targetLang,
      })
      toast.ok('Cloning voice…')
      onResynthesized()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to start voice cloning.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ds-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !submitting && !saving) onClose() }}>
      <div className="ds-modal ds-modal--wide">
        <div className="ds-modal__head">
          <h3>Review transcript</h3>
          <button className="ds-icon-btn" onClick={onClose} disabled={submitting || saving}>{icons.close}</button>
        </div>

        <audio className="ds-transcript__audio" src={api.videoProjectAssetFileUrl(videoProjectId, asset.id)} controls />

        <div className="ds-transcript__list">
          {segments.length === 0 ? (
            <div className="ds-inspector__hint">No transcript segments to review.</div>
          ) : segments.map(seg => (
            <div key={seg.id} className="ds-transcript__row">
              <span className="ds-transcript__time">{fmtDuration(seg.start)}</span>
              <textarea
                rows={2}
                value={seg.text}
                onChange={e => editSegment(seg.id, e.target.value)}
                disabled={submitting || saving}
              />
            </div>
          ))}
        </div>

        <label className="ds-field">
          <span>Voice</span>
          {voiceProfiles.length === 0 ? (
            <div className="ds-inspector__hint">No saved voice profiles yet — record one in Voice Profiles first.</div>
          ) : (
            <select value={effectiveProfileId} onChange={e => setProfileId(e.target.value)}>
              {voiceProfiles.map(v => <option key={v.profile_id} value={v.profile_id}>{v.name}</option>)}
            </select>
          )}
        </label>

        <div className="ds-field">
          <span>Engine</span>
          <EngineSwitcher engine={engine} setEngine={setEngine} engineCaps={engineCaps} />
        </div>

        <label className="ds-field">
          <span>Language</span>
          <select value={targetLang} onChange={e => setTargetLang(e.target.value)}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>

        <div className="ds-transcript__actions">
          <button className="btn btn--ghost" disabled={!dirty || saving || submitting} onClick={saveTranscript}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn btn--primary ds-modal__start" disabled={!canSubmit} onClick={cloneVoice}>
            {submitting ? 'Starting…' : 'Clone voice'}
          </button>
        </div>
      </div>
    </div>
  )
}
