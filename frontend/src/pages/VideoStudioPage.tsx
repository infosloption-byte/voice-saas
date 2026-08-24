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
  clip, job, isPreviewing, onPreview, onDub, onDelete, onAddToTimeline, onOpenReview, deleting, onDragStart,
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
  onDragStart?: (e: React.DragEvent) => void
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

  const draggable = clip.status === 'ready'

  return (
    <div
      className={`vs-bincard${isPreviewing ? ' vs-bincard--active' : ''}`}
      onClick={clip.status === 'ready' ? onPreview : undefined}
      style={{ cursor: clip.status === 'ready' ? 'pointer' : 'default' }}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
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
// A plain seconds ruler (TC row in the reference screenshot), with a
// draggable playhead handle (the orange triangle marker + red line in
// the reference). The playhead here is a scrub/reference position for
// editing, not tied to actual multi-clip playback — the project's
// timeline_json entries preview individually (see loadPreview); there's
// no rendered composite to play until Export finishes. See CompositionTrack's
// docblock for why a literal 3-track visual isn't what this builds.
function TimelineRuler({
  totalDuration, zoom, scrubPos, onScrub,
}: {
  totalDuration: number
  zoom: number
  scrubPos: number
  onScrub: (sec: number) => void
}) {
  const step = zoom >= 80 ? 2 : zoom >= 40 ? 5 : zoom >= 20 ? 10 : 30
  const last = Math.max(step, Math.ceil((totalDuration + step) / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= last; t += step) ticks.push(t)

  function xToSec(clientX: number, rulerEl: HTMLElement): number {
    const rect = rulerEl.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left) / zoom)
  }

  function onRulerMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-playhead]')) return
    const el = e.currentTarget as HTMLElement
    onScrub(xToSec(e.clientX, el))
    const onMove = (ev: MouseEvent) => onScrub(xToSec(ev.clientX, el))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const rulerEl = (e.currentTarget as HTMLElement).closest('.vs-track-ruler') as HTMLElement
    if (!rulerEl) return
    const onMove = (ev: MouseEvent) => onScrub(xToSec(ev.clientX, rulerEl))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="vs-track-ruler" style={{ position: 'relative', height: 20, borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onMouseDown={onRulerMouseDown}>
      {ticks.map(t => (
        <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, height: '100%', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
          <div style={{ width: 1, height: 6, background: 'var(--border-2)', marginRight: 3 }} />
          <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
        </div>
      ))}
      <div data-playhead="true" style={{ position: 'absolute', left: scrubPos * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 20 }}>
        <div
          data-playhead="true"
          onMouseDown={onHandleMouseDown}
          title="Drag to scrub"
          style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 14, height: 18,
            background: 'var(--accent)', borderRadius: '3px 3px 2px 2px', cursor: 'ew-resize',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 2,
            boxShadow: '0 2px 6px rgba(201,100,66,0.4)',
          }}
        >
          <svg width="6" height="5" viewBox="0 0 6 5"><polygon points="0,0 6,0 3,5" fill="rgba(255,255,255,0.7)" /></svg>
        </div>
      </div>
    </div>
  )
}

