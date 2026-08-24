import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, LANGUAGES, CLIP_COLORS, CLIP_LIGHTS } from '../lib/constants'
import { fmt } from '../lib/audio'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useTTSEngine } from '../hooks/useTTSEngine'
import { EngineSwitcher } from '../components/EngineSwitcher'
import { DubbingTimelineEditor } from '../components/DubbingTimelineEditor'
import { useVideoProjects, type VideoProject, type VideoProjectClip, type TimelineEntry } from '../hooks/useVideoProjects'
import type { VoiceProfile, EngineCaps } from '../lib/types'

/**
 * Task #6a (Video Studio) Phase 3 — the studio UI itself.
 *
 * Follows DubbingPage's established routing convention (checked before
 * writing this, per Phase 1's note): one top-level `page` entry
 * ('video-studio') with the list↔detail toggle kept as this component's
 * own internal state, not threaded through App.tsx's page router.
 *
 * The "3-lane ORIG/DUB/VIDEO timeline" from the reference screenshot is
 * built here as: the media bin split into an Original-clips lane and a
 * Dubbed-variants lane to pick from, composing into a single ordered
 * VIDEO sequence — exactly the shape `timeline_json` already has from
 * Phase 1 (`{clip_id, trim_in, trim_out, variant}[]`). No new schema,
 * no drag-and-drop yet — entries are added from the bin and reordered
 * with up/down controls. A literal simultaneous 3-track visual (clips
 * stacked at their own timecodes across three rows) is a bigger, separate
 * lift and isn't what this phase builds.
 *
 * "Dub this clip" hands off into the *existing, unchanged*
 * DubbingTimelineEditor using the job_id dubClip() returns, exactly as
 * Phase 2's docblock anticipated — this phase is what actually wires
 * that hand-off up. Job status is polled via the same /dubbing list
 * endpoint DubbingPage already polls; once a linked job reaches
 * 'ready_for_review' a "Review" badge appears on the bin row rather than
 * auto-opening the editor out from under the user. Once a linked job
 * reaches 'done' or 'failed', loadProject() is called to pick up the
 * backend's syncDubbedClipStatuses() result (poll-on-read, per Phase 2).
 */

const LIST_POLL_MS = 6000 // matches DubbingPage — /dubbing is throttled 60/min

function fmtDur(secs: number | null): string {
  if (secs == null || secs <= 0) return '—'
  return fmt(Math.round(secs))
}

interface JobRow {
  job_id: string
  status: 'queued' | 'transcribing' | 'translating' | 'ready_for_review' | 'synthesizing' | 'muxing' | 'done' | 'failed'
  target_language: string
  source_language?: string | null
}

function clipLabel(clip: VideoProjectClip): string {
  return clip.originalFilename ?? (clip.kind === 'dubbed' ? 'Dubbed clip' : 'Clip')
}

// Stable, cheap string→color-index hash so a clip's placeholder thumbnail
// tile keeps the same color across renders (no real frame thumbnails
// exist yet — see docs/ENHANCEMENT_TASKS.md task #6a Phase 5 notes).
function hashIdx(id: string, mod: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % mod
}

