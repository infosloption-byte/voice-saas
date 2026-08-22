import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, LANGUAGES } from '../lib/constants'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useTTSEngine } from '../hooks/useTTSEngine'
import { EngineSwitcher, EngineBadge } from '../components/EngineSwitcher'
import type { VoiceProfile, EngineCaps } from '../lib/types'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024   // mirrors VideoDubbingController::MAX_UPLOAD_KB (204800 KB)
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
const LIST_POLL_MS = 6000   // /dubbing is throttled 60/min — 6s stays well under that regardless of job count

type JobStatus = 'queued' | 'transcribing' | 'translating' | 'synthesizing' | 'muxing' | 'done' | 'failed'

const STAGE_META: Record<JobStatus, { label: string; pct: number }> = {
  queued:       { label: 'Queued',                    pct: 0 },
  transcribing: { label: 'Transcribing audio',        pct: 5 },
  translating:  { label: 'Translating script',        pct: 25 },
  synthesizing: { label: 'Synthesizing dubbed voice',  pct: 45 },
  muxing:       { label: 'Combining with video',       pct: 85 },
  done:         { label: 'Done',                       pct: 100 },
  failed:       { label: 'Failed',                     pct: 0 },
}

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

type SegmentStatus = 'ok' | 'overflow' | 'empty' | 'synth_failed'

interface SegmentRow {
  id: number
  segment_index: number
  start_time: number
  end_time: number
  original_text: string
  translated_text: string
  voice_profile_id: string | null
  muted: boolean
  status: SegmentStatus
  stretch_ratio: number | null
  has_audio: boolean
}

const SEGMENT_STATUS_META: Record<SegmentStatus, { label: string; tagClass: string }> = {
  ok:           { label: 'Fit',     tagClass: 'tag--ok' },
  overflow:     { label: 'Overran', tagClass: 'tag--warn' },
  empty:        { label: 'Silent',  tagClass: '' },
  synth_failed: { label: 'Failed',  tagClass: 'tag--warn' },
}

