import { useState, useRef, useEffect, useReducer, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons } from '../lib/constants'
import { fmt } from '../lib/audio'
import { segmentReducer, retimeSegment, resizeSegment, MIN_SEGMENT_DUR } from '../lib/dubbing'
import { useEscapeKey } from '../hooks/useEscapeKey'
import type { DubSegment, DubSegmentHistory } from '../lib/types'

const SEG_COLOR = '#c96442'
const SEG_LIGHT = 'rgba(201,100,66,0.14)'
const TRACK_H = 64
const RULER_H = 26

interface SegmentsResponse {
  job_id: string
  status: string
  editable: boolean
  target_language: string
  source_language: string | null
  duration_seconds: number | null
  segments: DubSegment[]
}

interface ThumbMeta {
  frame_count: number
  interval_seconds: number
  columns: number
  rows: number
  thumb_width: number
  thumb_height: number
}

const THUMB_ROW_H = 44

export function DubbingTimelineEditor({
  jobId, targetLanguage, onFinalized, onCancel,
}: {
  jobId: string
  targetLanguage: string
  onFinalized: () => void
  onCancel?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editable, setEditable] = useState(true)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  const [history, dispatch] = useReducer(
    segmentReducer,
    { past: [], present: [], future: [] } as DubSegmentHistory
  )
  const segments = history.present
  const setSegments = useCallback((segs: DubSegment[]) => dispatch({ type: 'SET', segments: segs }), [])
  // Snapshot of the last-saved state, to know whether there's anything to save.
  const [savedSnapshot, setSavedSnapshot] = useState<string>('[]')
  const dirty = JSON.stringify(segments) !== savedSnapshot

  const [zoom, setZoom] = useState(70) // px per second
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackScrollRef = useRef<HTMLDivElement>(null)

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragStartX, setDragStartX] = useState(0)
  const [dragStartVal, setDragStartVal] = useState(0)
  const [resizing, setResizing] = useState<{ id: string; side: 'left' | 'right'; initX: number; initVal: number } | null>(null)

  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  const [thumbMeta, setThumbMeta] = useState<ThumbMeta | null>(null)
  const [thumbSpriteUrl, setThumbSpriteUrl] = useState<string | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [merging, setMerging] = useState(false)

  useEscapeKey(() => setSelectedId(null))

  // ── Load segments + source video ────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([
      api.fetchDubbingSegments(jobId) as Promise<SegmentsResponse>,
      api.fetchDubbingSource(jobId).catch(() => null),
    ]).then(([segRes, videoBlob]) => {
      if (cancelled) return
      const segs = segRes.segments ?? []
      setSegments(segs)
      setSavedSnapshot(JSON.stringify(segs))
      setEditable(segRes.editable)
      if (videoBlob) setVideoUrl(URL.createObjectURL(videoBlob))
    }).catch(e => {
      if (cancelled) return
      setLoadError(e instanceof ApiError ? e.message : 'Could not load the review timeline.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  // ── Load the thumbnail filmstrip separately — this can be slow (it's
  // generated on first request) and is purely cosmetic, so it shouldn't
  // block or fail the main segments/video load above.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.fetchDubbingThumbnailMeta(jobId),
      api.fetchDubbingThumbnailSprite(jobId),
    ]).then(([meta, spriteBlob]) => {
      if (cancelled) return
      setThumbMeta(meta)
      setThumbSpriteUrl(URL.createObjectURL(spriteBlob))
    }).catch(() => {
      // Filmstrip is a nice-to-have — the editor works fine without it,
      // just plainer, so a failure here is silent rather than toast-worthy.
    })
    return () => { cancelled = true }
  }, [jobId])

  useEffect(() => () => { if (thumbSpriteUrl) URL.revokeObjectURL(thumbSpriteUrl) }, [thumbSpriteUrl])

  // ── Undo/redo keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      else if (e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Video <-> playhead sync ──────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setPlayhead(v.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onDuration = () => setVideoDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('loadedmetadata', onDuration)
    v.addEventListener('durationchange', onDuration)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('loadedmetadata', onDuration)
      v.removeEventListener('durationchange', onDuration)
    }
  }, [videoUrl])

  function seekTo(t: number) {
    setPlayhead(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  // ── Drag (retime) / resize handlers ─────────────────────────────
  function onSegMouseDown(e: React.MouseEvent, seg: DubSegment) {
    if (!editable) return
    e.stopPropagation()
    setSelectedId(seg.id)
    setDragId(seg.id)
    setDragStartX(e.clientX)
    setDragStartVal(seg.start)
  }

  function onResizeMouseDown(e: React.MouseEvent, seg: DubSegment, side: 'left' | 'right') {
    if (!editable) return
    e.stopPropagation()
    e.preventDefault()
    setSelectedId(seg.id)
    setResizing({ id: seg.id, side, initX: e.clientX, initVal: side === 'left' ? seg.start : seg.end })
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragId) {
        const dSec = (e.clientX - dragStartX) / zoom
        setSegments(retimeSegment(segments, dragId, dragStartVal + dSec))
      } else if (resizing) {
        const dSec = (e.clientX - resizing.initX) / zoom
        setSegments(resizeSegment(segments, resizing.id, resizing.side, resizing.initVal + dSec))
      }
    }
    function onUp() { setDragId(null); setResizing(null) }
    if (dragId || resizing) {
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId, resizing, zoom, dragStartX, dragStartVal])

  function onTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (dragId || resizing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, (e.clientX - rect.left + (trackScrollRef.current?.scrollLeft ?? 0)) / zoom)
    seekTo(t)
    setSelectedId(null)
  }

  function deleteSegment(id: string) {
    setSegments(segments.filter(s => s.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function muteSegment(id: string) {
    // "Mute" = keep the timing slot (so nothing downstream reflows) but
    // synthesize nothing for it — the finalize pipeline pads silence for
    // any window it doesn't have audio-worthy text for.
    setSegments(segments.map(s => s.id === id ? { ...s, text: '' } : s))
  }

  function updateSelectedText(text: string) {
    if (!selectedId) return
    setSegments(segments.map(s => s.id === selectedId ? { ...s, text } : s))
  }

  /**
   * Split creates a genuinely new segment id — unlike every other edit
   * here (retime/resize/mute/text), that can't be done purely client-side
   * and folded into the next "Save changes": the backend deliberately
   * rejects unrecognized ids on the general save path (see
   * VideoDubbingController::updateSegments), so a fresh id has to come
   * from a dedicated, validated endpoint. That means split (and merge,
   * same reasoning) commits immediately rather than waiting for Save.
   */
  async function handleSplit() {
    if (!selected) return
    setSplitting(true)
    try {
      const res = await api.splitDubbingSegment(jobId, selected.id, playhead)
      const segs = res.segments as unknown as DubSegment[]
      setSegments(segs)
      setSavedSnapshot(JSON.stringify(segs))
      toast.ok('Segment split.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not split this segment.')
    } finally {
      setSplitting(false)
    }
  }

  async function handleMerge() {
    if (!selected) return
    const idx = segments.findIndex(s => s.id === selected.id)
    const next = segments[idx + 1]
    if (!next) return
    setMerging(true)
    try {
      const res = await api.mergeDubbingSegments(jobId, selected.id, next.id)
      const segs = res.segments as unknown as DubSegment[]
      setSegments(segs)
      setSavedSnapshot(JSON.stringify(segs))
      setSelectedId(selected.id) // merged segment keeps the earlier id
      toast.ok('Segments merged.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not merge these segments.')
    } finally {
      setMerging(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.saveDubbingSegments(jobId, segments.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text })))
      setSavedSnapshot(JSON.stringify(segments))
      toast.ok('Changes saved.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate() {
    setFinalizing(true)
    try {
      if (dirty) {
        await api.saveDubbingSegments(jobId, segments.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text })))
        setSavedSnapshot(JSON.stringify(segments))
      }
      await api.finalizeDubbingJob(jobId)
      toast.ok('Generating your dubbed video…')
      onFinalized()
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not start synthesis.')
    } finally {
      setFinalizing(false)
    }
  }

  const totalDur = Math.max(30, ...segments.map(s => s.end), videoDuration)
  const trackWidth = Math.max(totalDur * zoom + 120, 400)
  const tickInterval = zoom >= 120 ? 2 : zoom >= 60 ? 5 : zoom >= 30 ? 10 : 30
  const ticks = useMemo(() => {
    const arr: number[] = []
    for (let t = 0; t <= totalDur + tickInterval; t += tickInterval) arr.push(t)
    return arr
  }, [totalDur, tickInterval])

  const selected = segments.find(s => s.id === selectedId) ?? null
  const canSplit = !!selected && editable
    && playhead > selected.start + MIN_SEGMENT_DUR && playhead < selected.end - MIN_SEGMENT_DUR
  const selectedIdx = selected ? segments.findIndex(s => s.id === selected.id) : -1
  const canMerge = !!selected && editable && selectedIdx !== -1 && selectedIdx < segments.length - 1

  const S = {
    wrap: { display: 'flex', flexDirection: 'column' as const, gap: 12 },
    videoBox: { width: '100%', maxHeight: 380, background: '#000', borderRadius: 'var(--radius)', overflow: 'hidden', display: 'flex', justifyContent: 'center' },
    toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' },
    tBtn: (extra: React.CSSProperties = {}) => ({
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border-2)',
      background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-2)', ...extra,
    }),
  }

  if (loading) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
      <span className="spinner" /> Loading review timeline…
    </div>
  }
  if (loadError) {
    return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--warn, #c94242)', fontSize: 13 }}>{loadError}</div>
  }

  return (
    <div style={S.wrap}>
      {videoUrl && (
        <div style={S.videoBox}>
          <video ref={videoRef} src={videoUrl} style={{ maxWidth: '100%', maxHeight: 380 }} />
        </div>
      )}

      {/* Toolbar */}
      <div style={S.toolbar}>
        <button style={S.tBtn()} title="Delete segment" disabled={!selected}
          onClick={() => selected && deleteSegment(selected.id)}>
          <span style={{ width: 14, height: 14, opacity: selected ? 1 : 0.4 }}>{icons.trash}</span>
        </button>
        <button style={S.tBtn()} title="Mute segment (keeps timing, removes speech)" disabled={!selected}
          onClick={() => selected && muteSegment(selected.id)}>
          <span style={{ width: 14, height: 14, opacity: selected ? 1 : 0.4 }}>{icons.silence}</span>
        </button>
        <button style={S.tBtn()} title={canSplit ? 'Split segment at playhead' : 'Move the playhead inside the selected segment to split it'}
          disabled={!canSplit || splitting} onClick={handleSplit}>
          {splitting
            ? <span className="spinner" style={{ width: 12, height: 12 }} />
            : <span style={{ width: 14, height: 14, opacity: canSplit ? 1 : 0.4 }}>{icons.split}</span>}
        </button>
        <button style={S.tBtn()} title={canMerge ? 'Merge with next segment' : 'Select a segment with another one right after it to merge'}
          disabled={!canMerge || merging} onClick={handleMerge}>
          {merging
            ? <span className="spinner" style={{ width: 12, height: 12 }} />
            : <span style={{ width: 14, height: 14, opacity: canMerge ? 1 : 0.4 }}>{icons.merge}</span>}
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border-2)' }} />
        <button style={S.tBtn()} title="Undo (Ctrl/⌘+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'UNDO' })}>
          <span style={{ width: 14, height: 14, opacity: history.past.length ? 1 : 0.4 }}>{icons.undo}</span>
        </button>
        <button style={S.tBtn()} title="Redo (Ctrl/⌘+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'REDO' })}>
          <span style={{ width: 14, height: 14, opacity: history.future.length ? 1 : 0.4 }}>{icons.redo}</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border-2)' }} />
        <button style={S.tBtn()} title={playing ? 'Pause' : 'Play'} onClick={() => playing ? videoRef.current?.pause() : videoRef.current?.play()}>
          <span style={{ width: 14, height: 14 }}>{playing ? icons.pause : icons.play}</span>
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--mono)', minWidth: 44 }}>{fmt(Math.floor(playhead))}</span>

        <div style={{ flex: 1 }} />

        <span style={{ display: 'flex', width: 14, height: 14, color: 'var(--text-3)' }}>{icons.zoomOut}</span>
        <input type="range" min={20} max={200} step={10} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 100 }} />
        <span style={{ display: 'flex', width: 14, height: 14, color: 'var(--text-3)' }}>{icons.zoomIn}</span>
      </div>

      {/* Timeline */}
      <div ref={trackScrollRef} style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)' }}>
        <div style={{ position: 'relative', width: trackWidth, userSelect: 'none' as const }}>
          {/* Ruler */}
          <div style={{ position: 'relative', height: RULER_H, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekTo(Math.max(0, (e.clientX - r.left) / zoom)) }}>
            {ticks.map(t => (
              <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 1, height: 6, background: 'var(--border-2)', marginRight: 3 }} />
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
              </div>
            ))}
          </div>

          {/* Segment track */}
          <div onClick={onTrackClick} style={{ position: 'relative', height: TRACK_H, cursor: 'text' }}>
            {segments.map(seg => {
              const isSel = seg.id === selectedId
              const isEmpty = !seg.text.trim()
              const w = Math.max((seg.end - seg.start) * zoom, 24)
              return (
                <div key={seg.id}
                  onMouseDown={e => onSegMouseDown(e, seg)}
                  onClick={e => { e.stopPropagation(); setSelectedId(seg.id) }}
                  style={{
                    position: 'absolute', left: seg.start * zoom, top: 6, height: TRACK_H - 12, width: w,
                    borderRadius: 7, background: isEmpty ? 'var(--bg-3)' : SEG_LIGHT,
                    border: `1.5px solid ${isSel ? SEG_COLOR : isEmpty ? 'var(--border-2)' : SEG_COLOR + '77'}`,
                    boxShadow: isSel ? `0 0 0 2px ${SEG_COLOR}44` : 'none',
                    cursor: editable ? (dragId === seg.id ? 'grabbing' : 'grab') : 'default',
                    overflow: 'hidden', padding: '4px 8px', zIndex: isSel ? 20 : 5,
                    display: 'flex', alignItems: 'center',
                  }}>
                  <span style={{
                    fontSize: 11.5, color: isEmpty ? 'var(--text-3)' : 'var(--text-1)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontStyle: isEmpty ? 'italic' : 'normal',
                  }}>
                    {isEmpty ? 'Muted' : seg.text || '—'}
                  </span>
                  {editable && (
                    <>
                      <div onMouseDown={e => onResizeMouseDown(e, seg, 'left')}
                        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                      <div onMouseDown={e => onResizeMouseDown(e, seg, 'right')}
                        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Thumbnail filmstrip — purely visual, absent if generation hasn't
              finished/succeeded yet; the timeline is fully usable without it. */}
          {thumbMeta && thumbSpriteUrl && (
            <div style={{ position: 'relative', height: THUMB_ROW_H, borderTop: '1px solid var(--border)', overflow: 'hidden', background: '#000' }}>
              {Array.from({ length: thumbMeta.frame_count }).map((_, i) => {
                const col = i % thumbMeta.columns
                const row = Math.floor(i / thumbMeta.columns)
                return (
                  <div key={i} style={{
                    position: 'absolute',
                    left: i * thumbMeta.interval_seconds * zoom,
                    top: 0, height: THUMB_ROW_H,
                    width: thumbMeta.interval_seconds * zoom,
                    backgroundImage: `url(${thumbSpriteUrl})`,
                    backgroundPosition: `-${col * thumbMeta.thumb_width}px -${row * thumbMeta.thumb_height}px`,
                    backgroundSize: `${thumbMeta.columns * thumbMeta.thumb_width}px ${thumbMeta.rows * thumbMeta.thumb_height}px`,
                    borderRight: '1px solid rgba(0,0,0,0.35)',
                  }} />
                )
              })}
            </div>
          )}

          {/* Playhead — spans the ruler, segment track, and filmstrip */}
          <div style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', pointerEvents: 'none', zIndex: 30 }} />
        </div>
      </div>

      {/* Selected segment editor */}
      {selected && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, background: 'var(--surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-3)' }}>
              Segment · {fmt(Math.floor(selected.start))}–{fmt(Math.floor(selected.end))} ({(selected.end - selected.start).toFixed(1)}s)
            </span>
            {!editable && <span className="tag" style={{ fontSize: 10 }}>Read-only — job already finalized</span>}
          </div>
          {selected.original && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 3 }}>Original</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', fontStyle: 'italic' }}>{selected.original}</div>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginBottom: 3 }}>Translated ({targetLanguage.toUpperCase()})</div>
          <textarea
            value={selected.text}
            onChange={e => updateSelectedText(e.target.value)}
            disabled={!editable}
            rows={2}
            style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--bg-2)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'var(--font)' }}
          />
        </div>
      )}

      {/* Action bar */}
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
          {onCancel && <button className="btn btn--ghost" onClick={onCancel} disabled={finalizing}>Cancel</button>}
          <button className="btn btn--ghost" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <span className="spinner" /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.check}</span>} Save changes
          </button>
          <button
            onClick={handleGenerate}
            disabled={finalizing || segments.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: finalizing ? 0.6 : 1 }}
          >
            {finalizing ? <><span className="spinner" /> Starting…</> : 'Generate dubbed video'}
          </button>
        </div>
      )}
    </div>
  )
}
