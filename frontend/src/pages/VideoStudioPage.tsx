import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, LANGUAGES } from '../lib/constants'
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
}

function clipLabel(clip: VideoProjectClip): string {
  return clip.originalFilename ?? (clip.kind === 'dubbed' ? 'Dubbed clip' : 'Clip')
}

// ── Media bin row ────────────────────────────────────────────────────
function BinRow({
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

  return (
    <div
      onClick={clip.status === 'ready' ? onPreview : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8,
        background: isPreviewing ? 'var(--accent-lt)' : 'transparent',
        border: isPreviewing ? '1px solid var(--accent)' : '1px solid transparent',
        cursor: clip.status === 'ready' ? 'pointer' : 'default',
      }}
    >
      <span style={{ display: 'flex', width: 15, height: 15, color: 'var(--text-3)', flexShrink: 0 }}>
        {clip.kind === 'dubbed' ? icons.globe : icons.video}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {clipLabel(clip)}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-3)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{fmtDur(clip.durationSeconds)}</span>
          {badge && <span className={`tag ${badge.cls}`} style={{ fontSize: 9, padding: '1px 5px' }}>{badge.text}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {job?.status === 'ready_for_review' && (
          <button className="btn btn--ghost btn--sm" title="Open review timeline" onClick={onOpenReview}>
            {icons.edit}
          </button>
        )}
        {clip.status === 'ready' && (
          <button className="btn btn--ghost btn--sm" title="Add to timeline" onClick={onAddToTimeline}>
            {icons.plus}
          </button>
        )}
        {clip.kind === 'source' && clip.status === 'ready' && (
          <button className="btn btn--ghost btn--sm" title="Dub this clip" onClick={onDub}>
            {icons.globe}
          </button>
        )}
        {clip.status !== 'processing' && (
          <button className="btn btn--ghost btn--sm" title="Delete" onClick={onDelete} disabled={deleting}>
            {deleting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.trash}
          </button>
        )}
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

// ── Timeline row ─────────────────────────────────────────────────────
function TimelineRow({
  entry, clip, index, total, onMoveUp, onMoveDown, onRemove, onTrimChange, onSelect, isSelected,
}: {
  entry: TimelineEntry
  clip: VideoProjectClip | undefined
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onTrimChange: (trimIn: number, trimOut: number) => void
  onSelect: () => void
  isSelected: boolean
}) {
  const maxDur = clip?.durationSeconds ?? Math.max(entry.trimOut, 1)
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
        background: isSelected ? 'var(--accent-lt)' : 'var(--surface-2)',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-2)'}`, cursor: 'pointer',
      }}
    >
      <span className={`tag ${entry.variant === 'dubbed' ? 'tag--accent' : ''}`} style={{ fontSize: 9, padding: '1px 5px', flexShrink: 0 }}>
        {entry.variant === 'dubbed' ? 'DUB' : 'ORIG'}
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {clip ? clipLabel(clip) : 'Clip removed from bin'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <input
          type="number" min={0} max={maxDur} step={0.1} value={entry.trimIn}
          onChange={e => onTrimChange(Math.max(0, Number(e.target.value)), entry.trimOut)}
          style={{ width: 52, fontSize: 11, padding: '3px 5px', borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text-1)' }}
        />
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>→</span>
        <input
          type="number" min={0} max={maxDur} step={0.1} value={entry.trimOut}
          onChange={e => onTrimChange(entry.trimIn, Math.min(maxDur, Number(e.target.value)))}
          style={{ width: 52, fontSize: 11, padding: '3px 5px', borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text-1)' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button className="btn btn--ghost btn--sm" disabled={index === 0} onClick={onMoveUp} title="Move earlier">↑</button>
        <button className="btn btn--ghost btn--sm" disabled={index === total - 1} onClick={onMoveDown} title="Move later">↓</button>
        <button className="btn btn--ghost btn--sm" onClick={onRemove} title="Remove from timeline">{icons.close}</button>
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

  const sourceClips = useMemo(() => project.clips.filter(c => c.kind === 'source'), [project.clips])
  const dubbedClips = useMemo(() => project.clips.filter(c => c.kind === 'dubbed'), [project.clips])
  const clipsById = useMemo(() => new Map(project.clips.map(c => [c.id, c])), [project.clips])
  const jobsById = useMemo(() => new Map(jobs.map(j => [j.job_id, j])), [jobs])

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

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost btn--sm" onClick={onBack}>{icons.back}</button>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ fontSize: 18, fontWeight: 700, border: 'none', background: 'transparent', color: 'var(--text-1)', flex: 1, minWidth: 160 }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmtDur(totalDuration)} on timeline</span>

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
            {downloading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.download} Download
          </button>
        )}
        <button
          className="btn btn--primary btn--sm"
          onClick={handleRender}
          disabled={rendering || isRendering || timeline.length === 0}
          title={timeline.length === 0 ? 'Add clips to the timeline first' : 'Render this timeline into one video'}
        >
          {(rendering || isRendering) ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
          {isRendering ? 'Rendering…' : project.status === 'done' ? 'Re-render' : 'Render'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Media bin */}
        <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-3)' }}>
                Original clips
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Add a clip">
                {uploading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.upload}
              </button>
              <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm" style={{ display: 'none' }}
                onChange={e => pickAndUpload(e.target.files?.[0] ?? null)} />
            </div>
            {sourceClips.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 2px' }}>No clips yet — add one to get started.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sourceClips.map(clip => (
                  <BinRow
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

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-3)', marginBottom: 8 }}>
              Dubbed variants
            </div>
            {dubbedClips.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 2px' }}>Dub a clip above to see variants here.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dubbedClips.map(clip => (
                  <BinRow
                    key={clip.id}
                    clip={clip}
                    job={clip.dubbingJobId ? jobsById.get(clip.dubbingJobId) : undefined}
                    isPreviewing={previewClipId === clip.id}
                    onPreview={() => loadPreview(project.id, clip.id)}
                    onDub={() => {}}
                    onDelete={() => deleteClip(clip)}
                    onAddToTimeline={() => addToTimeline(clip)}
                    onOpenReview={() => clip.dubbingJobId && setReviewJobId(clip.dubbingJobId)}
                    deleting={deletingClipId === clip.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview + timeline */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {previewLoading ? (
              <span className="spinner" />
            ) : previewUrl ? (
              <video key={previewClipId} src={previewUrl} controls style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Select a clip from the bin to preview it</span>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-3)', marginBottom: 8 }}>
              Video timeline
            </div>
            {timeline.length === 0 ? (
              <div style={{
                border: '1.5px dashed var(--border-2)', borderRadius: 10, padding: '28px 16px',
                textAlign: 'center', fontSize: 12.5, color: 'var(--text-3)',
              }}>
                Nothing on the timeline yet — use the + on a bin clip to add it here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {timeline.map((entry, idx) => (
                  <TimelineRow
                    key={idx}
                    entry={entry}
                    clip={clipsById.get(entry.clipId)}
                    index={idx}
                    total={timeline.length}
                    isSelected={selectedEntryIdx === idx}
                    onSelect={() => { setSelectedEntryIdx(idx); loadPreview(project.id, entry.clipId) }}
                    onMoveUp={() => moveEntry(idx, -1)}
                    onMoveDown={() => moveEntry(idx, 1)}
                    onRemove={() => removeEntry(idx)}
                    onTrimChange={(trimIn, trimOut) => trimEntry(idx, trimIn, trimOut)}
                  />
                ))}
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