// ── Media bin card (file-browser grid tile) ─────────────────────────
function BinCard({
  clip, job, isPreviewing, onPreview, onDub, onDelete, onAddToTimeline, onOpenReview, deleting,
}: {
  clip: VideoProjectClip
  job: JobRow | undefined
  isPreviewing: boolean
  onPreview: () => void
  onDub: () => void
  onDelete: () => void
  onAddToTimeline: () => void
  onOpenReview: () => void
  deleting: boolean
}) {
  const badge =
    clip.status === 'failed' ? { text: 'Failed', cls: 'tag--warn' } :
    job?.status === 'ready_for_review' ? { text: 'Review', cls: 'tag--accent' } :
    clip.status === 'processing' ? { text: 'Dubbing…', cls: 'tag--accent' } :
    null

  const colorIdx = hashIdx(clip.id, CLIP_COLORS.length)
  const sub = clip.kind === 'dubbed' && job?.target_language
    ? `→ ${job.target_language.toUpperCase()}`
    : fmtDur(clip.durationSeconds)

  return (
    <div
      className={`vs-bincard${isPreviewing ? ' vs-bincard--active' : ''}`}
      onClick={clip.status === 'ready' ? onPreview : undefined}
      style={{ cursor: clip.status === 'ready' ? 'pointer' : 'default' }}
    >
      <div className="vs-bincard__thumb" style={{ background: CLIP_LIGHTS[colorIdx] }}>
        <span style={{ display: 'flex', width: 22, height: 22, color: CLIP_COLORS[colorIdx] }}>
          {clip.kind === 'dubbed' ? icons.globe : icons.video}
        </span>
        <span className="vs-bincard__kind">{clip.kind === 'dubbed' ? 'DUB' : 'SRC'}</span>
        <span className="vs-bincard__dur">{fmtDur(clip.durationSeconds)}</span>
        {badge && <span className={`tag ${badge.cls} vs-bincard__badge`}>{badge.text}</span>}
        <div className="vs-bincard__actions" onClick={e => e.stopPropagation()}>
          {job?.status === 'ready_for_review' && (
            <button className="btn btn--ghost btn--sm" title="Open review timeline" onClick={onOpenReview}>{icons.edit}</button>
          )}
          {clip.status === 'ready' && (
            <button className="btn btn--ghost btn--sm" title="Add to timeline" onClick={onAddToTimeline}>{icons.plus}</button>
          )}
          {clip.kind === 'source' && clip.status === 'ready' && (
            <button className="btn btn--ghost btn--sm" title="Dub this clip" onClick={onDub}>{icons.globe}</button>
          )}
          {clip.status !== 'processing' && (
            <button className="btn btn--ghost btn--sm" title="Delete" onClick={onDelete} disabled={deleting}>
              {deleting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.trash}
            </button>
          )}
        </div>
      </div>
      <div className="vs-bincard__meta">
        <div className="vs-bincard__name" title={clipLabel(clip)}>{clipLabel(clip)}</div>
        <div className="vs-bincard__sub">{sub}</div>
      </div>
    </div>
  )
}

