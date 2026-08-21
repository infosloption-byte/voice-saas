import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, LANGUAGES } from '../lib/constants'
import { useEscapeKey } from '../hooks/useEscapeKey'
import type { VoiceProfile } from '../lib/types'

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
  voice_name: string
  segment_count: number | null
  segment_overflow_count: number | null
  duration_seconds: number | null
  has_source: boolean
  has_result: boolean
  created_at: string | null
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

export function DubbingPage({ voiceProfiles }: { voiceProfiles: VoiceProfile[] }) {
  // ── Upload form state ──────────────────────────────────────────────
  const [showUpload, setShowUpload] = useState(false)
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

  // ── Preview modal state ────────────────────────────────────────────
  const [previewJob, setPreviewJob] = useState<JobRow | null>(null)
  const [previewTab, setPreviewTab] = useState<'dubbed' | 'original'>('dubbed')
  const [previewUrls, setPreviewUrls] = useState<Record<string, { source?: string; result?: string }>>({})
  const [previewLoading, setPreviewLoading] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const effectiveProfileId = profileId || voiceProfiles[0]?.profile_id || ''

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

  const runningCount = useMemo(() => jobs.filter(j => !['done', 'failed'].includes(j.status)).length, [jobs])

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

  async function handleSubmit() {
    if (!file) { toast.err('Choose a video file first.'); return }
    if (!effectiveProfileId) { toast.err('Choose a voice to dub with.'); return }
    if (!targetLanguage) { toast.err('Choose a target language.'); return }

    setSubmitting(true)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('target_language', targetLanguage)
      if (sourceLanguage) fd.append('source_language', sourceLanguage)
      fd.append('voice_profile_id', effectiveProfileId)

      await api.postWithProgress('/dubbing/submit', fd, setUploadProgress)
      toast.ok('Dubbing job queued — it will appear below.')

      // Reset the form but keep the panel open — this is the "run several
      // as a queue" flow: submit one, immediately queue the next without
      // losing your place. Fresh submission for a genuinely new job means
      // clearing the file (each dub is a distinct upload); language/voice
      // choices carry over since back-to-back dubs are often the same
      // voice into the same or a fresh target language.
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

  // ── Preview modal ──────────────────────────────────────────────────
  async function openPreview(job: JobRow) {
    setPreviewJob(job)
    setPreviewTab(job.has_result ? 'dubbed' : 'original')

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
  }

  function closePreview() {
    setPreviewJob(null)
  }
  useEscapeKey(closePreview, previewJob !== null)

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

  /** "Dub again" / "Retry" — pulls the original upload back down and pre-fills
   *  a fresh submission with it, rather than re-running the same job (there's
   *  no backend resume/retry — this just makes starting a new one painless). */
  async function dubAgain(job: JobRow) {
    if (!job.has_source) {
      toast.err('The original upload is no longer available for this job.')
      return
    }
    setShowUpload(true)
    setTargetLanguage(job.target_language)
    setSourceLanguage(job.source_language ?? '')
    try {
      const cached = previewUrls[job.job_id]?.source
      const blob = cached ? await fetch(cached).then(r => r.blob()) : await api.fetchDubbingSource(job.job_id)
      const refile = new File([blob], job.original_filename ?? 'video.mp4', { type: 'video/mp4' })
      pickFile(refile)
      toast.info('Loaded the original video — adjust settings and start dubbing.')
    } catch {
      toast.err('Could not load the original video for this job.')
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
      if (previewJob?.job_id === jobId) setPreviewJob(null)
      toast.ok('Deleted.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not delete this job.')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const activePreviewUrls = previewJob ? previewUrls[previewJob.job_id] : undefined

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px 60px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', width: 22, height: 22, color: 'var(--accent)' }}>{icons.video}</span>
          <h2 style={{ margin: 0 }}>Dubbing Studio</h2>
          {runningCount > 0 && (
            <span className="tag tag--accent">{runningCount} running</span>
          )}
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setShowUpload(v => !v)}>
          {icons.plus}<span className="btn__label"> New Dub</span>
        </button>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginBottom: 22 }}>
        Upload as many videos as you like — each one dubs independently, so you can queue several at once and check back as they finish.
      </p>

      {/* ── Upload panel ── */}
      {showUpload && (
        <div className="project-card" style={{ marginBottom: 26, cursor: 'default' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                disabled={submitting || !file || voiceProfiles.length === 0}
                onClick={handleSubmit}
              >
                {submitting ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
                {submitting
                  ? (uploadProgress !== null ? `Uploading… ${uploadProgress}%` : 'Starting…')
                  : 'Start Dubbing'}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowUpload(false)} disabled={submitting}>
                Close
              </button>
            </div>

            {submitting && uploadProgress !== null && (
              <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginTop: -8 }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent)', transition: 'width 0.15s linear' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Job history / workspace grid ── */}
      {!listLoaded ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-3)' }}>
          <span className="spinner" />
        </div>
      ) : jobs.length === 0 ? (
        <button className="project-card project-card--new" onClick={() => setShowUpload(true)} style={{ width: '100%' }}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{icons.upload}</div>
            <span className="project-card--new__label">Dub your first video</span>
            <span className="project-card--new__hint">Upload a video to get started</span>
          </div>
        </button>
      ) : (
        <div className="project-grid">
          {jobs.map(job => {
            const stage = STAGE_META[job.status]
            const pct = job.status === 'done' ? 100 : (job.progress ?? stage.pct)
            const isRunning = !['done', 'failed'].includes(job.status)
            const durationStr = fmtDuration(job.duration_seconds)

            return (
              <div
                key={job.job_id}
                className="project-card"
                onClick={() => (job.has_result || job.has_source) && openPreview(job)}
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
                  {isRunning && <span className="tag tag--accent">{stage.label}</span>}
                </div>

                {isRunning && (
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
                    <button className="btn btn--ghost btn--sm" onClick={() => dubAgain(job)} title={job.status === 'failed' ? 'Retry' : 'Dub again'}>
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

      {/* ── Preview modal ── */}
      {previewJob && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Video preview" onClick={e => e.target === e.currentTarget && closePreview()}>
          <div className="modal" style={{ maxWidth: 720, width: '100%' }}>
            <div className="modal__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{previewJob.original_filename ?? 'Video preview'}</span>
              <button className="btn btn--ghost btn--sm" onClick={closePreview}>{icons.close}</button>
            </div>
            <div className="modal__body">
              {previewJob.has_result && previewJob.has_source && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <button
                    className={`btn btn--sm ${previewTab === 'dubbed' ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setPreviewTab('dubbed')}
                  >
                    Dubbed
                  </button>
                  <button
                    className={`btn btn--sm ${previewTab === 'original' ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setPreviewTab('original')}
                  >
                    Original
                  </button>
                </div>
              )}

              {previewLoading ? (
                <div style={{ textAlign: 'center', padding: '50px 0' }}><span className="spinner" /></div>
              ) : (
                <video
                  key={previewTab}
                  src={previewTab === 'dubbed' ? activePreviewUrls?.result : activePreviewUrls?.source}
                  controls
                  autoPlay
                  style={{ width: '100%', borderRadius: 8, background: '#000' }}
                />
              )}

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="tag">{langLabel(previewJob.source_language)} → {langLabel(previewJob.target_language)}</span>
                <span className="tag tag--info">{previewJob.voice_name}</span>
              </div>
            </div>
            <div className="modal__actions">
              {previewJob.status === 'done' && (
                <button className="btn btn--primary" onClick={() => handleDownload(previewJob)}>
                  {icons.download}<span className="btn__label"> Download</span>
                </button>
              )}
              <button className="btn btn--ghost" onClick={closePreview}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
