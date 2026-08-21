import { useState, useRef, useEffect, useCallback } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, LANGUAGES } from '../lib/constants'
import type { VoiceProfile } from '../lib/types'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024   // mirrors VideoDubbingController::MAX_UPLOAD_KB (204800 KB)
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
const POLL_INTERVAL_MS = 4000                 // status route is throttled 60/min — 4s keeps well under that
const STORAGE_KEY = 'vo_dubbing_job'          // survive a page reload while a job is in flight

type JobStatus = 'queued' | 'transcribing' | 'translating' | 'synthesizing' | 'muxing' | 'done' | 'failed'

const STAGE_META: Record<JobStatus, { label: string; pct: number }> = {
  queued:       { label: 'Queued',              pct: 0 },
  transcribing: { label: 'Transcribing audio',   pct: 5 },
  translating:  { label: 'Translating script',   pct: 25 },
  synthesizing: { label: 'Synthesizing dubbed voice', pct: 45 },
  muxing:       { label: 'Combining with video', pct: 85 },
  done:         { label: 'Done',                 pct: 100 },
  failed:       { label: 'Failed',               pct: 0 },
}

interface StatusResponse {
  job_id: string
  status: JobStatus
  progress: number
  error: string | null
  segment_count: number | null
  segment_overflow_count: number | null
}