// ── "Dub this clip" dialog ──────────────────────────────────────────
function DubDialog({
  clip, voiceProfiles, engineCaps, onClose, onSubmit,
}: {
  clip: VideoProjectClip
  voiceProfiles: VoiceProfile[]
  engineCaps: EngineCaps
  onClose: () => void
  onSubmit: (params: { targetLanguage: string; sourceLanguage?: string; voiceProfileId: string; engine: string }) => Promise<void>
}) {
  const { engine, setEngine } = useTTSEngine()
  const [targetLanguage, setTargetLanguage] = useState('es')
  const [sourceLanguage, setSourceLanguage] = useState('')
  const [profileId, setProfileId] = useState(voiceProfiles[0]?.profile_id ?? '')
  const [submitting, setSubmitting] = useState(false)
  useEscapeKey(onClose, !submitting)

  async function submit() {
    if (!profileId) { toast.err('Choose a voice to dub with.'); return }
    setSubmitting(true)
    try {
      await onSubmit({ targetLanguage, sourceLanguage: sourceLanguage || undefined, voiceProfileId: profileId, engine })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Dub this clip" onClick={e => e.target === e.currentTarget && !submitting && onClose()}>
      <div className="modal" style={{ maxWidth: 480, width: '100%' }}>
        <div className="modal__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Dub “{clipLabel(clip)}”</span>
          <button className="btn btn--ghost btn--sm" onClick={onClose} disabled={submitting}>{icons.close}</button>
        </div>
        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Voice</label>
            {voiceProfiles.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No saved voice profiles yet — record one in Voice Profiles first.</div>
            ) : (
              <select value={profileId} onChange={e => setProfileId(e.target.value)} className="full-input" style={{ width: '100%' }}>
                {voiceProfiles.map(p => <option key={p.profile_id} value={p.profile_id}>{p.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>TTS engine</label>
            <EngineSwitcher engine={engine} setEngine={setEngine} engineCaps={engineCaps} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Source language</label>
              <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)} className="full-input" style={{ width: '100%' }}>
                <option value="">Auto-detect</option>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Target language</label>
              <select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} className="full-input" style={{ width: '100%' }}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn--primary" disabled={submitting || voiceProfiles.length === 0} onClick={submit}>
              {submitting ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
              {submitting ? 'Starting…' : 'Start Dubbing'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={onClose} disabled={submitting}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Timeline ruler ───────────────────────────────────────────────────
// A plain seconds ruler (TC row in the reference screenshot). Tick
// spacing coarsens as zoom shrinks so labels never overlap.
function TimelineRuler({ totalDuration, zoom }: { totalDuration: number; zoom: number }) {
  const step = zoom >= 80 ? 2 : zoom >= 40 ? 5 : zoom >= 20 ? 10 : 30
  const last = Math.max(step, Math.ceil((totalDuration + step) / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= last; t += step) ticks.push(t)
  return (
    <div style={{ position: 'relative', height: 20, borderBottom: '1px solid var(--border)' }}>
      {ticks.map(t => (
        <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 1, height: 6, background: 'var(--border-2)', marginRight: 3 }} />
          <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Timeline composition track ──────────────────────────────────────
// video_projects.timeline_json is one ordered sequence, not literal
// parallel ORIG/DUB/VIDEO lanes — see VideoProjectController's docblock
// (task #6a Phase 3 notes) on why a simultaneous 3-track visual is a
// separate, bigger lift. This renders that single sequence as
// proportionally-positioned, color-coded blocks along a shared ruler
// instead, which is the closest honest match to the actual data shape.
function CompositionTrack({
  timeline, clipsById, zoom, selectedIdx, onSelect,
}: {
  timeline: TimelineEntry[]
  clipsById: Map<string, VideoProjectClip>
  zoom: number
  selectedIdx: number | null
  onSelect: (idx: number) => void
}) {
  const offsets: number[] = []
  timeline.reduce((acc, e) => {
    offsets.push(acc)
    return acc + Math.max(0, e.trimOut - e.trimIn)
  }, 0)

  return (
    <div style={{ position: 'relative', height: 54 }}>
      {timeline.map((entry, idx) => {
        const dur = Math.max(0, entry.trimOut - entry.trimIn)
        const left = offsets[idx] * zoom
        const width = Math.max(dur * zoom, 28)
        const clip = clipsById.get(entry.clipId)
        const isSel = idx === selectedIdx
        const isDub = entry.variant === 'dubbed'
        return (
          <div
            key={idx}
            onClick={e => { e.stopPropagation(); onSelect(idx) }}
            title={clip ? clipLabel(clip) : 'Clip removed from bin'}
            style={{
              position: 'absolute', left, width, top: 5, bottom: 5,
              borderRadius: 7, overflow: 'hidden', cursor: 'pointer',
              display: 'flex', alignItems: 'center', padding: '0 8px', zIndex: isSel ? 5 : 1,
              background: isDub ? 'rgba(61,181,100,0.14)' : 'rgba(201,100,66,0.14)',
              border: `1.5px solid ${isSel ? 'var(--accent)' : isDub ? 'rgba(61,181,100,0.55)' : 'rgba(201,100,66,0.55)'}`,
              boxShadow: isSel ? '0 0 0 2px var(--accent-mid)' : 'none',
            }}
          >
            <span style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-1)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {clip ? clipLabel(clip) : 'Removed clip'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Selected-clip inspector panel (stands in for the reference's
// "SEGMENT" side panel — one project timeline entry rather than one
// dubbing sub-segment; per-line translated text still lives one level
// down, in the review timeline this links out to). ────────────────────
function ClipInspector({
  entry, index, total, clip, job, onTrimChange, onMove, onRemove, onOpenReview, onClose,
}: {
  entry: TimelineEntry
  index: number
  total: number
  clip: VideoProjectClip | undefined
  job: JobRow | undefined
  onTrimChange: (trimIn: number, trimOut: number) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onOpenReview: () => void
  onClose: () => void
}) {
  const maxDur = clip?.durationSeconds ?? Math.max(entry.trimOut, 1)
  return (
    <div className="vs-inspector">
      <div className="vs-inspector__head">
        <span className="vs-inspector__title">
          Clip {index + 1} · {fmt(Math.floor(entry.trimIn))}–{fmt(Math.floor(entry.trimOut))}
        </span>
        <span className={`tag ${entry.variant === 'dubbed' ? 'tag--accent' : ''}`}>
          {entry.variant === 'dubbed' ? 'DUB' : 'ORIG'}
        </span>
      </div>

      <div className="vs-inspector__row">
        <div className="vs-inspector__label">Source clip</div>
        <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-2)' }}>
          {clip ? clipLabel(clip) : 'Clip removed from bin'}
        </div>
      </div>

      {job && (
        <div className="vs-inspector__row">
          <div className="vs-inspector__label">Language</div>
          <span className="tag tag--accent">
            {(job.source_language ?? 'auto').toUpperCase()} → {job.target_language.toUpperCase()}
          </span>
        </div>
      )}

      <div className="vs-inspector__row">
        <div className="vs-inspector__label">Trim</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} max={maxDur} step={0.1} value={entry.trimIn}
            onChange={e => onTrimChange(Math.max(0, Number(e.target.value)), entry.trimOut)}
            className="full-input" style={{ width: 72, padding: '6px 8px', fontSize: 12 }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>→</span>
          <input
            type="number" min={0} max={maxDur} step={0.1} value={entry.trimOut}
            onChange={e => onTrimChange(entry.trimIn, Math.min(maxDur, Number(e.target.value)))}
            className="full-input" style={{ width: 72, padding: '6px 8px', fontSize: 12 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--ghost btn--sm" disabled={index === 0} onClick={() => onMove(-1)} style={{ flex: 1, justifyContent: 'center' }}>↑ Earlier</button>
        <button className="btn btn--ghost btn--sm" disabled={index === total - 1} onClick={() => onMove(1)} style={{ flex: 1, justifyContent: 'center' }}>↓ Later</button>
      </div>

      {job?.status === 'ready_for_review' && (
        <button className="btn btn--ghost" onClick={onOpenReview} style={{ justifyContent: 'center', gap: 7 }}>
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.edit}</span> Open review timeline
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button className="btn btn--danger btn--sm" onClick={onRemove} style={{ flex: 1, justifyContent: 'center' }}>Remove from timeline</button>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

// ── Studio view (one open project) ───────────────────────────────────
function StudioView({
  project, voiceProfiles, engineCaps, onBack, onRefresh, vp,
}: {
  project: VideoProject
  voiceProfiles: VoiceProfile[]
  engineCaps: EngineCaps
  onBack: () => void
  onRefresh: () => Promise<void>
  vp: ReturnType<typeof useVideoProjects>
}) {
  const [name, setName] = useState(project.name)
  useEffect(() => setName(project.name), [project.id, project.name])

  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dubTarget, setDubTarget] = useState<VideoProjectClip | null>(null)
  const [reviewJobId, setReviewJobId] = useState<string | null>(null)
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null)

  const [previewClipId, setPreviewClipId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [selectedEntryIdx, setSelectedEntryIdx] = useState<number | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>(project.timeline)
  useEffect(() => setTimeline(project.timeline), [project.id, project.timeline])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [jobs, setJobs] = useState<JobRow[]>([])
  const [rendering, setRendering] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // ── File-browser (bin) filter + search ─────────────────────────────
  const [binFilter, setBinFilter] = useState<'all' | 'source' | 'dubbed'>('all')
  const [binQuery, setBinQuery] = useState('')

  // ── Composition-track zoom (px/sec) ─────────────────────────────────
  const [zoom, setZoom] = useState(40)

  // ── Custom transport bar (native controls hidden, like the reference
  // studio's own play/stop/mute row) ──────────────────────────────────
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [curDuration, setCurDuration] = useState(0)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const v = videoElRef.current
    if (!v) return
    const onTime = () => setCurTime(v.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onDur = () => setCurDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('durationchange', onDur)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('durationchange', onDur)
    }
  }, [previewUrl])

  const clipsById = useMemo(() => new Map(project.clips.map(c => [c.id, c])), [project.clips])
  const jobsById = useMemo(() => new Map(jobs.map(j => [j.job_id, j])), [jobs])

  const binClips = useMemo(() => {
    const q = binQuery.trim().toLowerCase()
    return project.clips.filter(c => {
      if (binFilter !== 'all' && c.kind !== binFilter) return false
      if (q && !clipLabel(c).toLowerCase().includes(q)) return false
      return true
    })
  }, [project.clips, binFilter, binQuery])

  // ── Currently-previewed clip, its dubbing job (for the language
  // badge), and its "paired" clip (source ↔ its dubbed variant, or vice
  // versa) so the transport bar can offer an Original/Dubbed toggle. ──
  const previewClip = previewClipId ? clipsById.get(previewClipId) ?? null : null
  const previewJob = previewClip?.dubbingJobId ? jobsById.get(previewClip.dubbingJobId) : undefined
  const pairedClip = useMemo(() => {
    if (!previewClip) return null
    if (previewClip.kind === 'dubbed') {
      return previewClip.parentClipId ? clipsById.get(previewClip.parentClipId) ?? null : null
    }
    return project.clips.find(c => c.kind === 'dubbed' && c.parentClipId === previewClip.id && c.status === 'ready') ?? null
  }, [previewClip, clipsById, project.clips])

  const hasProcessing = project.clips.some(c => c.kind === 'dubbed' && c.status === 'processing')
  const isRendering = project.status === 'rendering'

  // ── Poll while this project is rendering — same interval as the
  // dubbing-jobs poll below, just watching loadProject() itself rather
  // than /dubbing, since a render's only observable state is the
  // project's own status column (no per-percent progress column exists
  // on video_projects the way dubbing_jobs has one — see
  // RenderVideoProjectJob's docblock). ──────────────────────────────
  useEffect(() => {
    if (!isRendering) return
    let cancelled = false
    const t = setInterval(() => { if (!cancelled) onRefresh() }, LIST_POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [isRendering, onRefresh])

  // ── Poll dubbing jobs while anything in this project is processing ──
  useEffect(() => {
    if (!hasProcessing) return
    let cancelled = false
    async function tick() {
      try {
        const res = await api.listDubbingJobs() as { jobs: JobRow[] }
        if (cancelled) return
        setJobs(res.jobs ?? [])
        const anySettled = (res.jobs ?? []).some(j => {
          const clip = project.clips.find(c => c.dubbingJobId === j.job_id && c.status === 'processing')
          return clip && (j.status === 'done' || j.status === 'failed')
        })
        if (anySettled) onRefresh()
      } catch {
        // Transient — next tick retries.
      }
    }
    tick()
    const t = setInterval(tick, LIST_POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProcessing, project.clips])

  // ── Preview player ───────────────────────────────────────────────
  const loadPreview = useCallback(async (projectId: string, clipId: string) => {
    setPreviewClipId(clipId)
    setPreviewLoading(true)
    setPreviewUrl(null)
    try {
      const blob = await api.fetchVideoProjectClipFile(projectId, clipId)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not load this clip.')
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  // ── Rename (debounced-by-blur, matches Phase 1's PATCH shape) ──────
  function commitRename() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== project.name) vp.renameProject(project.id, trimmed)
    else setName(project.name)
  }

  // ── Upload ───────────────────────────────────────────────────────
  async function pickAndUpload(file: File | null) {
    if (!file) return
    setUploading(true)
    try {
      await vp.uploadClip(project.id, file)
      toast.ok('Clip added to the bin.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Dub ─────────────────────────────────────────────────────────
  async function submitDub(params: { targetLanguage: string; sourceLanguage?: string; voiceProfileId: string; engine: string }) {
    if (!dubTarget) return
    try {
      await vp.dubClip(project.id, dubTarget.id, params)
      toast.ok('Dubbing queued — it will appear in the bin as it processes.')
      setDubTarget(null)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to start dubbing.')
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  async function handleRender() {
    setRendering(true)
    try {
      await vp.renderProject(project.id)
      toast.ok('Rendering started — this can take a few minutes.')
      await onRefresh()
    } catch (e) {
      if (e instanceof ApiError && (e.status === 422 || e.status === 409)) toast.err(e.message)
      else toast.err('Could not start the render.')
    } finally {
      setRendering(false)
    }
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const blob = await api.fetchVideoProjectOutputFile(project.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'video'}.mp4`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDeleteProject() {
    try {
      await vp.deleteProject(project.id)
      toast.ok('Deleted.')
      onBack()
    } catch {
      toast.err('Could not delete this project.')
      setDeleteConfirm(false)
    }
  }

  // ── Delete clip ─────────────────────────────────────────────────
  async function deleteClip(clip: VideoProjectClip) {
    setDeletingClipId(clip.id)
    try {
      await vp.deleteClip(project.id, clip.id)
      setTimeline(t => t.filter(e => e.clipId !== clip.id))
      if (previewClipId === clip.id) { setPreviewClipId(null); setPreviewUrl(null) }
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) toast.err(e.message)
      else if (e instanceof ApiError && e.status === 409) toast.err(e.message)
      else toast.err('Could not delete this clip.')
    } finally {
      setDeletingClipId(null)
    }
  }

  // ── Timeline editing (debounced autosave, like a scripts-workspace autosave) ──
  function scheduleSave(next: TimelineEntry[]) {
    setTimeline(next)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { vp.saveTimeline(project.id, next) }, 600)
  }

  function addToTimeline(clip: VideoProjectClip) {
    const entry: TimelineEntry = {
      clipId: clip.id,
      trimIn: 0,
      trimOut: clip.durationSeconds ?? 0,
      variant: clip.kind,
    }
    scheduleSave([...timeline, entry])
  }

  function moveEntry(idx: number, dir: -1 | 1) {
    const next = [...timeline]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    scheduleSave(next)
    setSelectedEntryIdx(target)
  }

  function removeEntry(idx: number) {
    scheduleSave(timeline.filter((_, i) => i !== idx))
    setSelectedEntryIdx(null)
  }

  function trimEntry(idx: number, trimIn: number, trimOut: number) {
    const next = timeline.map((e, i) => i === idx ? { ...e, trimIn, trimOut } : e)
    scheduleSave(next)
  }

  const totalDuration = timeline.reduce((sum, e) => sum + Math.max(0, e.trimOut - e.trimIn), 0)

  // ── Review-timeline hand-off (Phase 2 → Phase 3 wiring) ────────────
  if (reviewJobId) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px 60px' }}>
        <button className="btn btn--ghost btn--sm" onClick={() => setReviewJobId(null)} style={{ marginBottom: 14 }}>
          {icons.back} Back to studio
        </button>
        <DubbingTimelineEditor
          key={reviewJobId}
          jobId={reviewJobId}
          targetLanguage={jobsById.get(reviewJobId)?.target_language ?? ''}
          onFinalized={async () => { setReviewJobId(null); await onRefresh() }}
          onCancel={() => setReviewJobId(null)}
        />
      </div>
    )
  }

  const selectedEntry = selectedEntryIdx != null ? timeline[selectedEntryIdx] : undefined

  return (
    <div className="vs-studio">
      {/* Breadcrumb header */}
      <div className="vs-topbar">
        <button className="vs-crumb" onClick={onBack}>
          <span style={{ display: 'flex', width: 13, height: 13 }}>{icons.back}</span> Video Studio
        </button>
        <span className="vs-crumb__sep">/</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="vs-title-input"
        />

        <div style={{ flex: 1 }} />

        {previewJob && (
          <span className="tag" title="Language of the clip currently previewing">
            {(previewJob.source_language ?? 'auto').toUpperCase()} → {previewJob.target_language.toUpperCase()}
          </span>
        )}

        {project.status === 'rendering' && (
          <span className="tag tag--accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="spinner" style={{ width: 10, height: 10 }} /> Rendering…
          </span>
        )}
        {project.status === 'failed' && (
          <span className="tag tag--warn" title={project.error ?? undefined}>Render failed</span>
        )}
        {project.status === 'done' && (
          <button className="btn btn--ghost btn--sm" onClick={handleDownload} disabled={downloading} title="Download rendered video">
            {downloading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.download}
          </button>
        )}

        <button
          className="btn btn--primary btn--sm"
          onClick={handleRender}
          disabled={rendering || isRendering || timeline.length === 0}
          title={timeline.length === 0 ? 'Add clips to the timeline first' : project.status === 'done' ? 'Re-export this timeline' : 'Export this timeline into one video'}
        >
          {(rendering || isRendering) ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
          {isRendering ? 'Exporting…' : 'Export'}
        </button>

        {deleteConfirm ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn--danger btn--sm" onClick={handleDeleteProject}>Confirm</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setDeleteConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn--ghost btn--sm" title="Delete project" onClick={() => setDeleteConfirm(true)}>{icons.trash}</button>
        )}
      </div>

      <div className="vs-body">
        {/* Media bin — file-browser sidebar */}
        <div className="vs-bin">
          <div className="vs-bin__head">
            <span className="vs-bin__title">My files</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDur(totalDuration)} on timeline</span>
          </div>

          <button className="btn btn--primary vs-bin__add" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.plus}</span>}
            Add files
          </button>
          <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm" style={{ display: 'none' }}
            onChange={e => pickAndUpload(e.target.files?.[0] ?? null)} />

          <div className="vs-bin__tabs">
            {(['all', 'source', 'dubbed'] as const).map(f => (
              <button key={f} className={`vs-bin__tab${binFilter === f ? ' vs-bin__tab--active' : ''}`} onClick={() => setBinFilter(f)}>
                {f === 'all' ? 'All' : f === 'source' ? 'Originals' : 'Dubbed'}
              </button>
            ))}
          </div>

          <div className="vs-bin__search">
            <span style={{ display: 'flex', width: 13, height: 13, color: 'var(--text-3)' }}>{icons.search}</span>
            <input value={binQuery} onChange={e => setBinQuery(e.target.value)} placeholder="Search clips" />
          </div>

          {project.clips.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 2px' }}>No clips yet — add one to get started.</div>
          ) : binClips.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 2px' }}>No clips match this filter.</div>
          ) : (
            <div className="vs-bin__grid">
              {binClips.map(clip => (
                <BinCard
                  key={clip.id}
                  clip={clip}
                  job={clip.dubbingJobId ? jobsById.get(clip.dubbingJobId) : undefined}
                  isPreviewing={previewClipId === clip.id}
                  onPreview={() => loadPreview(project.id, clip.id)}
                  onDub={() => setDubTarget(clip)}
                  onDelete={() => deleteClip(clip)}
                  onAddToTimeline={() => addToTimeline(clip)}
                  onOpenReview={() => clip.dubbingJobId && setReviewJobId(clip.dubbingJobId)}
                  deleting={deletingClipId === clip.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Preview + timeline */}
        <div className="vs-main">
          <div className="vs-preview">
            {previewLoading ? (
              <span className="spinner" />
            ) : previewUrl ? (
              <>
                <video
                  ref={videoElRef}
                  key={previewClipId}
                  src={previewUrl}
                  muted={muted}
                  style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain' }}
                  onClick={() => playing ? videoElRef.current?.pause() : videoElRef.current?.play()}
                />
                <div className="vs-preview__tc">{fmt(Math.floor(curTime))} · {previewClip?.kind === 'dubbed' ? 'DUB' : 'SRC'}</div>
                {previewClip && <div className="vs-preview__caption">{clipLabel(previewClip)}</div>}
              </>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Select a clip from the bin to preview it</span>
            )}
          </div>

          {previewUrl && (
            <div className="vs-transport">
              <button className="vs-transport__btn" title="Restart" onClick={() => { if (videoElRef.current) videoElRef.current.currentTime = 0 }}>
                {icons.rewind}
              </button>
              <button className="vs-transport__btn" title={playing ? 'Pause' : 'Play'} onClick={() => playing ? videoElRef.current?.pause() : videoElRef.current?.play()}>
                {playing ? icons.pause : icons.play}
              </button>
              <button className="vs-transport__btn" title="Stop" onClick={() => { const v = videoElRef.current; if (v) { v.pause(); v.currentTime = 0 } }}>
                {icons.stop}
              </button>
              <button className="vs-transport__btn" title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(m => !m)}>
                {icons.volume}
              </button>

              {pairedClip && (
                <div className="vs-transport__toggle">
                  <button
                    className={`vs-transport__toggle-btn${previewClip?.kind === 'source' ? ' vs-transport__toggle-btn--active' : ''}`}
                    onClick={() => previewClip?.kind !== 'source' && loadPreview(project.id, pairedClip.kind === 'source' ? pairedClip.id : previewClip!.id)}
                  >
                    Original
                  </button>
                  <button
                    className={`vs-transport__toggle-btn${previewClip?.kind === 'dubbed' ? ' vs-transport__toggle-btn--active' : ''}`}
                    onClick={() => previewClip?.kind !== 'dubbed' && loadPreview(project.id, pairedClip.kind === 'dubbed' ? pairedClip.id : previewClip!.id)}
                  >
                    Dubbed
                  </button>
                </div>
              )}

              <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                {fmt(Math.floor(curTime))} / {fmt(Math.floor(curDuration))}
              </span>

              <div style={{ flex: 1 }} />

              {previewClip?.kind === 'source' && previewClip.status === 'ready' && (
                <button className="btn btn--ghost btn--sm" onClick={() => setDubTarget(previewClip)}>
                  <span style={{ display: 'flex', width: 13, height: 13 }}>{icons.globe}</span> New dub
                </button>
              )}

              <span style={{ display: 'flex', width: 13, height: 13, color: 'var(--text-3)' }}>{icons.zoomOut}</span>
              <input type="range" min={10} max={100} step={5} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 80 }} />
              <span style={{ display: 'flex', width: 13, height: 13, color: 'var(--text-3)' }}>{icons.zoomIn}</span>
            </div>
          )}

          <div>
            <div className="vs-section-label">Video timeline</div>
            {timeline.length === 0 ? (
              <div className="vs-timeline-empty">
                Nothing on the timeline yet — use the + on a bin clip to add it here.
              </div>
            ) : (
              <div className="vs-timeline-body">
                <div className="vs-timeline-scroll" onClick={() => setSelectedEntryIdx(null)}>
                  <div style={{ position: 'relative', width: Math.max(totalDuration * zoom + 40, 200) }}>
                    <TimelineRuler totalDuration={totalDuration} zoom={zoom} />
                    <CompositionTrack
                      timeline={timeline}
                      clipsById={clipsById}
                      zoom={zoom}
                      selectedIdx={selectedEntryIdx}
                      onSelect={idx => { setSelectedEntryIdx(idx); loadPreview(project.id, timeline[idx].clipId) }}
                    />
                  </div>
                </div>

                {selectedEntry && (
                  <ClipInspector
                    entry={selectedEntry}
                    index={selectedEntryIdx!}
                    total={timeline.length}
                    clip={clipsById.get(selectedEntry.clipId)}
                    job={(() => {
                      const c = clipsById.get(selectedEntry.clipId)
                      return c?.dubbingJobId ? jobsById.get(c.dubbingJobId) : undefined
                    })()}
                    onTrimChange={(trimIn, trimOut) => trimEntry(selectedEntryIdx!, trimIn, trimOut)}
                    onMove={dir => moveEntry(selectedEntryIdx!, dir)}
                    onRemove={() => removeEntry(selectedEntryIdx!)}
                    onOpenReview={() => {
                      const c = clipsById.get(selectedEntry.clipId)
                      if (c?.dubbingJobId) setReviewJobId(c.dubbingJobId)
                    }}
                    onClose={() => setSelectedEntryIdx(null)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {dubTarget && (
        <DubDialog
          clip={dubTarget}
          voiceProfiles={voiceProfiles}
          engineCaps={engineCaps}
          onClose={() => setDubTarget(null)}
          onSubmit={submitDub}
        />
      )}
    </div>
  )
}

// ── Project list view ────────────────────────────────────────────────
function ListView({ vp, onOpen }: { vp: ReturnType<typeof useVideoProjects>; onOpen: (id: string) => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  useEscapeKey(() => setConfirmId(null), confirmId !== null)

  async function handleNew() {
    setCreating(true)
    try {
      const project = await vp.createProject()
      if (project) onOpen(project.id)
    } catch {
      toast.err('Could not create a new video project.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await vp.deleteProject(id)
      toast.ok('Deleted.')
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ display: 'flex', width: 22, height: 22, color: 'var(--accent)' }}>{icons.layers}</span>
        <h2 style={{ margin: 0 }}>Video Studio</h2>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginBottom: 22 }}>
        Build a video project from a bin of clips — dub any of them into another language, then compose a timeline for one finished output.
      </p>

      {!vp.loading && vp.projects.length === 0 ? (
        <button className="project-card project-card--new" onClick={handleNew} style={{ width: '100%' }} disabled={creating}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{creating ? <span className="spinner" /> : icons.layers}</div>
            <span className="project-card--new__label">Start your first video project</span>
            <span className="project-card--new__hint">Upload a clip to get started</span>
          </div>
        </button>
      ) : (
        <div className="project-grid">
          <button className="project-card project-card--new" onClick={handleNew} disabled={creating}>
            <div className="project-card--new__inner">
              <div className="project-card--new__icon">{creating ? <span className="spinner" /> : icons.plus}</div>
              <span className="project-card--new__label">New video project</span>
            </div>
          </button>

          {vp.projects.map(p => (
            <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              <div className="project-card__actions">
                <button
                  className="btn btn--icon btn--ghost btn--sm"
                  title="Delete project"
                  onClick={e => { e.stopPropagation(); setConfirmId(p.id) }}
                >
                  {icons.trash}
                </button>
              </div>
              <div className="project-card__header">
                <div className="project-card__icon">{icons.layers}</div>
                <div className="project-card__header-text">
                  <div className="project-card__name">{p.name}</div>
                  <div className="project-card__date">
                    {p.clips.length} clip{p.clips.length !== 1 ? 's' : ''} · {fmtDur(p.durationSeconds)}
                  </div>
                </div>
              </div>
              {confirmId === p.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn--danger btn--sm" onClick={() => handleDelete(p.id)} disabled={deletingId === p.id}>
                    {deletingId === p.id ? <span className="spinner" /> : 'Confirm delete'}
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmId(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Top-level page ───────────────────────────────────────────────────
export function VideoStudioPage({ voiceProfiles, engineCaps }: { voiceProfiles: VoiceProfile[]; engineCaps?: EngineCaps }) {
  const caps: EngineCaps = engineCaps ?? { xtts: true, f5: false }
  const vp = useVideoProjects()
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => { vp.loadProjects() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openProject = vp.projects.find(p => p.id === openId) ?? null

  async function open(id: string) {
    setOpenId(id)
    await vp.loadProject(id)
  }

  const refresh = useCallback(async () => { if (openId) await vp.loadProject(openId) }, [openId, vp])

  if (openId && openProject) {
    return (
      <StudioView
        project={openProject}
        voiceProfiles={voiceProfiles}
        engineCaps={caps}
        onBack={() => setOpenId(null)}
        onRefresh={refresh}
        vp={vp}
      />
    )
  }

  return <ListView vp={vp} onOpen={open} />
}