// ── Mini overview strip ─────────────────────────────────────────────
// A zoomed-out proportional view of the whole composition (the top
// strip in the reference screenshot), so scrubbing/orienting doesn't
// require scrolling a zoomed-in track. Click/drag anywhere to jump the
// playhead; a thin outline shows the portion currently visible in the
// zoomed-in track below.
function TimelineOverview({
  timeline, clipsById, totalDuration, scrubPos, onScrub, viewportStart, viewportRatio,
}: {
  timeline: TimelineEntry[]
  clipsById: Map<string, VideoProjectClip>
  totalDuration: number
  scrubPos: number
  onScrub: (sec: number) => void
  viewportStart: number
  viewportRatio: number
}) {
  const safeDur = Math.max(totalDuration, 0.001)
  const offsets: number[] = []
  timeline.reduce((acc, e) => { offsets.push(acc); return acc + Math.max(0, e.trimOut - e.trimIn) }, 0)

  function pctToSec(clientX: number, el: HTMLElement): number {
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * safeDur
  }
  function onMouseDown(e: React.MouseEvent) {
    const el = e.currentTarget as HTMLElement
    onScrub(pctToSec(e.clientX, el))
    const onMove = (ev: MouseEvent) => onScrub(pctToSec(ev.clientX, el))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="vs-overview" onMouseDown={onMouseDown}>
      {timeline.map((entry, idx) => {
        const dur = Math.max(0, entry.trimOut - entry.trimIn)
        const clip = clipsById.get(entry.clipId)
        const isDub = entry.variant === 'dubbed'
        return (
          <div
            key={idx}
            title={clip ? clipLabel(clip) : 'Clip removed from bin'}
            style={{
              position: 'absolute', left: `${(offsets[idx] / safeDur) * 100}%`, width: `${Math.max(0.3, (dur / safeDur) * 100)}%`,
              top: 3, bottom: 3, borderRadius: 2,
              background: isDub ? 'rgba(61,181,100,0.55)' : 'rgba(201,100,66,0.55)',
            }}
          />
        )
      })}
      <div className="vs-overview__viewport" style={{ left: `${viewportStart * 100}%`, width: `${viewportRatio * 100}%` }} />
      <div className="vs-overview__playhead" style={{ left: `${(scrubPos / safeDur) * 100}%` }} />
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
// Fake-but-stable waveform bars for a clip block, in the absence of real
// decoded peak data for video clips (mirrors AssemblyPage's placeholder
// approach for scripts without waveformPeaks — see hashIdx above).
function fakeBars(seed: string, count: number): number[] {
  const out: number[] = []
  for (let j = 0; j < count; j++) {
    out.push(0.2 + Math.abs(Math.sin((seed.charCodeAt(j % seed.length) || 65) * 17 + j * 0.7)) * 0.6)
  }
  return out
}

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
    <div style={{ position: 'relative', height: 62 }}>
      {timeline.map((entry, idx) => {
        const dur = Math.max(0, entry.trimOut - entry.trimIn)
        const left = offsets[idx] * zoom
        const width = Math.max(dur * zoom, 36)
        const clip = clipsById.get(entry.clipId)
        const isSel = idx === selectedIdx
        const isDub = entry.variant === 'dubbed'
        const col = isDub ? '#3db564' : '#c96442'
        const lt = isDub ? 'rgba(61,181,100,0.14)' : 'rgba(201,100,66,0.14)'
        const bars = Math.max(Math.floor((width - 14) / 6), 3)
        const peaks = fakeBars(entry.clipId, bars)
        return (
          <div
            key={idx}
            onClick={e => { e.stopPropagation(); onSelect(idx) }}
            title={clip ? clipLabel(clip) : 'Clip removed from bin'}
            style={{
              position: 'absolute', left, width, top: 4, bottom: 4,
              borderRadius: 7, overflow: 'hidden', cursor: 'pointer', zIndex: isSel ? 5 : 1,
              background: lt,
              border: `1.5px solid ${isSel ? 'var(--accent)' : col + '88'}`,
              boxShadow: isSel ? '0 0 0 2px var(--accent-mid)' : 'none',
            }}
          >
            {/* Header chip — colored label bar, like the reference clip's title strip */}
            <div style={{
              height: 20, background: col + '22', borderBottom: `1px solid ${col}33`,
              display: 'flex', alignItems: 'center', padding: '0 7px', gap: 4,
            }}>
              <span style={{
                fontSize: 10.5, fontWeight: 600, color: col,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
              }}>
                {clip ? clipLabel(clip) : 'Removed clip'}
              </span>
              <span style={{ fontSize: 9, color: col + 'aa', fontFamily: 'var(--mono)', flexShrink: 0 }}>{fmt(Math.floor(dur))}</span>
            </div>
            {/* Waveform-style bars */}
            <div style={{ position: 'absolute', bottom: 5, left: 6, right: 6, display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 26, overflow: 'hidden' }}>
              {peaks.map((p, j) => (
                <div key={j} style={{ width: 3, borderRadius: 2, flexShrink: 0, height: Math.max(2, Math.round(p * 22)) + 'px', background: col + '99' }} />
              ))}
            </div>
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

  // ── Drag-and-drop: OS files → bin upload, bin card → timeline ──────
  const [binDragOver, setBinDragOver] = useState(false)
  const [timelineDragOver, setTimelineDragOver] = useState(false)
  const CLIP_DND_TYPE = 'application/x-vs-clip-id'

  // ── File-browser (bin) filter + search ─────────────────────────────
  const [binFilter, setBinFilter] = useState<'all' | 'source' | 'dubbed'>('all')
  const [binQuery, setBinQuery] = useState('')

  // ── Composition-track zoom (px/sec) ─────────────────────────────────
  const [zoom, setZoom] = useState(40)
  const [scrubPos, setScrubPos] = useState(0)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ start: 0, ratio: 1 })

  // ── Custom transport bar (native controls hidden, like the reference
  // studio's own play/stop/mute row) ──────────────────────────────────
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [curDuration, setCurDuration] = useState(0)
  const [muted, setMuted] = useState(false)

  // A scrub can land on a clip that isn't currently loaded in the preview
  // player — loadPreview() is async, so the seek has to wait until the
  // new source's metadata is actually ready rather than being applied
  // immediately against the old (or not-yet-loaded) video element.
  const pendingSeekRef = useRef<number | null>(null)

  useEffect(() => {
    const v = videoElRef.current
    if (!v) return
    const onTime = () => setCurTime(v.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onLoadedMeta = () => {
      setCurDuration(v.duration || 0)
      if (pendingSeekRef.current != null) {
        v.currentTime = pendingSeekRef.current
        setCurTime(pendingSeekRef.current)
        pendingSeekRef.current = null
      }
    }
    const onDurChange = () => setCurDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('loadedmetadata', onLoadedMeta)
    v.addEventListener('durationchange', onDurChange)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('loadedmetadata', onLoadedMeta)
      v.removeEventListener('durationchange', onDurChange)
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

  // ── Upload — accepts multiple files (picker or drag-drop), uploads
  // sequentially so progress/errors stay attributable to one file at a
  // time rather than firing every request in parallel against the
  // 200MB/mimetype-checked addClip endpoint at once. ──────────────────
  async function pickAndUpload(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setUploading(true)
    let okCount = 0
    for (const file of list) {
      try {
        await vp.uploadClip(project.id, file)
        okCount++
      } catch (e) {
        toast.err(e instanceof ApiError ? `${file.name}: ${e.message}` : `${file.name}: upload failed.`)
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (okCount > 0) toast.ok(okCount === 1 ? 'Clip added to the bin.' : `${okCount} clips added to the bin.`)
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

  function addToTimeline(clip: VideoProjectClip, atIndex?: number) {
    const entry: TimelineEntry = {
      clipId: clip.id,
      trimIn: 0,
      trimOut: clip.durationSeconds ?? 0,
      variant: clip.kind,
    }
    const next = [...timeline]
    const insertAt = atIndex == null ? next.length : Math.max(0, Math.min(atIndex, next.length))
    next.splice(insertAt, 0, entry)
    scheduleSave(next)
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

  // Cumulative start offset (in composed-timeline seconds) of each entry —
  // shared by the composition track's block positions and by scrub-to-clip
  // mapping below, so both agree on where each clip "lives" on the ruler.
  const entryOffsets = useMemo(() => {
    const offsets: number[] = []
    timeline.reduce((acc, e) => { offsets.push(acc); return acc + Math.max(0, e.trimOut - e.trimIn) }, 0)
    return offsets
  }, [timeline])

  function findEntryAtTime(sec: number): { idx: number; localTime: number } | null {
    if (timeline.length === 0) return null
    for (let i = 0; i < timeline.length; i++) {
      const dur = Math.max(0, timeline[i].trimOut - timeline[i].trimIn)
      const start = entryOffsets[i]
      if (sec < start + dur || i === timeline.length - 1) {
        const localTime = timeline[i].trimIn + Math.max(0, Math.min(dur, sec - start))
        return { idx: i, localTime }
      }
    }
    return null
  }

  // ── Scrub the playhead — jumps the actual preview player to whichever
  // clip sits under the new position, seeking within it. If the target
  // clip isn't the one currently loaded, this queues the seek and swaps
  // the preview source; the loadedmetadata handler above applies it once
  // the new source is ready. ──────────────────────────────────────────
  function handleScrub(sec: number) {
    setScrubPos(sec)
    const hit = findEntryAtTime(sec)
    if (!hit) return
    const entry = timeline[hit.idx]
    setSelectedEntryIdx(hit.idx)
    if (previewClipId === entry.clipId) {
      const v = videoElRef.current
      if (v) {
        if (playing) v.pause()
        v.currentTime = hit.localTime
        setCurTime(hit.localTime)
      }
    } else {
      pendingSeekRef.current = hit.localTime
      loadPreview(project.id, entry.clipId)
    }
  }

  // ── Overview viewport indicator — recompute the visible slice of the
  // zoomed-in track (in ratio-of-total-duration terms) whenever the
  // track scrolls or zoom/duration changes. ──────────────────────────
  const updateViewport = useCallback(() => {
    const el = timelineScrollRef.current
    const totalPx = Math.max(totalDuration * zoom + 40, 200)
    if (!el || totalPx <= 0) { setViewport({ start: 0, ratio: 1 }); return }
    setViewport({
      start: Math.max(0, Math.min(1, el.scrollLeft / totalPx)),
      ratio: Math.max(0, Math.min(1, el.clientWidth / totalPx)),
    })
  }, [totalDuration, zoom])
  useEffect(() => { updateViewport() }, [updateViewport, timeline.length])
  const clampedScrubPos = Math.min(scrubPos, totalDuration)

  // ── Drag-and-drop handlers ──────────────────────────────────────────
  function handleBinDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return // ignore an internal clip-card drag re-entering the bin
    e.preventDefault()
    setBinDragOver(true)
  }
  function handleBinDrop(e: React.DragEvent) {
    e.preventDefault()
    setBinDragOver(false)
    if (e.dataTransfer.files?.length) pickAndUpload(e.dataTransfer.files)
  }

  // Nearest insertion index for a drop at a given x offset (px) within
  // the composition track, using each entry's on-screen midpoint —
  // matches how most timeline editors decide "before" vs "after".
  function indexForDropX(offsetX: number): number {
    const dropSec = Math.max(0, offsetX / zoom)
    let cumulative = 0
    for (let i = 0; i < timeline.length; i++) {
      const dur = Math.max(0, timeline[i].trimOut - timeline[i].trimIn)
      if (dropSec < cumulative + dur / 2) return i
      cumulative += dur
    }
    return timeline.length
  }

  function handleTimelineDragOver(e: React.DragEvent) {
    e.preventDefault()
    setTimelineDragOver(true)
  }
  async function handleTimelineDrop(e: React.DragEvent) {
    e.preventDefault()
    setTimelineDragOver(false)
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetX = e.clientX - rect.left + (e.currentTarget as HTMLElement).scrollLeft
    const insertAt = indexForDropX(offsetX)

    const clipId = e.dataTransfer.getData(CLIP_DND_TYPE)
    if (clipId) {
      const clip = clipsById.get(clipId)
      if (clip && clip.status === 'ready') addToTimeline(clip, insertAt)
      return
    }
    if (e.dataTransfer.files?.length) {
      const files = Array.from(e.dataTransfer.files)
      setUploading(true)
      let offset = 0
      for (const file of files) {
        try {
          const clip = await vp.uploadClip(project.id, file)
          if (clip) addToTimeline(clip, insertAt + offset++)
        } catch (err) {
          toast.err(err instanceof ApiError ? `${file.name}: ${err.message}` : `${file.name}: upload failed.`)
        }
      }
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (offset > 0) toast.ok(offset === 1 ? 'Clip added to the timeline.' : `${offset} clips added to the timeline.`)
    }
  }

  function handleBinCardDragStart(e: React.DragEvent, clip: VideoProjectClip) {
    e.dataTransfer.setData(CLIP_DND_TYPE, clip.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

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
        <div
          className={`vs-bin${binDragOver ? ' vs-bin--dragover' : ''}`}
          onDragOver={handleBinDragOver}
          onDragLeave={() => setBinDragOver(false)}
          onDrop={handleBinDrop}
        >
          <div className="vs-bin__head">
            <span className="vs-bin__title">My files</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDur(totalDuration)} on timeline</span>
          </div>

          <button className="btn btn--primary vs-bin__add" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.plus}</span>}
            Add files
          </button>
          <input ref={fileInputRef} type="file" multiple accept="video/mp4,video/quicktime,video/x-matroska,video/webm" style={{ display: 'none' }}
            onChange={e => pickAndUpload(e.target.files)} />

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
            <div className="vs-bin__dropzone-hint">
              <span style={{ display: 'flex', width: 20, height: 20, color: 'var(--text-3)' }}>{icons.plus}</span>
              Drag video files here, or use Add files
            </div>
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
                  onDragStart={e => handleBinCardDragStart(e, clip)}
                />
              ))}
            </div>
          )}
          {binDragOver && <div className="vs-bin__dropzone-overlay">Drop to add to bin</div>}
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
              <div
                className={`vs-timeline-empty${timelineDragOver ? ' vs-timeline-empty--dragover' : ''}`}
                onDragOver={handleTimelineDragOver}
                onDragLeave={() => setTimelineDragOver(false)}
                onDrop={handleTimelineDrop}
              >
                Nothing on the timeline yet — drag a clip here from the bin, or use its + button.
              </div>
            ) : (
              <div className="vs-timeline-body">
                <div className="vs-track">
                  <TimelineOverview
                    timeline={timeline}
                    clipsById={clipsById}
                    totalDuration={totalDuration}
                    scrubPos={clampedScrubPos}
                    onScrub={handleScrub}
                    viewportStart={viewport.start}
                    viewportRatio={viewport.ratio}
                  />
                  <div className="vs-track__label">
                    <span>Track 1 · Timeline</span>
                    <span className="vs-track__count">{timeline.length} clip{timeline.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div
                    ref={timelineScrollRef}
                    className={`vs-timeline-scroll${timelineDragOver ? ' vs-timeline-scroll--dragover' : ''}`}
                    onClick={() => setSelectedEntryIdx(null)}
                    onScroll={updateViewport}
                    onDragOver={handleTimelineDragOver}
                    onDragLeave={() => setTimelineDragOver(false)}
                    onDrop={handleTimelineDrop}
                  >
                    <div style={{ position: 'relative', width: Math.max(totalDuration * zoom + 40, 200) }}>
                      <TimelineRuler totalDuration={totalDuration} zoom={zoom} scrubPos={clampedScrubPos} onScrub={handleScrub} />
                      <CompositionTrack
                        timeline={timeline}
                        clipsById={clipsById}
                        zoom={zoom}
                        selectedIdx={selectedEntryIdx}
                        onSelect={idx => { setSelectedEntryIdx(idx); setScrubPos(entryOffsets[idx]); loadPreview(project.id, timeline[idx].clipId) }}
                      />
                      {/* Playhead line continues down through the clip track */}
                      <div style={{ position: 'absolute', left: clampedScrubPos * zoom, top: 20, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.55, pointerEvents: 'none', zIndex: 15 }} />
                    </div>
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