export function DubbingPage({ voiceProfiles }: { voiceProfiles: VoiceProfile[] }) {
  const [file, setFile] = useState<File | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('es')
  const [sourceLanguage, setSourceLanguage] = useState('')   // '' = auto-detect
  const [profileId, setProfileId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<StatusResponse | null>(null)
  const [downloading, setDownloading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Default to the first available voice profile once profiles load.
  // Derived at render time rather than synced via an effect+setState
  // (the "you might not need an effect" pattern) — profileId only holds
  // an explicit user override; this is what's actually used everywhere.
  const effectiveProfileId = profileId || voiceProfiles[0]?.profile_id || ''

  const clearPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const fetchStatus = useCallback(async (jobId: string) => {
    try {
      const s = await api.get(`/dubbing/status/${jobId}`) as StatusResponse
      setJob(s)
      if (s.status === 'done' || s.status === 'failed') {
        clearPoll()
        localStorage.removeItem(STORAGE_KEY)
        if (s.status === 'failed') toast.err(s.error ?? 'Dubbing failed.')
      }
    } catch (e) {
      // A 404 here means the job genuinely doesn't exist (e.g. stale
      // localStorage from a previous account) — stop polling rather than
      // retrying forever against a job that will never resolve.
      if (e instanceof ApiError && e.status === 404) {
        clearPoll()
        localStorage.removeItem(STORAGE_KEY)
        setJob(null)
      }
    }
  }, [clearPoll])

  const startPolling = useCallback((jobId: string) => {
    clearPoll()
    fetchStatus(jobId)
    pollRef.current = setInterval(() => fetchStatus(jobId), POLL_INTERVAL_MS)
  }, [clearPoll, fetchStatus])

  // Resume tracking a job that was still running when the page was last
  // closed. Deferred via queueMicrotask rather than calling startPolling
  // directly in the effect body: startPolling -> fetchStatus eventually
  // calls setJob, and react-hooks/set-state-in-effect flags that reachable
  // chain even though the actual setState happens after an await inside
  // fetchStatus, not synchronously. Wrapping it in a real callback (not
  // just an unawaited async call) satisfies the rule and matches the
  // "subscribe to an external system, setState in a callback" pattern the
  // rule's own guidance recommends — same class of fix as the earlier
  // EngineSwitcher ref-callback/infinite-loop bug.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    queueMicrotask(() => startPolling(saved))
    return () => clearPoll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('target_language', targetLanguage)
      if (sourceLanguage) fd.append('source_language', sourceLanguage)
      fd.append('voice_profile_id', effectiveProfileId)

      const res = await api.post('/dubbing/submit', fd) as { job_id: string; status: JobStatus }
      localStorage.setItem(STORAGE_KEY, res.job_id)
      setJob({ job_id: res.job_id, status: res.status, progress: 0, error: null, segment_count: null, segment_overflow_count: null })
      startPolling(res.job_id)
      toast.ok('Dubbing job queued.')
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to start dubbing.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDownload() {
    if (!job) return
    setDownloading(true)
    try {
      const blob = await api.get(`/dubbing/result/${job.job_id}`) as Blob
      if (!(blob instanceof Blob)) throw new Error('Unexpected response from server.')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dubbed_${job.job_id}.mp4`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  function startOver() {
    clearPoll()
    localStorage.removeItem(STORAGE_KEY)
    setJob(null)
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const isRunning = !!job && job.status !== 'done' && job.status !== 'failed'
  const stage = job ? STAGE_META[job.status] : null
  // The job's own `progress` field (set by the backend at each stage
  // transition) is more accurate than our static STAGE_META table once a
  // job is actually running — prefer it, falling back to the table only
  // before the first status poll has landed.
  const pct = job?.progress ?? stage?.pct ?? 0

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ display: 'flex', width: 22, height: 22, color: 'var(--accent)' }}>{icons.video}</span>
        <h2 style={{ margin: 0 }}>Video Dubbing</h2>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginBottom: 24 }}>
        Upload a video, pick a target language and a voice, and get back a version dubbed in your cloned voice.
      </p>

      {!job && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* ── File picker ── */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Video file</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files[0] ?? null) }}
              style={{
                border: '1.5px dashed var(--border-2)', borderRadius: 'var(--radius)',
                padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
                background: file ? 'var(--accent-lt)' : 'var(--surface-2)',
                borderColor: file ? 'var(--accent)' : 'var(--border-2)',
              }}
            >
              <input
                ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(',')}
                style={{ display: 'none' }}
                onChange={e => pickFile(e.target.files?.[0] ?? null)}
              />
              <span style={{ display: 'flex', justifyContent: 'center', width: 24, height: 24, margin: '0 auto 8px', color: file ? 'var(--accent)' : 'var(--text-3)' }}>
                {icons.upload}
              </span>
              {file ? (
                <div style={{ fontSize: 13, fontWeight: 600 }}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB</div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Click or drop a video here · MP4, MOV, MKV, WebM · up to 200MB</div>
              )}
            </div>
          </div>

          {/* ── Voice ── */}
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

          {/* ── Languages ── */}
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

          <button
            className="btn btn--primary"
            disabled={submitting || !file || voiceProfiles.length === 0}
            onClick={handleSubmit}
            style={{ marginTop: 4 }}
          >
            {submitting ? <span className="spinner" style={{ marginRight: 6 }} /> : null}
            {submitting ? 'Starting…' : 'Start Dubbing'}
          </button>
        </div>
      )}

      {/* ── Progress / result ── */}
      {job && (
        <div style={{ border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', padding: 20 }}>
          {job.status !== 'failed' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{STAGE_META[job.status]?.label ?? job.status}</span>
                <span style={{ color: 'var(--text-3)' }}>{pct}%</span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{
                  height: '100%', width: `${pct}%`, background: job.status === 'done' ? 'var(--success, #3aa66b)' : 'var(--accent)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              {isRunning && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  This can take a few minutes for longer videos — feel free to leave this page, it'll keep running.
                </div>
              )}
            </>
          )}

          {job.status === 'failed' && (
            <div style={{ fontSize: 13, color: 'var(--danger, #d9534f)', marginBottom: 14 }}>
              {job.error ?? 'Dubbing failed for an unknown reason.'}
            </div>
          )}

          {job.status === 'done' && (
            <button className="btn btn--primary" onClick={handleDownload} disabled={downloading} style={{ marginTop: 10 }}>
              {downloading ? <span className="spinner" style={{ marginRight: 6 }} /> : <span style={{ display: 'flex', width: 14, height: 14, marginRight: 6 }}>{icons.download}</span>}
              {downloading ? 'Downloading…' : 'Download dubbed video'}
            </button>
          )}

          {(job.status === 'done' || job.status === 'failed') && (
            <button className="btn btn--ghost btn--sm" onClick={startOver} style={{ marginTop: 10, marginLeft: job.status === 'done' ? 10 : 0 }}>
              Dub another video
            </button>
          )}
        </div>
      )}
    </div>
  )
}