function fmtTimestamp(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function langLabel(code: string | null): string {
  if (!code) return 'Auto-detect'
  return LANGUAGES.find(l => l.code === code)?.label ?? code.toUpperCase()
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function fmtDuration(secs: number | null): string | null {
  if (!secs || secs <= 0) return null
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function isJobRunning(j: JobRow): boolean {
  return j.status !== 'done' && j.status !== 'failed'
}

// ── Advanced (Tier 1) segment editor ────────────────────────────────
function SegmentEditor({
  job, segments, loaded, voiceProfiles, editingSegmentId, editText, setEditText,
  segmentBusy, remuxBusy, playingSegmentId,
  onStartEdit, onCancelEdit, onSaveEdit, onToggleMute, onSetVoice, onResynthesize, onPlay, onApplyRemux,
}: {
  job: JobRow
  segments: SegmentRow[]
  loaded: boolean
  voiceProfiles: VoiceProfile[]
  editingSegmentId: number | null
  editText: string
  setEditText: (v: string) => void
  segmentBusy: Record<number, boolean>
  remuxBusy: boolean
  playingSegmentId: number | null
  onStartEdit: (s: SegmentRow) => void
  onCancelEdit: () => void
  onSaveEdit: (s: SegmentRow) => void
  onToggleMute: (s: SegmentRow) => void
  onSetVoice: (s: SegmentRow, voiceProfileId: string) => void
  onResynthesize: (s: SegmentRow) => void
  onPlay: (s: SegmentRow) => void
  onApplyRemux: () => void
}) {
  if (!loaded) {
    return <div style={{ textAlign: 'center', padding: '50px 0' }}><span className="spinner" /></div>
  }
  if (segments.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No segment data for this job — it was dubbed before the advanced editor existed.
        Use "Dub again" to create a new job with editable segments.
      </div>
    )
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Edit text, mute, or reassign a voice per line, then apply your changes to rebuild the video —
          no need to redo transcription or translation.
        </div>
        <button className="btn btn--primary btn--sm" onClick={onApplyRemux} disabled={remuxBusy} style={{ flexShrink: 0, marginLeft: 12 }}>
          {remuxBusy ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
          {remuxBusy ? 'Rebuilding…' : 'Apply changes'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'min(58vh, 480px)', overflowY: 'auto' }}>
        {segments.map(seg => {
          const meta = SEGMENT_STATUS_META[seg.status]
          const busy = !!segmentBusy[seg.id]
          const isEditing = editingSegmentId === seg.id
          const currentVoice = seg.voice_profile_id ?? ''

          return (
            <div key={seg.id} style={{
              border: '1px solid var(--border-2)', borderRadius: 8, padding: 12,
              opacity: seg.muted ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtTimestamp(seg.start_time)}–{fmtTimestamp(seg.end_time)}
                </span>
                <span className={`tag ${meta.tagClass}`} style={{ fontSize: 10 }}>{meta.label}</span>
                {seg.stretch_ratio != null && seg.stretch_ratio !== 1 && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{seg.stretch_ratio.toFixed(2)}×</span>
                )}
                <div style={{ flex: 1 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-3)', cursor: busy ? 'default' : 'pointer' }}>
                  <input type="checkbox" checked={seg.muted} disabled={busy} onChange={() => onToggleMute(seg)} />
                  Mute (keep original audio)
                </label>
              </div>

              {seg.original_text && (
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 6, fontStyle: 'italic' }}>
                  "{seg.original_text}"
                </div>
              )}

              {isEditing ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="full-input"
                    rows={2}
                    style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
                    autoFocus
                    disabled={busy}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn--primary btn--sm" onClick={() => onSaveEdit(seg)} disabled={busy}>Save</button>
                    <button className="btn btn--ghost btn--sm" onClick={onCancelEdit} disabled={busy}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => !busy && !seg.muted && onStartEdit(seg)}
                  style={{ fontSize: 13.5, cursor: seg.muted ? 'default' : 'text', padding: '4px 0', minHeight: 20 }}
                  title={seg.muted ? undefined : 'Click to edit'}
                >
                  {seg.translated_text || <span style={{ color: 'var(--text-3)' }}>(empty)</span>}
                </div>
              )}

              {seg.status === 'synth_failed' && (
                <div style={{ fontSize: 11.5, color: 'var(--danger, #d9534f)', marginTop: 4 }}>
                  Synthesis failed for this segment — original silence was used instead.
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {voiceProfiles.length > 0 && !seg.muted && (
                  <select
                    value={currentVoice}
                    onChange={e => onSetVoice(seg, e.target.value)}
                    className="full-input"
                    disabled={busy}
                    style={{ fontSize: 12, padding: '4px 8px', width: 'auto', flex: '0 1 auto' }}
                    title="Voice for this segment (defaults to the job's voice)"
                  >
                    <option value="">Default voice</option>
                    {voiceProfiles.map(p => (
                      <option key={p.profile_id} value={p.profile_id}>{p.name}</option>
                    ))}
                  </select>
                )}
                <div style={{ flex: 1 }} />
                {seg.has_audio && !seg.muted && (
                  <button className="btn btn--ghost btn--sm" onClick={() => onPlay(seg)} disabled={busy}>
                    {playingSegmentId === seg.id ? 'Stop' : '▶ Preview'}
                  </button>
                )}
                {!seg.muted && (
                  <button className="btn btn--ghost btn--sm" onClick={() => onResynthesize(seg)} disabled={busy}>
                    {busy ? <span className="spinner" style={{ marginRight: 4 }} /> : null}
                    Resynthesize
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DubbingPage({ voiceProfiles, engineCaps }: { voiceProfiles: VoiceProfile[]; engineCaps?: EngineCaps }) {
  const caps: EngineCaps = engineCaps ?? { xtts: true, f5: false }
  const { engine, setEngine } = useTTSEngine()
  // ── New-dub / retry dialog (enhancement #2: both are a popup now, and
  // retry never touches the file input — it reuses the video already
  // sitting in storage from the original job) ────────────────────────
  const [dialogMode, setDialogMode] = useState<'closed' | 'new' | 'retry'>('closed')
  const [retrySource, setRetrySource] = useState<JobRow | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('es')
  const [sourceLanguage, setSourceLanguage] = useState('')   // '' = auto-detect
  const [profileId, setProfileId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Workspace list state ───────────────────────────────────────────
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [listLoaded, setListLoaded] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Detail panel (enhancement #3: selecting a job no longer opens a
  // modal — it switches the page into a list+detail layout instead) ──
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState<'dubbed' | 'original' | 'advanced'>('dubbed')
  const [previewUrls, setPreviewUrls] = useState<Record<string, { source?: string; result?: string }>>({})
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── Advanced dubbing (Tier 1) — per-segment editor ─────────────────
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [segmentsLoadedFor, setSegmentsLoadedFor] = useState<string | null>(null)
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [segmentBusy, setSegmentBusy] = useState<Record<number, boolean>>({})
  const [remuxBusy, setRemuxBusy] = useState(false)
  const [playingSegmentId, setPlayingSegmentId] = useState<number | null>(null)
  const segmentAudioRef = useRef<HTMLAudioElement | null>(null)
  const segmentAudioUrlsRef = useRef<Record<number, string>>({})

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const effectiveProfileId = profileId || voiceProfiles[0]?.profile_id || ''
  // Derived from the live `jobs` list (not a snapshot) so the detail panel
  // keeps reflecting reality — e.g. a running job finishing while its
  // panel is open — rather than freezing at whatever state it was in
  // the moment it was selected.
  const selectedJob = jobs.find(j => j.job_id === selectedJobId) ?? null

  // ── List polling — single endpoint covers every job in flight ──────
  const refreshList = useCallback(async () => {
    try {
      const res = await api.listDubbingJobs() as { jobs: JobRow[] }
      setJobs(res.jobs ?? [])
    } catch {
      // Transient network hiccup — next tick will retry, no need to toast every miss.
    } finally {
      setListLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshList()
    pollRef.current = setInterval(refreshList, LIST_POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refreshList])

  // Revoke any blob URLs we created when the page unmounts.
  useEffect(() => () => {
    Object.values(previewUrls).forEach(u => {
      if (u.source) URL.revokeObjectURL(u.source)
      if (u.result) URL.revokeObjectURL(u.result)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runningCount = useMemo(() => jobs.filter(isJobRunning).length, [jobs])

  function pickFile(f: File | null) {
    if (!f) { setFile(null); return }
    if (!ACCEPTED_TYPES.includes(f.type)) {
      toast.err('Unsupported file type. Use MP4, MOV, MKV, or WebM.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.err(`File is too large (${(f.size / 1024 / 1024).toFixed(0)}MB). Max is 200MB.`)
      return
    }
    setFile(f)
  }

  // ── Dialog open/close ───────────────────────────────────────────────
  function openNewDialog() {
    setRetrySource(null)
    setFile(null)
    setTargetLanguage('es')
    setSourceLanguage('')
    setProfileId('')
    setDialogMode('new')
  }

  /** Retry/"Dub again" — the video is already in storage, so this only
   *  asks for what might change (language, voice), pre-filled from the
   *  original job; no file picker, no re-upload. */
  function openRetryDialog(job: JobRow) {
    if (!job.has_source) {
      toast.err('The original upload is no longer available for this job.')
      return
    }
    setRetrySource(job)
    setFile(null)
    setTargetLanguage(job.target_language)
    setSourceLanguage(job.source_language ?? '')
    setProfileId(job.voice_profile_id)
    if (job.engine === 'xtts' || job.engine === 'f5' || job.engine === 'chatterbox') {
      setEngine(job.engine)
    }
    setDialogMode('retry')
  }

  function closeDialog() {
    if (submitting) return
    setDialogMode('closed')
  }
  useEscapeKey(closeDialog, dialogMode !== 'closed')

  async function handleDialogSubmit() {
    if (!effectiveProfileId) { toast.err('Choose a voice to dub with.'); return }
    if (!targetLanguage) { toast.err('Choose a target language.'); return }

    if (dialogMode === 'retry' && retrySource) {
      setSubmitting(true)
      try {
        await api.retryDubbingJob(retrySource.job_id, {
          target_language: targetLanguage,
          source_language: sourceLanguage || undefined,
          voice_profile_id: effectiveProfileId,
          engine,
        })
        toast.ok('Dubbing job queued — it will appear in the list.')
        setDialogMode('closed')
        refreshList()
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
      fd.append('target_language', targetLanguage)
      if (sourceLanguage) fd.append('source_language', sourceLanguage)
      fd.append('voice_profile_id', effectiveProfileId)
      fd.append('engine', engine)

      await api.postWithProgress('/dubbing/submit', fd, setUploadProgress)
      toast.ok('Dubbing job queued — it will appear in the list.')
      setDialogMode('closed')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      refreshList()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to start dubbing.')
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
    }
  }

  // ── Detail panel media loading ──────────────────────────────────────
  const loadPreviewMedia = useCallback(async (job: JobRow) => {
    const cached = previewUrls[job.job_id]
    const needResult = job.has_result && !cached?.result
    const needSource = job.has_source && !cached?.source
    if (!needResult && !needSource) return

    setPreviewLoading(true)
    try {
      const [resultBlob, sourceBlob] = await Promise.all([
        needResult ? api.fetchDubbingResult(job.job_id).catch(() => null) : Promise.resolve(null),
        needSource ? api.fetchDubbingSource(job.job_id).catch(() => null) : Promise.resolve(null),
      ])
      setPreviewUrls(prev => ({
        ...prev,
        [job.job_id]: {
          source: sourceBlob ? URL.createObjectURL(sourceBlob) : prev[job.job_id]?.source,
          result: resultBlob ? URL.createObjectURL(resultBlob) : prev[job.job_id]?.result,
        },
      }))
    } finally {
      setPreviewLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectJob(job: JobRow) {
    setSelectedJobId(job.job_id)
    setPreviewTab(job.has_result ? 'dubbed' : 'original')
    loadPreviewMedia(job)
  }

  // ── Advanced (Tier 1): per-segment editor ──────────────────────────
  const loadSegments = useCallback(async (jobId: string, force = false) => {
    if (!force && segmentsLoadedFor === jobId) return
    try {
      const res = await api.listDubbingSegments(jobId) as { segments: SegmentRow[] }
      setSegments(res.segments ?? [])
      setSegmentsLoadedFor(jobId)
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to load segments.')
    }
  }, [segmentsLoadedFor])

  function openAdvancedTab() {
    setPreviewTab('advanced')
    if (selectedJob) loadSegments(selectedJob.job_id)
  }

  function startEditingSegment(seg: SegmentRow) {
    setEditingSegmentId(seg.id)
    setEditText(seg.translated_text)
  }

  async function saveSegmentText(seg: SegmentRow) {
    if (!selectedJob) return
    if (editText === seg.translated_text) { setEditingSegmentId(null); return }
    setSegmentBusy(prev => ({ ...prev, [seg.id]: true }))
    try {
      const res = await api.updateDubbingSegment(selectedJob.job_id, seg.id, { translated_text: editText }) as { segment: SegmentRow }
      setSegments(prev => prev.map(s => s.id === seg.id ? res.segment : s))
      setEditingSegmentId(null)
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSegmentBusy(prev => ({ ...prev, [seg.id]: false }))
    }
  }

  async function toggleMute(seg: SegmentRow) {
    if (!selectedJob) return
    setSegmentBusy(prev => ({ ...prev, [seg.id]: true }))
    try {
      const res = await api.updateDubbingSegment(selectedJob.job_id, seg.id, { muted: !seg.muted }) as { segment: SegmentRow }
      setSegments(prev => prev.map(s => s.id === seg.id ? res.segment : s))
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to update.')
    } finally {
      setSegmentBusy(prev => ({ ...prev, [seg.id]: false }))
    }
  }

  async function setSegmentVoice(seg: SegmentRow, voiceProfileId: string) {
    if (!selectedJob) return
    setSegmentBusy(prev => ({ ...prev, [seg.id]: true }))
    try {
      // '' means "use the job's default voice" — send null to clear the override.
      const res = await api.updateDubbingSegment(selectedJob.job_id, seg.id, { voice_profile_id: voiceProfileId || null }) as { segment: SegmentRow }
      setSegments(prev => prev.map(s => s.id === seg.id ? res.segment : s))
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to update voice.')
    } finally {
      setSegmentBusy(prev => ({ ...prev, [seg.id]: false }))
    }
  }

  async function resynthesizeSegment(seg: SegmentRow) {
    if (!selectedJob) return
    // Any unsaved text edit on this row should apply before resynthesizing,
    // or the resynth would use stale text.
    if (editingSegmentId === seg.id && editText !== seg.translated_text) {
      await saveSegmentText(seg)
    }
    setSegmentBusy(prev => ({ ...prev, [seg.id]: true }))
    try {
      const res = await api.resynthesizeDubbingSegment(selectedJob.job_id, seg.id) as { segment: SegmentRow }
      setSegments(prev => prev.map(s => s.id === seg.id ? res.segment : s))
      // Stale audio blob, if this segment was ever played — force a refetch next play.
      const cached = segmentAudioUrlsRef.current[seg.id]
      if (cached) { URL.revokeObjectURL(cached); delete segmentAudioUrlsRef.current[seg.id] }
      toast.ok('Segment resynthesized.')
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Resynthesis failed.')
    } finally {
      setSegmentBusy(prev => ({ ...prev, [seg.id]: false }))
    }
  }

  async function playSegment(seg: SegmentRow) {
    if (!selectedJob) return
    if (playingSegmentId === seg.id) {
      segmentAudioRef.current?.pause()
      setPlayingSegmentId(null)
      return
    }
    try {
      let url = segmentAudioUrlsRef.current[seg.id]
      if (!url) {
        const blob = await api.fetchDubbingSegmentAudio(selectedJob.job_id, seg.id)
        url = URL.createObjectURL(blob)
        segmentAudioUrlsRef.current[seg.id] = url
      }
      if (!segmentAudioRef.current) segmentAudioRef.current = new Audio()
      const audioEl = segmentAudioRef.current
      audioEl.src = url
      audioEl.onended = () => setPlayingSegmentId(null)
      await audioEl.play()
      setPlayingSegmentId(seg.id)
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Could not play this segment — it may not have audio yet.')
    }
  }

  async function applyRemux() {
    if (!selectedJob) return
    setRemuxBusy(true)
    try {
      await api.remuxDubbingJob(selectedJob.job_id)
      toast.ok('Video rebuilt with your changes.')
      // The result changed — drop the cached preview blob so it refetches,
      // and jump back to the Dubbed tab to show the updated video.
      setPreviewUrls(prev => {
        const cached = prev[selectedJob.job_id]
        if (cached?.result) URL.revokeObjectURL(cached.result)
        return { ...prev, [selectedJob.job_id]: { ...cached, result: undefined } }
      })
      await refreshList()
      setPreviewTab('dubbed')
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Remux failed.')
    } finally {
      setRemuxBusy(false)
    }
  }

  // Release segment audio blob URLs on unmount, same pattern as the
  // source/result preview blobs elsewhere in this component.
  useEffect(() => () => {
    Object.values(segmentAudioUrlsRef.current).forEach(u => URL.revokeObjectURL(u))
  }, [])

  // Keep media in sync if the selected job transitions (e.g. finishes)
  // while its panel is already open — the panel doesn't need to be
  // reopened to pick up the freshly-available result.
  useEffect(() => {
    if (selectedJob) loadPreviewMedia(selectedJob)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.job_id, selectedJob?.has_result, selectedJob?.has_source])

  async function handleDownload(job: JobRow) {
    try {
      const cached = previewUrls[job.job_id]?.result
      const blob = cached
        ? await fetch(cached).then(r => r.blob())
        : await api.fetchDubbingResult(job.job_id)
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

  async function handleDelete(jobId: string) {
    setDeletingId(jobId)
    try {
      await api.deleteDubbingJob(jobId)
      setJobs(prev => prev.filter(j => j.job_id !== jobId))
      setPreviewUrls(prev => {
        const { [jobId]: gone, ...rest } = prev
        if (gone?.source) URL.revokeObjectURL(gone.source)
        if (gone?.result) URL.revokeObjectURL(gone.result)
        return rest
      })
      if (selectedJobId === jobId) setSelectedJobId(null)
      toast.ok('Deleted.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not delete this job.')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const activePreviewUrls = selectedJob ? previewUrls[selectedJob.job_id] : undefined
  const dialogTitle = dialogMode === 'retry' ? (retrySource?.status === 'failed' ? 'Retry dubbing' : 'Dub again') : 'New dub'

  return (
    <div style={{ maxWidth: selectedJob ? 1180 : 920, margin: '0 auto', padding: '32px 20px 60px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', width: 22, height: 22, color: 'var(--accent)' }}>{icons.video}</span>
          <h2 style={{ margin: 0 }}>Dubbing Studio</h2>
          {runningCount > 0 && (
            <span className="tag tag--accent">{runningCount} running</span>
          )}
        </div>
        <button className="btn btn--primary btn--sm" onClick={openNewDialog}>
          {icons.plus}<span className="btn__label"> New Dub</span>
        </button>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginBottom: 22 }}>
        Upload as many videos as you like — each one dubs independently, so you can queue several at once and check back as they finish.
      </p>

      {/* ── Job history / workspace ── */}
      {!listLoaded ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-3)' }}>
          <span className="spinner" />
        </div>
      ) : jobs.length === 0 ? (
        <button className="project-card project-card--new" onClick={openNewDialog} style={{ width: '100%' }}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{icons.upload}</div>
            <span className="project-card--new__label">Dub your first video</span>
            <span className="project-card--new__hint">Upload a video to get started</span>
          </div>
        </button>
      ) : selectedJob ? (
        /* ── List + detail layout — replaces the old preview popup. Selecting
           a job collapses the grid into a compact left-hand list and opens
           a full detail panel on the right, rather than overlaying a modal. ── */
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '78vh', overflowY: 'auto', paddingRight: 2 }}>
            {jobs.map(job => {
              const running = isJobRunning(job)
              return (
                <button
                  key={job.job_id}
                  onClick={() => selectJob(job)}
                  style={{
                    display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)', padding: '10px 12px',
                    background: job.job_id === selectedJobId ? 'var(--accent-lt)' : 'var(--surface)',
                    border: job.job_id === selectedJobId ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', width: 15, height: 15, color: 'var(--text-3)', flexShrink: 0 }}>{icons.video}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={job.original_filename ?? job.job_id}>
                        {job.original_filename ?? 'Untitled video'}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{timeAgo(job.created_at)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {job.status === 'done' && <span className="tag tag--ok" style={{ fontSize: 10 }}>Done</span>}
                    {job.status === 'failed' && <span className="tag tag--warn" style={{ fontSize: 10 }}>Failed</span>}
                    {running && <span className="tag tag--accent" style={{ fontSize: 10 }}>{STAGE_META[job.status].label}</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {/* ── Detail panel ── */}
          <div style={{ flex: 1, minWidth: 0, border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setSelectedJobId(null)} style={{ gap: 4 }}>
                <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.back}</span><span className="btn__label">All dubs</span>
              </button>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {selectedJob.status === 'done' && (
                  <button className="btn btn--ghost btn--sm" onClick={() => handleDownload(selectedJob)} title="Download">{icons.download}</button>
                )}
                {(selectedJob.status === 'done' || selectedJob.status === 'failed') && selectedJob.has_source && (
                  <button className="btn btn--ghost btn--sm" onClick={() => openRetryDialog(selectedJob)} title={selectedJob.status === 'failed' ? 'Retry' : 'Dub again'}>{icons.redo}</button>
                )}
                {(selectedJob.status === 'done' || selectedJob.status === 'failed') && (
                  confirmDeleteId === selectedJob.job_id ? (
                    <>
                      <button className="btn btn--danger btn--sm" onClick={() => handleDelete(selectedJob.job_id)} disabled={deletingId === selectedJob.job_id}>
                        {deletingId === selectedJob.job_id ? <span className="spinner" /> : 'Confirm'}
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDeleteId(selectedJob.job_id)} title="Delete">{icons.trash}</button>
                  )
                )}
              </div>
            </div>

            <h3 style={{ margin: '0 0 8px' }} title={selectedJob.original_filename ?? selectedJob.job_id}>
              {selectedJob.original_filename ?? 'Untitled video'}
            </h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="tag">{langLabel(selectedJob.source_language)} → {langLabel(selectedJob.target_language)}</span>
              <span className="tag tag--info">{selectedJob.voice_name}</span>
              {(selectedJob.engine === 'xtts' || selectedJob.engine === 'f5' || selectedJob.engine === 'chatterbox') && (
                <EngineBadge engine={selectedJob.engine} />
              )}
              {selectedJob.status === 'done' && <span className="tag tag--ok">Done</span>}
              {selectedJob.status === 'failed' && <span className="tag tag--warn">Failed</span>}
              {isJobRunning(selectedJob) && <span className="tag tag--accent">{STAGE_META[selectedJob.status].label}</span>}
            </div>

            {isJobRunning(selectedJob) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, color: 'var(--text-3)' }}>
                  <span>{STAGE_META[selectedJob.status].label}</span>
                  <span>{selectedJob.progress ?? STAGE_META[selectedJob.status].pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${selectedJob.progress ?? STAGE_META[selectedJob.status].pct}%`, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )}

            {selectedJob.status === 'failed' && selectedJob.error && (
              <div style={{ fontSize: 13, color: 'var(--danger, #d9534f)', marginBottom: 14, lineHeight: 1.5 }}>
                {selectedJob.error}
              </div>
            )}

            {typeof selectedJob.segment_overflow_count === 'number' && selectedJob.segment_overflow_count > 0 && selectedJob.status === 'done' && (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 12 }}>
                {selectedJob.segment_overflow_count} segment(s) drifted slightly from original timing
              </div>
            )}

            {(selectedJob.has_result || selectedJob.has_source || selectedJob.status === 'done') && (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {selectedJob.has_result && (
                    <button className={`btn btn--sm ${previewTab === 'dubbed' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPreviewTab('dubbed')}>Dubbed</button>
                  )}
                  {selectedJob.has_source && (
                    <button className={`btn btn--sm ${previewTab === 'original' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPreviewTab('original')}>Original</button>
                  )}
                  {selectedJob.status === 'done' && (
                    <button className={`btn btn--sm ${previewTab === 'advanced' ? 'btn--primary' : 'btn--ghost'}`} onClick={openAdvancedTab}>
                      Advanced
                    </button>
                  )}
                </div>

                {previewTab === 'advanced' ? (
                  <SegmentEditor
                    job={selectedJob}
                    segments={segments}
                    loaded={segmentsLoadedFor === selectedJob.job_id}
                    voiceProfiles={voiceProfiles}
                    editingSegmentId={editingSegmentId}
                    editText={editText}
                    setEditText={setEditText}
                    segmentBusy={segmentBusy}
                    remuxBusy={remuxBusy}
                    playingSegmentId={playingSegmentId}
                    onStartEdit={startEditingSegment}
                    onCancelEdit={() => setEditingSegmentId(null)}
                    onSaveEdit={saveSegmentText}
                    onToggleMute={toggleMute}
                    onSetVoice={setSegmentVoice}
                    onResynthesize={resynthesizeSegment}
                    onPlay={playSegment}
                    onApplyRemux={applyRemux}
                  />
                ) : previewLoading && !activePreviewUrls?.[previewTab === 'dubbed' ? 'result' : 'source'] ? (
                  <div style={{ textAlign: 'center', padding: '50px 0' }}><span className="spinner" /></div>
                ) : (
                  // Capped height + object-fit: contain so a portrait/vertical
                  // clip (very common for short-form video) letterboxes within
                  // a fixed box instead of stretching the whole panel to the
                  // clip's full scaled height.
                  <video
                    key={`${selectedJob.job_id}-${previewTab}`}
                    src={previewTab === 'dubbed' ? activePreviewUrls?.result : activePreviewUrls?.source}
                    controls
                    style={{
                      display: 'block', width: '100%', maxHeight: 'min(58vh, 480px)',
                      objectFit: 'contain', background: '#000', borderRadius: 8, margin: '0 auto',
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── Grid view (default) ── */
        <div className="project-grid">
          {jobs.map(job => {
            const stage = STAGE_META[job.status]
            const pct = job.status === 'done' ? 100 : (job.progress ?? stage.pct)
            const running = isJobRunning(job)
            const durationStr = fmtDuration(job.duration_seconds)

            return (
              <div
                key={job.job_id}
                className="project-card"
                onClick={() => (job.has_result || job.has_source) && selectJob(job)}
                style={{ cursor: (job.has_result || job.has_source) ? 'pointer' : 'default' }}
              >
                <div className="project-card__header">
                  <div className="project-card__icon">{icons.video}</div>
                  <div className="project-card__header-text">
                    <div className="project-card__name" title={job.original_filename ?? job.job_id}>
                      {job.original_filename ?? 'Untitled video'}
                    </div>
                    <div className="project-card__date">
                      {timeAgo(job.created_at)}{durationStr ? ` · ${durationStr}` : ''}
                    </div>
                  </div>
                </div>

                <div className="project-card__tags">
                  <span className="tag">{langLabel(job.source_language)} → {langLabel(job.target_language)}</span>
                  <span className="tag tag--info">{job.voice_name}</span>
                  {job.status === 'done' && <span className="tag tag--ok">Done</span>}
                  {job.status === 'failed' && <span className="tag tag--warn">Failed</span>}
                  {running && <span className="tag tag--accent">{stage.label}</span>}
                </div>

                {running && (
                  <div className="project-card__progress">
                    <div className="project-card__progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                )}

                {job.status === 'failed' && job.error && (
                  <div style={{ fontSize: 12, color: 'var(--warn, #a07530)', lineHeight: 1.5 }}>
                    {job.error}
                  </div>
                )}

                {typeof job.segment_overflow_count === 'number' && job.segment_overflow_count > 0 && job.status === 'done' && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {job.segment_overflow_count} segment(s) drifted slightly from original timing
                  </div>
                )}

                <div
                  className="project-card__actions"
                  style={{ position: 'static', display: 'flex', marginTop: 2 }}
                  onClick={e => e.stopPropagation()}
                >
                  {job.status === 'done' && (
                    <button className="btn btn--ghost btn--sm" onClick={() => handleDownload(job)} title="Download">
                      {icons.download}
                    </button>
                  )}
                  {(job.status === 'done' || job.status === 'failed') && job.has_source && (
                    <button className="btn btn--ghost btn--sm" onClick={() => openRetryDialog(job)} title={job.status === 'failed' ? 'Retry' : 'Dub again'}>
                      {icons.redo}
                    </button>
                  )}
                  {(job.status === 'done' || job.status === 'failed') && (
                    confirmDeleteId === job.job_id ? (
                      <>
                        <button className="btn btn--danger btn--sm" onClick={() => handleDelete(job.job_id)} disabled={deletingId === job.job_id}>
                          {deletingId === job.job_id ? <span className="spinner" /> : 'Confirm'}
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDeleteId(job.job_id)} title="Delete">
                        {icons.trash}
                      </button>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── New / Retry dialog — a real popup either way (enhancement #2).
           Retry mode skips the file picker entirely: the video is already
           in storage, so only the fields that might change are shown, and
           they're pre-filled from the job being retried. ── */}
      {dialogMode !== 'closed' && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={dialogTitle} onClick={e => e.target === e.currentTarget && closeDialog()}>
          <div className="modal" style={{ maxWidth: 540, width: '100%' }}>
            <div className="modal__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{dialogTitle}</span>
              <button className="btn btn--ghost btn--sm" onClick={closeDialog} disabled={submitting}>{icons.close}</button>
            </div>
            <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {dialogMode === 'new' ? (
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Video file</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files[0] ?? null) }}
                    style={{
                      border: '1.5px dashed var(--border-2)', borderRadius: 'var(--radius)',
                      padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
                      background: file ? 'var(--accent-lt)' : 'var(--surface-2)',
                      borderColor: file ? 'var(--accent)' : 'var(--border-2)',
                    }}
                  >
                    <input
                      ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(',')}
                      style={{ display: 'none' }}
                      onChange={e => pickFile(e.target.files?.[0] ?? null)}
                    />
                    <span style={{ display: 'flex', justifyContent: 'center', width: 22, height: 22, margin: '0 auto 8px', color: file ? 'var(--accent)' : 'var(--text-3)' }}>
                      {icons.upload}
                    </span>
                    {file ? (
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB</div>
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Click or drop a video here · MP4, MOV, MKV, WebM · up to 200MB</div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-2)' }}>
                  <span style={{ display: 'flex', width: 18, height: 18, color: 'var(--accent)', flexShrink: 0 }}>{icons.video}</span>
                  <div style={{ fontSize: 12.5, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>Reusing original video</div>
                    <div style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {retrySource?.original_filename ?? 'video.mp4'} — no need to re-upload
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Voice</label>
                {voiceProfiles.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                    No saved voice profiles yet — record one in Voice Profiles first.
                  </div>
                ) : (
                  <select value={effectiveProfileId} onChange={e => setProfileId(e.target.value)} className="full-input" style={{ width: '100%' }}>
                    {voiceProfiles.map(p => (
                      <option key={p.profile_id} value={p.profile_id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>TTS engine</label>
                <EngineSwitcher engine={engine} setEngine={setEngine} engineCaps={caps} />
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  className="btn btn--primary"
                  disabled={submitting || (dialogMode === 'new' && !file) || voiceProfiles.length === 0}
                  onClick={handleDialogSubmit}
                >
                  {submitting ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
                  {submitting
                    ? (dialogMode === 'new' && uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Starting…')
                    : 'Start Dubbing'}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={closeDialog} disabled={submitting}>
                  Cancel
                </button>
              </div>

              {dialogMode === 'new' && submitting && uploadProgress !== null && (
                <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginTop: -8 }}>
                  <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent)', transition: 'width 0.15s linear' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
