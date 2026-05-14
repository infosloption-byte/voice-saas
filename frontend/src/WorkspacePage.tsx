import { useState, useEffect, useRef, useReducer } from 'react'
import { icons, LANGUAGES } from './constants'
import { loadAudioBlob, saveAudioBlob, deleteAudioBlob, historyReducer, fmt } from './audio'
import type { Project, Script, VoiceProfile, SaveState } from './types'

const ENGINE_API = import.meta.env.VITE_ENGINE_URL || 'https://3.83.53.113:8000'

export function WorkspacePage({ project, activeScriptId, setActiveScriptId, onAddScript, onUpdateScript, onDeleteScript, onReorder, voiceProfiles }: {
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
  const [histState, dispatch] = useReducer(historyReducer, { past: [], present: activeScript?.content ?? '', future: [] })
  const [synthesizing, setSynthesizing] = useState(false)
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)
  const [synthErr, setSynthErr] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [showScriptList, setShowScriptList] = useState(true)
  const [transcribing, setTranscribing] = useState(false)
  const fileImportRef = useRef<HTMLInputElement>(null)
  const audioUploadRef = useRef<HTMLInputElement>(null)
  const prevScriptId = useRef<string | null>(null)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  useEffect(() => {
    if (activeScriptId !== prevScriptId.current) {
      dispatch({ type: 'SET', value: activeScript?.content ?? '' })
      prevScriptId.current = activeScriptId
      setAudioUrl(null)
      setSynthErr('')
      if (activeScript?.hasAudio) {
        loadAudioBlob(`audio_${activeScript.id}`).then(setAudioUrl)
      }
    }
  }, [activeScriptId, activeScript?.content, activeScript?.hasAudio])

  useEffect(() => {
    if (!activeScript) return
    if (histState.present === activeScript.content) { setSaveState('saved'); return }
    setSaveState('saving')
    const t = setTimeout(() => {
      onUpdateScript(activeScript.id, { content: histState.present })
      setSaveState('saved')
    }, 600)
    return () => clearTimeout(t)
  }, [histState.present])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function handleSelectScript(id: string) {
    setActiveScriptId(id)
    if (isMobile) setShowScriptList(false)
  }

  const dragIdx = useRef<number | null>(null)
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

  async function generateVoiceover(script: Script, text: string): Promise<boolean> {
    const pid = script.profileId || voiceProfiles[0]?.profile_id
    if (!pid || !text.trim()) return false

    const fd = new FormData()
    fd.append('text', text.trim())
    fd.append('profile_id', pid)
    fd.append('language', script.language || 'en')
    fd.append('speed', String(Math.max(0.5, Math.min(2.0, script.speed ?? 1.0))))
    fd.append('temperature', '0.65')
    fd.append('top_k', '50')
    fd.append('top_p', '0.85')
    fd.append('gap_ms', '60')

    try {
      const res = await fetch(`${ENGINE_API}/synthesize`, { method: 'POST', body: fd })
      if (!res.ok) return false
      const blob = await res.blob()

      let duration: number | null = null
      let peaks: number[] | undefined

      try {
        const tempUrl = URL.createObjectURL(blob)
        const audioCtx = new AudioContext()
        const arr = await (await fetch(tempUrl)).arrayBuffer()
        const buf = await audioCtx.decodeAudioData(arr)
        duration = Math.round(buf.duration * 10) / 10

        const peakData = buf.getChannelData(0)
        const numBars = 60
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
      } catch { /* duration/peaks are optional */ }

      await saveAudioBlob(`audio_${script.id}`, blob)
      onUpdateScript(script.id, {
        hasAudio: true, profileId: pid,
        language: script.language || 'en',
        duration, waveformPeaks: peaks,
      })
      return true
    } catch {
      return false
    }
  }

  async function handleGenerateSingle() {
    if (!activeScript || !histState.present.trim()) { setSynthErr('Write some script content first.'); return }
    if (!voiceProfiles.length) { setSynthErr('No voice profile selected.'); return }
    setSynthesizing(true); setSynthErr('')
    const ok = await generateVoiceover(activeScript, histState.present)
    if (!ok) setSynthErr('Synthesis failed. Is the AI engine running?')
    else {
      const url = await loadAudioBlob(`audio_${activeScript.id}`)
      setAudioUrl(url)
    }
    setSynthesizing(false)
  }

  async function handleBulkGenerate() {
    const pending = project.scripts.filter(s => s.content.trim() && !s.hasAudio)
    if (!pending.length) { alert('All scripts already have audio.'); return }
    if (!voiceProfiles.length) { alert('No voice profile selected.'); return }
    setBulkGenerating(true)
    setBulkTotal(pending.length)
    setBulkProgress(0)
    for (const script of pending) {
      await generateVoiceover(script, script.content)
      setBulkProgress(p => p + 1)
    }
    setBulkGenerating(false)
    setBulkTotal(0)
    setBulkProgress(0)
  }

  async function handleAudioTranscribe(file: File) {
    if (!activeScript) return
    setTranscribing(true)
    const fd = new FormData()
    fd.append('file', file, file.name)
    try {
      const res = await fetch(`${ENGINE_API}/transcribe`, { method: 'POST', body: fd })
      if (!res.ok) { alert('Transcription failed'); return }
      const data = await res.json()
      dispatch({ type: 'SET', value: data.text || '' })
    } catch { alert('Connection error. Is the AI engine running?') }
    finally { setTranscribing(false) }
  }

  async function handleFileImport(file: File) {
    const text = await file.text()
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    if (paragraphs.length <= 1) {
      if (activeScript) dispatch({ type: 'SET', value: text.trim() })
    } else {
      alert(`Found ${paragraphs.length} paragraphs. This will create ${paragraphs.length} new scripts.`)
      if (activeScript) dispatch({ type: 'SET', value: paragraphs[0] })
    }
  }

  const wordCount = histState.present.trim() ? histState.present.trim().split(/\s+/).length : 0
  const pendingCount = project.scripts.filter(s => s.content.trim() && !s.hasAudio).length

  return (
    <div className="workspace">
      <div className={`script-panel ${!showScriptList ? 'script-panel--hidden' : ''}`}>
        <div className="script-panel__head">
          <h3>Scripts <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({project.scripts.length})</span></h3>
          <div style={{ display: 'flex', gap: 4 }}>
            {pendingCount > 0 && !bulkGenerating && (
              <button className="btn btn--sm" onClick={handleBulkGenerate} title={`Generate all ${pendingCount} scripts`} style={{ background: 'var(--accent-lt)', color: 'var(--accent)', border: '1px solid var(--accent-mid)' }}>
                {icons.bolt}
              </button>
            )}
            {bulkGenerating && (
              <span style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
                <span className="spinner" />{bulkProgress}/{bulkTotal}
              </span>
            )}
            <button className="btn btn--sm btn--primary" onClick={onAddScript}>{icons.plus}</button>
          </div>
        </div>
        <div className="script-list">
          {project.scripts.length === 0
            ? <div className="empty-state" style={{ padding: '24px 12px' }}>{icons.edit}<p>No scripts yet</p><button className="btn btn--sm btn--primary" onClick={onAddScript}>Add Script</button></div>
            : project.scripts.map((s, i) => (
              <div key={s.id}
                className={`script-item ${s.id === activeScriptId ? 'script-item--active' : ''}`}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={e => onDragOver(e, i)}
                onDragEnd={onDragEnd}
                onClick={() => handleSelectScript(s.id)}
              >
                <div className="script-item__drag" style={{ cursor: 'grab' }}>{icons.drag}</div>
                <div className="script-item__num">{i + 1}</div>
                <div className="script-item__body">
                  <div className="script-item__title">{s.title}</div>
                  <div className="script-item__meta">
                    {s.content ? `${s.content.trim().split(/\s+/).length} words` : 'Empty'}
                    {s.duration ? ` · ${fmt(s.duration)}` : ''}
                  </div>
                </div>
                <span className={`script-item__status ${s.hasAudio ? 'script-item__status--done' : s.content ? 'script-item__status--pending' : 'script-item__status--none'}`} />
              </div>
            ))
          }
        </div>
        {pendingCount > 0 && (
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <button className="btn btn--sm" style={{ width: '100%', justifyContent: 'center', background: bulkGenerating ? 'var(--bg-3)' : 'var(--accent-lt)', color: bulkGenerating ? 'var(--text-3)' : 'var(--accent)', border: '1px solid var(--accent-mid)' }}
              onClick={handleBulkGenerate} disabled={bulkGenerating}>
              {bulkGenerating ? <><span className="spinner" /> Generating {bulkProgress}/{bulkTotal}</> : <>{icons.bolt} Generate All ({pendingCount})</>}
            </button>
          </div>
        )}
      </div>

      <div className={`editor-panel ${showScriptList && !activeScript ? 'editor-panel--hidden-mobile' : ''}`}>
        {!activeScript
          ? <div className="empty-state">{icons.edit}<p>Select a script or create a new one</p></div>
          : <>
            <div className="editor-toolbar">
              <button className="btn btn--ghost btn--sm editor-back" onClick={() => setShowScriptList(true)}>{icons.back}</button>
              <input
                className="text-input editor-title"
                value={activeScript.title}
                onChange={e => onUpdateScript(activeScript.id, { title: e.target.value })}
                placeholder="Script title"
              />
              <div className="undo-redo">
                <button className="btn btn--sm btn--ghost" onClick={() => dispatch({ type: 'UNDO' })} disabled={!histState.past.length} title="Undo">{icons.undo}</button>
                <button className="btn btn--sm btn--ghost" onClick={() => dispatch({ type: 'REDO' })} disabled={!histState.future.length} title="Redo">{icons.redo}</button>
              </div>
              <button className="btn btn--sm btn--ghost" onClick={() => fileImportRef.current?.click()} title="Import .txt file">{icons.upload}</button>
              <button className="btn btn--sm btn--ghost" onClick={() => audioUploadRef.current?.click()} disabled={transcribing} title="Upload audio → transcribe to script">
                {transcribing ? <span className="spinner" /> : icons.mic}
              </button>
              <input ref={fileImportRef} type="file" accept=".txt,.md" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFileImport(f); e.target.value = '' }} />
              <input ref={audioUploadRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleAudioTranscribe(f); e.target.value = '' }} />
              <span style={{ fontSize: 11, color: saveState === 'saved' ? 'var(--ok)' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                {saveState === 'saving' ? <span className="spinner" /> : saveState === 'saved' ? icons.check : null}
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
              </span>
              <button className="btn btn--sm btn--danger" onClick={() => { onDeleteScript(activeScript.id); setShowScriptList(true) }}>{icons.trash}</button>
            </div>

            <div className="editor-body">
              <textarea
                className="script-textarea"
                value={histState.present}
                onChange={e => dispatch({ type: 'SET', value: e.target.value })}
                placeholder="Write your script here… or use the mic button to transcribe audio."
              />
            </div>

            {synthErr && <div className="msg msg--err" style={{ margin: '8px 14px 0' }}>{synthErr}</div>}

            {audioUrl && (
              <div className="vo-audio-row">
                <span className="vo-ready-label">✓ Ready</span>
                <audio src={audioUrl} controls />
                <a href={audioUrl} download={`${activeScript.title}.wav`} className="btn btn--sm">{icons.download}</a>
              </div>
            )}

            <div className="editor-footer">
              <span className="word-count">{wordCount} words · ~{Math.ceil(wordCount / 130)}m</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Speed</span>
                <input type="range" min="0.5" max="2" step="0.1"
                  value={activeScript.speed ?? 1.0}
                  onChange={e => onUpdateScript(activeScript.id, { speed: parseFloat(e.target.value) })}
                  style={{ width: 60, accentColor: 'var(--accent)' }} />
                <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)', width: 28 }}>{(activeScript.speed ?? 1.0).toFixed(1)}x</span>
              </div>
              <select
                className="profile-select"
                value={activeScript.language || 'en'}
                onChange={e => onUpdateScript(activeScript.id, { language: e.target.value })}
                title="Language"
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              {voiceProfiles.length > 0 && (
                <select
                  className="profile-select"
                  value={activeScript.profileId ?? voiceProfiles[0]?.profile_id ?? ''}
                  onChange={e => onUpdateScript(activeScript.id, { profileId: e.target.value })}
                >
                  {voiceProfiles.map(vp => <option key={vp.profile_id} value={vp.profile_id}>{vp.profile_id}</option>)}
                </select>
              )}
              <button className="btn btn--primary btn--sm" onClick={handleGenerateSingle} disabled={synthesizing || !histState.present.trim()}>
                {synthesizing ? <><span className="spinner" /> Generating…</> : <>{icons.play} Generate</>}
              </button>
            </div>
          </>
        }
      </div>
    </div>
  )
}