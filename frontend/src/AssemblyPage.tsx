import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { icons, CLIP_COLORS, CLIP_LIGHTS } from './constants'
import { loadAudioBlob, loadAudioRawBlob, saveAudioBlob, deleteAudioBlob, timelineReducer, uid, fmt } from './audio'
import type { Project, Script, TimelineClip, TimelineHistory } from './types'

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL as string | undefined

interface BgMusic { blob: Blob; volume: number }

export function AssemblyPage({ project, mergedUrl, mergedBlob, merging, onMerge, onReorder, onSaveTimeline }: {
  project: Project
  mergedUrl: string | null
  mergedBlob: Blob | null
  merging: boolean
  onMerge: (orderedClips: TimelineClip[], bgMusic?: BgMusic) => void
  onReorder: (scripts: Script[]) => void
  onSaveTimeline: (clips: TimelineClip[]) => void
}) {
  const withAudio = project.scripts.filter(s => s.hasAudio)

  const [zoom, setZoom] = useState(80)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tlHistory, dispatchTl] = useReducer(
    timelineReducer,
    { past: [], present: project.timelineClips ?? [], future: [] } as TimelineHistory
  )
  const timelineClips = tlHistory.present
  const setTimelineClips = (clips: TimelineClip[]) => dispatchTl({ type: 'SET', clips })
  const [dragAssetId, setDragAssetId] = useState<string | null>(null)
  const [dragClipId, setDragClipId] = useState<string | null>(null)
  const [dragOffsetSec, setDragOffsetSec] = useState(0)
  const [resizingClip, setResizingClip] = useState<{ id: string; side: 'left' | 'right'; initX: number; initVal: number } | null>(null)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [colorCursor, setColorCursor] = useState(0)
  const [dropActive, setDropActive] = useState(false)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [showGapDialog, setShowGapDialog] = useState(false)
  const [gapDuration, setGapDuration] = useState(1)

  // Background music state
  const [bgMusicName, setBgMusicName] = useState<string | null>(null)
  const [bgMusicBlob, setBgMusicBlob] = useState<Blob | null>(null)
  const [bgMusicVolume, setBgMusicVolume] = useState(0.2)
  const bgMusicInputRef = useRef<HTMLInputElement>(null)

  // MP3 export state
  const [exportingMp3, setExportingMp3] = useState(false)

  const timelineRef = useRef<HTMLDivElement>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({})
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playStartCtxTimeRef = useRef<number>(0)
  const playheadAtStartRef = useRef<number>(0)
  const saveTimelineRef = useRef(onSaveTimeline)
  saveTimelineRef.current = onSaveTimeline

  // Load audio URLs from IndexedDB
  useEffect(() => {
    withAudio.forEach(async s => {
      if (!audioUrls[s.id]) {
        const url = await loadAudioBlob(`audio_${s.id}`)
        if (!url) return
        setAudioUrls(prev => ({ ...prev, [s.id]: url }))
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
          const arr = await (await fetch(url)).arrayBuffer()
          audioBuffersRef.current[s.id] = await audioCtxRef.current.decodeAudioData(arr)
        } catch { }
      }
    })
  }, [project.scripts])

  // Load persisted bg music from IndexedDB on mount
  useEffect(() => {
    loadAudioRawBlob(`bg_${project.id}`).then(blob => {
      if (blob) {
        setBgMusicBlob(blob)
        const stored = localStorage.getItem(`bg_name_${project.id}`)
        if (stored) setBgMusicName(stored)
      }
    })
  }, [project.id])

  // Debounced timeline persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      saveTimelineRef.current(timelineClips)
    }, 1200)
    return () => clearTimeout(timer)
  }, [timelineClips])

  useEffect(() => () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current) }, [])

  // Keyboard shortcuts for timeline
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') { e.preventDefault(); playing ? stopPlayback() : startPlayback(playhead) }
      if (e.key === 'Home') { e.preventDefault(); stopPlayback(); setPlayhead(0) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPlayhead(p => Math.max(0, Math.round((p - 1) * 10) / 10)) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setPlayhead(p => Math.round((p + 1) * 10) / 10) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault()
        setTimelineClips(timelineClips.filter(c => c.id !== selectedClipId))
        setSelectedClipId(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatchTl({ type: 'UNDO' }) }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); dispatchTl({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [playing, playhead, selectedClipId, timelineClips])

  const totalDur = timelineClips.length
    ? Math.max(...timelineClips.map(c => c.start + c.dur)) + 5
    : 30

  function stopPlayback() {
    scheduledSourcesRef.current.forEach(s => { try { s.stop(); s.disconnect() } catch { } })
    scheduledSourcesRef.current = []
    if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    setPlaying(false)
  }

  function startPlayback(fromPlayhead: number) {
    stopPlayback()
    const ctx = audioCtxRef.current || new AudioContext()
    if (!audioCtxRef.current) audioCtxRef.current = ctx
    if (ctx.state === 'suspended') ctx.resume()
    const ctxNow = ctx.currentTime
    playStartCtxTimeRef.current = ctxNow
    playheadAtStartRef.current = fromPlayhead
    timelineClips.filter(c => !c.isGap).forEach(clip => {
      const buf = audioBuffersRef.current[clip.scriptId]
      if (!buf) return
      const offsetIntoClip = Math.max(0, fromPlayhead - clip.start)
      if (offsetIntoClip >= clip.dur) return
      const whenToStart = ctxNow + Math.max(0, clip.start - fromPlayhead)
      const source = ctx.createBufferSource()
      source.buffer = buf
      const gainNode = ctx.createGain()
      gainNode.gain.value = clip.volume
      source.connect(gainNode).connect(ctx.destination)
      const trimmedStart = clip.trimStart + offsetIntoClip
      source.start(whenToStart, trimmedStart)
      source.stop(whenToStart + (clip.dur - offsetIntoClip))
      scheduledSourcesRef.current.push(source)
    })
    setPlaying(true)
    playIntervalRef.current = setInterval(() => {
      const elapsed = audioCtxRef.current!.currentTime - playStartCtxTimeRef.current
      const pos = Math.round((playheadAtStartRef.current + elapsed) * 10) / 10
      if (pos >= totalDur) { stopPlayback(); setPlayhead(0); return }
      setPlayhead(pos)
    }, 50)
  }

  useEffect(() => () => stopPlayback(), [])

  function getSecFromEvent(e: React.MouseEvent | React.DragEvent): number {
    if (!timelineRef.current) return 0
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft
    return Math.max(0, Math.round((x / zoom) * 10) / 10)
  }

  function addToTimeline(script: Script, startSec: number) {
    const ci = colorCursor % CLIP_COLORS.length
    setColorCursor(c => c + 1)
    const rawDur = script.duration ?? Math.max(5, Math.ceil((script.content.trim().split(/\s+/).length || 50) / 2.5))
    setTimelineClips([...timelineClips, {
      id: 'tc_' + uid(),
      scriptId: script.id,
      start: startSec,
      dur: rawDur,
      trimStart: 0,
      trimEnd: 0,
      rawDur,
      title: script.title,
      ci,
      volume: 1,
      isGap: false,
    }])
  }

  function addGap(dur: number) {
    setTimelineClips([...timelineClips, {
      id: 'gap_' + uid(),
      scriptId: '',
      start: playhead,
      dur,
      trimStart: 0,
      trimEnd: 0,
      rawDur: dur,
      title: `Silence (${dur}s)`,
      ci: -1,
      volume: 0,
      isGap: true,
    }])
    setShowGapDialog(false)
  }

  function removeClip(clipId: string) {
    setTimelineClips(timelineClips.filter(c => c.id !== clipId))
    if (selectedClipId === clipId) setSelectedClipId(null)
  }

  function handleMerge() {
    const ordered = [...timelineClips].sort((a, b) => a.start - b.start)
    const bg = bgMusicBlob ? { blob: bgMusicBlob, volume: bgMusicVolume } : undefined
    onMerge(ordered, bg)
  }

  async function handleExportMp3() {
    if (!mergedBlob || !ENGINE_URL) return
    setExportingMp3(true)
    try {
      const fd = new FormData()
      fd.append('file', mergedBlob, 'audio.wav')
      const res = await fetch(`${ENGINE_URL}/export/mp3`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'final.mp3'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('MP3 export failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExportingMp3(false)
    }
  }

  async function handleBgMusicUpload(file: File) {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })
    await saveAudioBlob(`bg_${project.id}`, blob)
    localStorage.setItem(`bg_name_${project.id}`, file.name)
    setBgMusicBlob(blob)
    setBgMusicName(file.name)
  }

  async function removeBgMusic() {
    await deleteAudioBlob(`bg_${project.id}`)
    localStorage.removeItem(`bg_name_${project.id}`)
    setBgMusicBlob(null)
    setBgMusicName(null)
  }

  function fitToView() {
    if (!timelineClips.length || !timelineRef.current) return
    const totalW = timelineRef.current.clientWidth - 40
    const total = Math.max(...timelineClips.map(c => c.start + c.dur)) + 2
    setZoom(Math.max(20, Math.min(200, Math.floor(totalW / total))))
  }

  // Drag: asset → timeline
  function onTimelineDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropActive(true) }
  function onTimelineDragLeave() { setDropActive(false) }
  function onTimelineDrop(e: React.DragEvent) {
    e.preventDefault(); setDropActive(false)
    if (!dragAssetId) return
    const script = project.scripts.find(s => s.id === dragAssetId)
    if (!script) return
    addToTimeline(script, getSecFromEvent(e))
    setDragAssetId(null)
  }

  // Drag: clip on timeline
  function onClipMouseDown(e: React.MouseEvent, clip: TimelineClip) {
    e.preventDefault(); e.stopPropagation()
    setSelectedClipId(clip.id)
    setDragOffsetSec(getSecFromEvent(e) - clip.start)
    setDragClipId(clip.id)
  }

  function onResizeMouseDown(e: React.MouseEvent, clip: TimelineClip, side: 'left' | 'right') {
    e.preventDefault(); e.stopPropagation()
    const initVal = side === 'left' ? clip.trimStart : clip.trimEnd
    setResizingClip({ id: clip.id, side, initX: e.clientX, initVal })
  }

  function onTimelineMouseMove(e: React.MouseEvent) {
    if (dragClipId) {
      const newStart = Math.max(0, Math.round((getSecFromEvent(e) - dragOffsetSec) * 10) / 10)
      setTimelineClips(timelineClips.map(c => c.id === dragClipId ? { ...c, start: newStart } : c))
    }
    if (resizingClip) {
      const dx = e.clientX - resizingClip.initX
      const dSec = Math.round((dx / zoom) * 10) / 10
      setTimelineClips(timelineClips.map(c => {
        if (c.id !== resizingClip.id) return c
        if (resizingClip.side === 'left') {
          const newTrimStart = Math.max(0, Math.min(c.rawDur - c.trimEnd - 0.5, resizingClip.initVal + dSec))
          const newDur = c.rawDur - newTrimStart - c.trimEnd
          const newStart = c.start + (newTrimStart - c.trimStart)
          return { ...c, trimStart: newTrimStart, dur: newDur, start: newStart }
        } else {
          const newTrimEnd = Math.max(0, Math.min(c.rawDur - c.trimStart - 0.5, resizingClip.initVal - dSec))
          const newDur = c.rawDur - c.trimStart - newTrimEnd
          return { ...c, trimEnd: newTrimEnd, dur: newDur }
        }
      }))
    }
    if (draggingPlayhead) {
      const pos = Math.max(0, Math.round(getSecFromEvent(e) * 10) / 10)
      setPlayhead(pos)
    }
  }

  function onTimelineMouseUp() {
    if (draggingPlayhead && playing) startPlayback(playhead)
    setDragClipId(null)
    setResizingClip(null)
    setDraggingPlayhead(false)
  }

  // Ruler ticks
  const tickInterval = zoom >= 120 ? 2 : zoom >= 70 ? 5 : zoom >= 40 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= totalDur + tickInterval; t += tickInterval) ticks.push(t)
  const timelineWidth = Math.max(totalDur * zoom + 200, 800)

  const S = {
    shell:         { display: 'flex', flexDirection: 'column' as const, height: 'calc(100svh - var(--topbar-h) - var(--tabs-h))', background: 'var(--bg)' } as React.CSSProperties,
    transport:     { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap' as const } as React.CSSProperties,
    sep:           { width: 1, height: 20, background: 'var(--border-2)', margin: '0 2px', flexShrink: 0 } as React.CSSProperties,
    body:          { display: 'flex', flex: 1, overflow: 'hidden' } as React.CSSProperties,
    libPanel:      { width: 210, flexShrink: 0, background: 'var(--bg-2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
    libHeader:     { padding: '9px 12px 5px', color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.7px', flexShrink: 0 } as React.CSSProperties,
    libList:       { flex: 1, overflowY: 'auto' as const, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 } as React.CSSProperties,
    timelineArea:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
    timelineScroll:{ flex: 1, overflowX: 'auto' as const, overflowY: 'hidden' as const, cursor: dragClipId || resizingClip ? 'grabbing' : draggingPlayhead ? 'ew-resize' : 'default', userSelect: 'none' as const } as React.CSSProperties,
    ruler:         { height: 30, background: 'var(--bg-3)', borderBottom: '1px solid var(--border-2)', position: 'sticky' as const, top: 0, zIndex: 10, overflow: 'hidden' } as React.CSSProperties,
    track:         { height: 80, background: 'var(--bg-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '14px 0 4px', position: 'relative' as const } as React.CSSProperties,
    musicTrack:    { height: 40, background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', position: 'relative' as const } as React.CSSProperties,
    footer:        { padding: '7px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-2)', flexShrink: 0, flexWrap: 'wrap' as const } as React.CSSProperties,
  }

  const tBtn = (extra: React.CSSProperties = {}) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '5px 9px', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, fontWeight: 500, fontFamily: 'var(--font)', cursor: 'pointer', flexShrink: 0, ...extra,
  } as React.CSSProperties)

  return (
    <div style={S.shell}>
      {/* Transport bar */}
      <div style={S.transport}>
        <button style={tBtn()} onClick={() => { stopPlayback(); setPlayhead(0) }} title="Rewind to start">
          <span style={{ display: 'flex', width: 16, height: 16 }}>{icons.rewind}</span>
        </button>
        <button onClick={() => playing ? stopPlayback() : startPlayback(playhead)}
          style={tBtn({ background: 'var(--accent)', color: '#fff', border: 'none', width: 34, height: 34, borderRadius: '50%', padding: 0 })}>
          <span style={{ display: 'flex', width: 16, height: 16 }}>{playing ? icons.pause : icons.play}</span>
        </button>
        <button style={tBtn()} onClick={() => { stopPlayback(); setPlayhead(0) }} title="Stop">
          <span style={{ display: 'flex', width: 16, height: 16 }}>{icons.stop}</span>
        </button>

        <div style={S.sep} />

        <button style={tBtn({ opacity: tlHistory.past.length ? 1 : 0.4 })} onClick={() => dispatchTl({ type: 'UNDO' })} disabled={!tlHistory.past.length} title="Undo timeline">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.undo}</span>
        </button>
        <button style={tBtn({ opacity: tlHistory.future.length ? 1 : 0.4 })} onClick={() => dispatchTl({ type: 'REDO' })} disabled={!tlHistory.future.length} title="Redo timeline">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.redo}</span>
        </button>

        <div style={S.sep} />

        <button style={tBtn()} onClick={() => setShowGapDialog(true)} title="Add silence/gap at playhead">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.silence}</span>
          <span style={{ fontSize: 11 }}>Gap</span>
        </button>

        <button style={tBtn()} onClick={fitToView} title="Fit all clips in view" disabled={!timelineClips.length}>
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.fit}</span>
        </button>

        <div style={S.sep} />

        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Zoom</span>
        <input type="range" min="30" max="200" step="10" value={zoom} onChange={e => setZoom(Number(e.target.value))}
          style={{ width: 70, accentColor: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)', width: 28, flexShrink: 0 }}>{zoom}</span>

        <div style={S.sep} />

        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 500, minWidth: 40 }}>{fmt(Math.floor(playhead))}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>/ {fmt(Math.max(0, Math.floor(totalDur - 5)))}</span>

        <div style={{ flex: 1 }} />

        {mergedUrl && <audio src={mergedUrl} controls style={{ height: 28, width: 180, accentColor: 'var(--accent)' }} />}
        {mergedUrl && (
          <a href={mergedUrl} download="final.wav" style={tBtn()}>
            <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.download}</span>
            <span style={{ fontSize: 11 }}>WAV</span>
          </a>
        )}
        {mergedBlob && ENGINE_URL && (
          <button onClick={handleExportMp3} disabled={exportingMp3} style={tBtn({ opacity: exportingMp3 ? 0.6 : 1 })} title="Export as MP3">
            {exportingMp3 ? <span className="spinner" /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.mp3}</span>}
            <span style={{ fontSize: 11 }}>MP3</span>
          </button>
        )}
        <button onClick={handleMerge} disabled={timelineClips.length < 1 || merging}
          style={tBtn({ background: mergedUrl ? 'var(--ok)' : 'var(--accent)', color: '#fff', border: 'none', padding: '6px 14px', opacity: timelineClips.length < 1 || merging ? 0.5 : 1 })}>
          {merging ? <><span className="spinner" /> Merging…</> : mergedUrl ? <>{icons.check} Re-export</> : <>{icons.merge} Export WAV</>}
        </button>
      </div>

      {/* Main body */}
      <div style={S.body}>
        {/* Asset library */}
        <div style={S.libPanel}>
          <div style={S.libHeader}>Clip Library</div>
          <div style={S.libList}>
            {withAudio.length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 8px', textAlign: 'center' }}>
                {icons.speaker}
                <p style={{ fontSize: 12, marginTop: 8 }}>Generate audio in the Scripts tab first.</p>
              </div>
            ) : withAudio.map((s, i) => {
              const col = CLIP_COLORS[i % CLIP_COLORS.length]
              const lt  = CLIP_LIGHTS[i % CLIP_LIGHTS.length]
              const peaks = s.waveformPeaks ?? Array.from({ length: 5 }, (_, j) => 0.2 + Math.abs(Math.sin((s.id.charCodeAt(0) ?? 65) * 17 + j * 0.7)) * 0.6)
              return (
                <div key={s.id} draggable onDragStart={() => setDragAssetId(s.id)} onDragEnd={() => setDragAssetId(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: dragAssetId === s.id ? lt : 'var(--surface)', cursor: 'grab', transition: 'background 0.1s', opacity: dragAssetId === s.id ? 0.5 : 1 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, flexShrink: 0, background: lt, border: `1px solid ${col}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 16 }}>
                      {peaks.slice(0, 5).map((p, j) => (
                        <div key={j} style={{ width: 2.5, borderRadius: 1.5, height: Math.max(2, Math.round(p * 14)) + 'px', background: col }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      {s.duration ? fmt(s.duration) : '—'}{s.content && ` · ${s.content.trim().split(/\s+/).length}w`}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 13, flexShrink: 0, cursor: 'grab' }}>{icons.drag}</span>
                </div>
              )
            })}
          </div>

          {/* Background music panel */}
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>Background Music</div>
            {bgMusicBlob ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'flex', width: 12, height: 12, color: 'var(--accent)', flexShrink: 0 }}>{icons.music}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bgMusicName}</span>
                  <button onClick={removeBgMusic} style={{ padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, borderRadius: 3 }} title="Remove music">×</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>Vol</span>
                  <input type="range" min="0" max="1" step="0.05" value={bgMusicVolume}
                    onChange={e => setBgMusicVolume(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--mono)', width: 28 }}>{Math.round(bgMusicVolume * 100)}%</span>
                </div>
              </div>
            ) : (
              <button onClick={() => bgMusicInputRef.current?.click()}
                style={{ width: '100%', padding: '6px', border: '1px dashed var(--border-2)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span style={{ display: 'flex', width: 12, height: 12 }}>{icons.music}</span>
                Add background music
              </button>
            )}
            <input ref={bgMusicInputRef} type="file" accept="audio/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleBgMusicUpload(f); e.target.value = '' }} />
          </div>

          {withAudio.length > 0 && (
            <div style={{ padding: '6px 10px 8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>Drag clips onto the timeline. Drag edges to trim. Space to play.</p>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div style={S.timelineArea}>
          <div ref={timelineRef} style={S.timelineScroll}
            onMouseMove={onTimelineMouseMove}
            onMouseUp={onTimelineMouseUp}
            onMouseLeave={onTimelineMouseUp}
          >
            <div style={{ width: timelineWidth, position: 'relative', minHeight: '100%' }}>
              {/* Ruler */}
              <div style={S.ruler}
                onMouseDown={e => {
                  if ((e.target as HTMLElement).closest('[data-playhead]')) return
                  const pos = Math.max(0, Math.round(getSecFromEvent(e) * 10) / 10)
                  setPlayhead(pos)
                  setDraggingPlayhead(true)
                  if (playing) stopPlayback()
                }}>
                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, bottom: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', paddingLeft: 3, paddingTop: 3, display: 'block', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 8, background: 'var(--border-2)' }} />
                  </div>
                ))}
                {ticks.slice(0, -1).flatMap(t => [0.25, 0.5, 0.75].map(frac => (
                  <div key={`m${t}_${frac}`} style={{ position: 'absolute', left: t * zoom + frac * zoom * tickInterval, bottom: 0, width: 1, height: frac === 0.5 ? 7 : 4, background: 'var(--border)' }} />
                )))}
                {/* Playhead on ruler */}
                <div data-playhead="true" style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 20 }}>
                  <div data-playhead="true"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDraggingPlayhead(true); if (playing) stopPlayback() }}
                    style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 14, height: 18, background: 'var(--accent)', borderRadius: '3px 3px 2px 2px', cursor: draggingPlayhead ? 'grabbing' : 'ew-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 2, boxShadow: '0 2px 6px rgba(201,100,66,0.4)' }}>
                    <svg width="6" height="5" viewBox="0 0 6 5"><polygon points="0,0 6,0 3,5" fill="rgba(255,255,255,0.7)" /></svg>
                  </div>
                </div>
              </div>

              {/* Track label */}
              <div style={{ padding: '4px 10px 0' }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Track 1 · Voiceover</span>
              </div>

              {/* Voice track lane */}
              <div style={{ ...S.track, outline: dropActive ? '2px dashed var(--accent)' : 'none', outlineOffset: -3 }}
                onDragOver={onTimelineDragOver}
                onDragLeave={onTimelineDragLeave}
                onDrop={onTimelineDrop}
                onClick={e => {
                  if (!dragClipId && !resizingClip) {
                    setSelectedClipId(null)
                    const pos = getSecFromEvent(e)
                    setPlayhead(pos)
                    if (playing) startPlayback(pos)
                  }
                }}>
                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, bottom: 0, width: 1, background: 'var(--border-3)' }} />
                ))}

                {timelineClips.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-3)', pointerEvents: 'none', letterSpacing: '0.2px' }}>
                    {dropActive ? '✦ Drop to place clip' : 'Drag clips from the library onto this track'}
                  </div>
                )}

                {/* Clips */}
                {timelineClips.map(clip => {
                  const isGap = clip.isGap
                  const col = isGap ? 'var(--text-3)' : CLIP_COLORS[clip.ci % CLIP_COLORS.length]
                  const lt  = isGap ? 'var(--bg-3)'   : CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
                  const clipW = Math.max(clip.dur * zoom, 30)
                  const isActive   = dragClipId === clip.id
                  const isSelected = selectedClipId === clip.id
                  const script = project.scripts.find(s => s.id === clip.scriptId)
                  const peaks  = script?.waveformPeaks
                  const bars   = Math.max(Math.floor((clipW - 16) / 7), 4)

                  return (
                    <div key={clip.id}
                      onMouseDown={e => onClipMouseDown(e, clip)}
                      onClick={e => { e.stopPropagation(); setSelectedClipId(clip.id) }}
                      style={{ position: 'absolute', left: clip.start * zoom, top: 4, height: 72, width: clipW, borderRadius: 7, background: lt, border: `1.5px solid ${isSelected ? col : col + '66'}`, cursor: isActive ? 'grabbing' : 'grab', overflow: 'visible', zIndex: isActive || isSelected ? 100 : 10, boxShadow: isSelected ? `0 0 0 2px ${col}44` : isActive ? '0 6px 18px rgba(30,22,10,0.14)' : 'none', transition: isActive ? 'none' : 'box-shadow 0.12s' }}>

                      {/* Clip inner — clipped */}
                      <div style={{ position: 'absolute', inset: 0, borderRadius: 7, overflow: 'hidden' }}>
                        {/* Header */}
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 22, background: col + '22', borderBottom: `1px solid ${col}33`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 600, color: isGap ? 'var(--text-3)' : col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {isGap ? '⏸ ' : ''}{clip.title}
                          </span>
                          <span style={{ fontSize: 9.5, color: col + 'aa', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{fmt(Math.floor(clip.dur))}</span>
                          {clip.volume !== 1 && !isGap && (
                            <span style={{ fontSize: 9, color: col, fontFamily: 'var(--mono)' }}>{Math.round(clip.volume * 100)}%</span>
                          )}
                          <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); removeClip(clip.id) }}
                            style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(30,22,10,0.12)', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, fontFamily: 'inherit' }}>×</button>
                        </div>

                        {/* Waveform */}
                        {!isGap && (
                          <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 30, overflow: 'hidden' }}>
                            {Array.from({ length: bars }).map((_, j) => {
                              const peakVal = peaks ? peaks[Math.floor(j / bars * peaks.length)] : (0.2 + Math.abs(Math.sin(clip.scriptId.charCodeAt(0) * 17 + j * 0.7)) * 0.5)
                              return (
                                <div key={j} style={{ width: 3.5, borderRadius: 2, flexShrink: 0, height: Math.max(2, Math.round(peakVal * 28)) + 'px', background: col + '99' }} />
                              )
                            })}
                          </div>
                        )}

                        {/* Gap stripe */}
                        {isGap && (
                          <div style={{ position: 'absolute', inset: '22px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
                            <span style={{ fontSize: 18 }}>⏸</span>
                          </div>
                        )}
                      </div>

                      {/* Left trim handle */}
                      {!isGap && (
                        <div onMouseDown={e => onResizeMouseDown(e, clip, 'left')}
                          style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 4, height: 28, borderRadius: 2, background: col + 'cc', boxShadow: '0 0 4px rgba(0,0,0,0.2)' }} />
                        </div>
                      )}
                      {/* Right trim handle */}
                      {!isGap && (
                        <div onMouseDown={e => onResizeMouseDown(e, clip, 'right')}
                          style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 4, height: 28, borderRadius: 2, background: col + 'cc', boxShadow: '0 0 4px rgba(0,0,0,0.2)' }} />
                        </div>
                      )}

                      {/* Volume popup (shows when selected and non-gap) */}
                      {isSelected && !isGap && (
                        <div onMouseDown={e => e.stopPropagation()}
                          style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 12px', boxShadow: 'var(--shadow-lg)', zIndex: 300, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', minWidth: 160 }}>
                          <span style={{ display: 'flex', width: 12, height: 12, color: 'var(--text-2)' }}>{icons.volume}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Volume</span>
                          <input type="range" min="0" max="2" step="0.05" value={clip.volume}
                            onChange={e => setTimelineClips(timelineClips.map(c => c.id === clip.id ? { ...c, volume: parseFloat(e.target.value) } : c))}
                            style={{ width: 80, accentColor: col }} />
                          <span style={{ fontSize: 11, color: col, fontFamily: 'var(--mono)', width: 30 }}>{Math.round(clip.volume * 100)}%</span>
                        </div>
                      )}

                      {/* Trim start indicator */}
                      {!isGap && clip.trimStart > 0 && (
                        <div style={{ position: 'absolute', left: 6, top: 24, fontSize: 9, color: col, fontFamily: 'var(--mono)' }}>↠{fmt(Math.floor(clip.trimStart))}</div>
                      )}
                    </div>
                  )
                })}

                {/* Playhead in track */}
                <div style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 50, pointerEvents: 'none', opacity: 0.7 }} />
              </div>

              {/* Music track */}
              {bgMusicBlob && (
                <>
                  <div style={{ padding: '4px 10px 0' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Track 2 · Background Music · {Math.round(bgMusicVolume * 100)}%
                    </span>
                  </div>
                  <div style={S.musicTrack}>
                    {ticks.map(t => (
                      <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, bottom: 0, width: 1, background: 'var(--border-3)' }} />
                    ))}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, gap: 6 }}>
                      <span style={{ display: 'flex', width: 12, height: 12, color: 'var(--accent)', opacity: 0.6 }}>{icons.music}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bgMusicName} — loops to fill timeline</span>
                    </div>
                    <div style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 50, pointerEvents: 'none', opacity: 0.7 }} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={S.footer}>
            {timelineClips.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No clips on timeline yet — drag from the library.</span>
            ) : (
              <>
                {[...timelineClips].sort((a, b) => a.start - b.start).map(clip => {
                  const col = clip.isGap ? 'var(--text-3)' : CLIP_COLORS[clip.ci % CLIP_COLORS.length]
                  const lt  = clip.isGap ? 'var(--bg-3)'   : CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
                  return (
                    <span key={clip.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: lt, color: col, border: `1px solid ${clip.isGap ? 'var(--border)' : col + '44'}`, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 120, textOverflow: 'ellipsis' }}>
                      {clip.isGap ? '⏸ ' : ''}{clip.title.substring(0, 16)}
                    </span>
                  )
                })}
              </>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{timelineClips.length} clip{timelineClips.length !== 1 ? 's' : ''} · Space to play</span>
          </div>
        </div>
      </div>

      {/* Gap/Silence dialog */}
      {showGapDialog && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowGapDialog(false)}>
          <div className="modal" style={{ maxWidth: 340 }}>
            <div className="modal__title">Add Silence / Gap</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Insert a silent gap at the current playhead position ({fmt(Math.floor(playhead))}).</p>
              <div className="field">
                <label>Duration</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[0.5, 1, 2, 3, 5].map(d => (
                    <button key={d} className={`btn btn--sm ${gapDuration === d ? 'btn--primary' : ''}`} onClick={() => setGapDuration(d)}>{d}s</button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <input type="range" min="0.1" max="10" step="0.1" value={gapDuration} onChange={e => setGapDuration(parseFloat(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)', width: 36 }}>{gapDuration.toFixed(1)}s</span>
                </div>
              </div>
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setShowGapDialog(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => addGap(gapDuration)}>{icons.silence} Insert Gap</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
