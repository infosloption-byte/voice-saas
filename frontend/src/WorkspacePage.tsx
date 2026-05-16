import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { icons, LANGUAGES } from './constants'
import { loadAudioBlob, saveAudioBlob, deleteAudioBlob, historyReducer, fmt } from './audio'
import type { Project, Script, VoiceProfile, SaveState } from './types'

// Read exclusively from env — no hardcoded fallback so misconfiguration
// surfaces immediately rather than silently hitting the wrong host.
const ENGINE_URL = import.meta.env.VITE_ENGINE_URL as string | undefined

export function WorkspacePage({
  project,
  activeScriptId,
  setActiveScriptId,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  onReorder,
  voiceProfiles,
}: {
  project: Project
  activeScriptId: string | null
  setActiveScriptId: (id: string | null) => void
  onAddScript: () => void
  onUpdateScript: (id: string, upd: Partial<Script>) => void
  onDeleteScript: (id: string) => void
  onReorder: (scripts: Script[]) => void
  voiceProfiles: VoiceProfile[]
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
  const [synthErr, setSynthErr]             = useState('')
  const [saveState, setSaveState]           = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl]             = useState<string | null>(null)
  const [showScriptList, setShowScriptList] = useState(true)
  const [transcribing, setTranscribing]     = useState(false)

  const fileImportRef  = useRef<HTMLInputElement>(null)
  const audioUploadRef = useRef<HTMLInputElement>(null)
  // A single AbortController shared between single and bulk synthesis.
  // Always abort the previous controller before starting a new request.
  const synthAbortRef  = useRef<AbortController | null>(null)
  const dragIdx        = useRef<number | null>(null)

  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768

  // ── Reset editor when active script changes ───────────────────────
  // Intentionally depends only on activeScriptId, NOT on activeScript.content.
  // This means the effect only fires when the user selects a different script,
  // not on every auto-save keystroke. The eslint-disable is deliberate here.
  useEffect(() => {
    const content = activeScript?.content ?? ''
    dispatch({ type: 'SET', value: content })
    setAudioUrl(null)
    setSynthErr('')

    if (activeScript?.hasAudio && activeScript.id) {
      loadAudioBlob(`audio_${activeScript.id}`).then(setAudioUrl)
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

  // ── Abort in-flight synthesis on unmount ─────────────────────────
  useEffect(() => {
    return () => { synthAbortRef.current?.abort() }
  }, [])

  // ── Script list drag-to-reorder ───────────────────────────────────
  function onDragStart(i: number) {
    dragIdx.current = i
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...project.scripts]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    onReorder(next)
  }

  function onDragEnd() {
    dragIdx.current = null
  }

  function handleSelectScript(id: string) {
    setActiveScriptId(id)
    if (isMobile) setShowScriptList(false)
  }

  // ── Core synthesis helper ─────────────────────────────────────────
  // Returns true on success, false on failure/abort.
  // Caller is responsible for aborting any previous controller before calling.
  const generateVoiceover = useCallback(
    async (
      script: Script,
      text: string,
      signal?: AbortSignal
    ): Promise<boolean> => {
      if (!ENGINE_URL) {
        console.error('[WorkspacePage] VITE_ENGINE_URL is not set')
        return false
      }

      const pid = script.profileId || voiceProfiles[0]?.profile_id
      if (!pid || !text.trim()) return false

      const fd = new FormData()
      fd.append('text',        text.trim())
      fd.append('profile_id',  pid)
      fd.append('language',    script.language || 'en')
      fd.append('speed',       String(Math.max(0.5, Math.min(2.0, script.speed ?? 1.0))))
      fd.append('temperature', '0.65')
      fd.append('top_k',       '50')
      fd.append('top_p',       '0.85')
      fd.append('gap_ms',      '60')

      try {
        const res = await fetch(`${ENGINE_URL}/synthesize`, {
          method: 'POST',
          body: fd,
          signal,
        })

        if (!res.ok) {
          console.error(`[WorkspacePage] Synthesis HTTP ${res.status}`)
          return false
        }

        const blob = await res.blob()
        let duration: number | null = null
        let peaks: number[] | undefined

        // Decode audio metadata — non-blocking, best-effort.
        // Failure here does not abort the save.
        try {
          const tempUrl  = URL.createObjectURL(blob)
          const audioCtx = new AudioContext()
          const arr      = await (await fetch(tempUrl)).arrayBuffer()
          const buf      = await audioCtx.decodeAudioData(arr)
          duration       = Math.round(buf.duration * 10) / 10

          const peakData  = buf.getChannelData(0)
          const numBars   = 60
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
          URL.revokeObjectURL(tempUrl)
        } catch {
          // Duration/peaks are optional — continue without them
        }

        await saveAudioBlob(`audio_${script.id}`, blob)
        onUpdateScript(script.id, {
          hasAudio:      true,
          profileId:     pid,
          language:      script.language || 'en',
          duration,
          waveformPeaks: peaks,
        })
        return true
      } catch (e) {
        if ((e as Error).name === 'AbortError') return false
        console.error('[WorkspacePage] generateVoiceover error:', e)
        return false
      }
    },
    [voiceProfiles, onUpdateScript]
  )

  // ── Single-script synthesis ───────────────────────────────────────
  async function handleGenerateSingle() {
    if (!activeScript || !histState.present.trim()) {
      setSynthErr('Write some script content first.')
      return
    }
    if (!voiceProfiles.length) {
      setSynthErr('No voice profile found. Record one in Voice Profiles.')
      return
    }
    if (!ENGINE_URL) {
      setSynthErr('Engine URL is not configured. Check your .env file.')
      return
    }

    // Cancel any in-flight request (single or bulk) before starting a new one.
    synthAbortRef.current?.abort()
    const controller = new AbortController()
    synthAbortRef.current = controller

    setSynthesizing(true)
    setSynthErr('')

    const ok = await generateVoiceover(
      activeScript,
      histState.present,
      controller.signal
    )

    if (!ok && !controller.signal.aborted) {
      setSynthErr('Synthesis failed. Is the AI engine running?')
    } else if (ok) {
      const url = await loadAudioBlob(`audio_${activeScript.id}`)
      setAudioUrl(url)
    }

    setSynthesizing(false)
  }

  // ── Bulk synthesis ────────────────────────────────────────────────
  async function handleBulkGenerate() {
    const pending = project.scripts.filter(s => s.content.trim() && !s.hasAudio)
    if (!pending.length) {
      alert('All scripts already have audio.')
      return
    }
    if (!voiceProfiles.length) {
      alert('No voice profile found. Record one in Voice Profiles first.')
      return
    }
    if (!ENGINE_URL) {
      alert('Engine URL is not configured. Check your .env file.')
      return
    }

    // Cancel any in-flight single synthesis before starting bulk.
    synthAbortRef.current?.abort()
    const controller = new AbortController()
    synthAbortRef.current = controller

    setBulkGenerating(true)
    setBulkTotal(pending.length)
    setBulkProgress(0)
    setBulkErrors([])

    for (const script of pending) {
      if (controller.signal.aborted) break
      const ok = await generateVoiceover(script, script.content, controller.signal)
      if (!ok && !controller.signal.aborted) {
        setBulkErrors(prev => [...prev, script.title])
      }
      setBulkProgress(p => p + 1)
    }

    setBulkGenerating(false)
    setBulkTotal(0)
    setBulkProgress(0)
  }

  // ── Audio transcription ───────────────────────────────────────────
  async function handleAudioTranscribe(file: File) {
    if (!activeScript) return
    if (!ENGINE_URL) {
      alert('Engine URL is not configured. Check your .env file.')
      return
    }

    setTranscribing(true)
    const fd = new FormData()
    fd.append('file', file, file.name)
    try {
      const res = await fetch(`${ENGINE_URL}/transcribe`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        alert('Transcription failed. Is the AI engine running?')
        return
      }
      const data = await res.json() as { text?: string }
      dispatch({ type: 'SET', value: data.text ?? '' })
    } catch {
      alert('Connection error. Is the AI engine running?')
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
      const confirmed = confirm(
        `Found ${paragraphs.length} paragraphs. Import first paragraph into this script?`
      )
      if (confirmed && activeScript) {
        dispatch({ type: 'SET', value: paragraphs[0] })
      }
    }
  }

  // ── Derived values ────────────────────────────────────────────────
  const wordCount = histState.present.trim()
    ? histState.present.trim().split(/\s+/).length
    : 0

  const pendingCount = project.scripts.filter(
    s => s.content.trim() && !s.hasAudio
  ).length

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="workspace">

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
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 6px',
                }}
              >
                <span className="spinner" />{bulkProgress}/{bulkTotal}
              </span>
            )}
            <button className="btn btn--sm btn--primary" onClick={onAddScript}>
              {icons.plus}
            </button>
          </div>
        </div>

        <div className="script-list">
          {project.scripts.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 12px' }}>
              {icons.edit}
              <p>No scripts yet</p>
              <button className="btn btn--sm btn--primary" onClick={onAddScript}>
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
              </div>
            ))
          )}
        </div>

        {/* Bulk generate footer */}
        {pendingCount > 0 && (
          <div
            style={{
              padding: '8px 10px',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <button
              className="btn btn--sm"
              style={{
                width:            '100%',
                justifyContent:   'center',
                background:       bulkGenerating ? 'var(--bg-3)' : 'var(--accent-lt)',
                color:            bulkGenerating ? 'var(--text-3)' : 'var(--accent)',
                border:           '1px solid var(--accent-mid)',
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

            {/* Surface per-script errors after bulk completes */}
            {!bulkGenerating && bulkErrors.length > 0 && (
              <div
                className="msg msg--err"
                style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5 }}
              >
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
              <span
                style={{
                  fontSize: 11,
                  color:
                    saveState === 'saved' ? 'var(--ok)' : 'var(--text-3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {saveState === 'saving' ? (
                  <span className="spinner" />
                ) : saveState === 'saved' ? (
                  icons.check
                ) : null}
                {saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'saved'
                    ? 'Saved'
                    : ''}
              </span>

              <button
                className="btn btn--sm btn--danger"
                onClick={() => {
                  if (confirm(`Delete script "${activeScript.title}"?`)) {
                    onDeleteScript(activeScript.id)
                    setShowScriptList(true)
                  }
                }}
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
                <a
                  href={audioUrl}
                  download={`${activeScript.title}.wav`}
                  className="btn btn--sm"
                >
                  {icons.download}
                </a>
                <button
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    deleteAudioBlob(`audio_${activeScript.id}`)
                    onUpdateScript(activeScript.id, {
                      hasAudio: false,
                      duration: null,
                    })
                    setAudioUrl(null)
                  }}
                  title="Remove audio"
                >
                  {icons.trash}
                </button>
              </div>
            )}

            {/* Footer controls */}
            <div className="editor-footer">
              <span className="word-count">
                {wordCount} words · ~{Math.ceil(wordCount / 130)}m
              </span>

              <div style={{ flex: 1 }} />

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
                    onUpdateScript(activeScript.id, {
                      speed: parseFloat(e.target.value),
                    })
                  }
                  style={{ width: 60, accentColor: 'var(--accent)' }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--accent)',
                    fontFamily: 'var(--mono)',
                    width: 28,
                  }}
                >
                  {(activeScript.speed ?? 1.0).toFixed(1)}x
                </span>
              </div>

              {/* Language */}
              <select
                className="profile-select"
                value={activeScript.language || 'en'}
                onChange={e =>
                  onUpdateScript(activeScript.id, { language: e.target.value })
                }
                title="Language"
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>

              {/* Voice profile */}
              {voiceProfiles.length > 0 && (
                <select
                  className="profile-select"
                  value={
                    activeScript.profileId ??
                    voiceProfiles[0]?.profile_id ??
                    ''
                  }
                  onChange={e =>
                    onUpdateScript(activeScript.id, { profileId: e.target.value })
                  }
                >
                  {voiceProfiles.map(vp => (
                    <option key={vp.profile_id} value={vp.profile_id}>
                      {vp.profile_id}
                    </option>
                  ))}
                </select>
              )}

              {/* Generate button */}
              <button
                className="btn btn--primary btn--sm"
                onClick={handleGenerateSingle}
                disabled={synthesizing || !histState.present.trim()}
              >
                {synthesizing ? (
                  <><span className="spinner" /> Generating…</>
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