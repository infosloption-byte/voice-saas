import { useState, useRef, useEffect, useReducer, useCallback, useMemo } from 'react'
import { api, ApiError } from '../lib/api'
import { toast } from '../lib/toast'
import { icons } from '../lib/constants'
import { fmt } from '../lib/audio'
import {
  videoTimelineReducer, positionClip, resizeClip, addClipToTimeline, removeClip, clipDuration,
  MAX_IMAGE_DUR,
} from '../lib/videoTimeline'
import type { VideoTimelineClip, VideoTimelineHistory, VideoProjectAsset } from '../lib/types'

/**
 * Task #15 (Video Studio) Phase 5 — the real multi-lane timeline editor.
 * See docs/ENHANCEMENT_TASKS.md task #15's Phase 5 note and
 * lib/videoTimeline.ts's docblock for why this is its own component
 * rather than a reuse of AssemblyPage's inline timeline or
 * DubbingTimelineEditor: independent lanes that can overlap in time is
 * the entire point here, unlike either of those single-lane-by-design
 * editors. The drag/resize *mechanics* below are deliberately the same
 * shape as DubbingTimelineEditor's (snapshot the array at gesture start,
 * recompute the whole array against that fixed snapshot on every
 * mousemove, commit via the history reducer) — that pattern is already
 * proven there, no reason to invent a different one here.
 *
 * Self-contained data-fetching, same reasoning DubbingTimelineEditor
 * gives for its own fetchDubbingSegments() call: this editor is opened
 * on demand (see DubbingStudioPage's "Timeline" toggle), and re-fetching
 * its own project+assets+timeline on open is simpler and more reliably
 * correct than threading that state down through the parent's own
 * poll-while-processing effect, which has a different (asset-status)
 * concern.
 *
 * Not done here (left for a later pass, see the Phase 5 plan note in
 * docs/ENHANCEMENT_TASKS.md): no composed multi-lane preview — a
 * selected clip can be scrubbed/previewed on its own, but there is no
 * single "play the whole arrangement" transport, since that requires
 * real compositing (overlapping video/image/audio lanes mixed together)
 * which is exactly what Phase 6's RenderVideoProjectJob exists to do
 * server-side. Building a client-side multi-track compositor here would
 * duplicate that work and still not match the real render pixel-for-
 * pixel, so it's deliberately out of scope.
 */

const LANE_H = 54
const LANE_GAP = 6
const RULER_H = 26
const MIN_LANES = 3
const MAX_LANES = 12

const KIND_COLOR: Record<VideoTimelineClip['kind'], { border: string; fill: string }> = {
  video: { border: '#4f8cff', fill: 'rgba(79,140,255,0.16)' },
  audio: { border: '#c96442', fill: 'rgba(201,100,66,0.16)' },
  image: { border: '#8a6fd6', fill: 'rgba(138,111,214,0.16)' },
}

const KIND_ICON: Record<VideoTimelineClip['kind'], string> = {
  video: '🎞️', audio: '🎵', image: '🖼️',
}

interface ProjectResponse {
  id: string
  assets?: VideoProjectAsset[]
  timeline_json?: VideoTimelineClip[]
}

export function VideoTimelineEditor({ videoProjectId, onClose }: {
  videoProjectId: string
  /** Task #15 Phase 5 — parent (DubbingStudioPage) collapses its "Timeline" panel; optional so the component also works embedded without a close affordance. */
  onClose?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [assets, setAssets] = useState<VideoProjectAsset[]>([])

  const [history, dispatch] = useReducer(
    videoTimelineReducer,
    { past: [], present: [], future: [] } as VideoTimelineHistory
  )
  const clips = history.present
  const setClips = useCallback((next: VideoTimelineClip[]) => dispatch({ type: 'SET', clips: next }), [])
  const [savedSnapshot, setSavedSnapshot] = useState<string>('[]')
  const dirty = JSON.stringify(clips) !== savedSnapshot

  const [manualLaneCount, setManualLaneCount] = useState(MIN_LANES)
  const [targetLane, setTargetLane] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(50) // px per second
  const [saving, setSaving] = useState(false)

  const trackScrollRef = useRef<HTMLDivElement>(null)
  const laneAreaRef = useRef<HTMLDivElement>(null)

  const assetsById = useMemo(
    () => Object.fromEntries(assets.map(a => [a.id, a] as const)),
    [assets]
  )
  const readyAssets = useMemo(() => assets.filter(a => a.status === 'ready'), [assets])
  const selected = clips.find(c => c.id === selectedId) ?? null
  const selectedAsset = selected ? assetsById[selected.asset_id] : null

  const laneCount = Math.max(
    MIN_LANES,
    manualLaneCount,
    ...clips.map(c => c.lane + 1)
  )

  // ── Load project (assets + saved arrangement) ───────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    api.fetchVideoProject(videoProjectId).then(raw => {
      if (cancelled) return
      const res = raw as ProjectResponse
      const loadedClips = res.timeline_json ?? []
      setAssets(res.assets ?? [])
      setClips(loadedClips)
      setSavedSnapshot(JSON.stringify(loadedClips))
    }).catch(e => {
      if (cancelled) return
      setLoadError(e instanceof ApiError ? e.message : 'Could not load the timeline.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoProjectId])

  // ── Undo/redo + delete keyboard shortcuts ───────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      else if (meta && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); dispatch({ type: 'REDO' }) }
      else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'REDO' }) }
      else if (!typing && !meta && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        setClips(removeClip(clips, selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, selectedId])

  // ── Drag (reposition + re-lane) / resize — snapshot-at-gesture-start,
  // same shape as DubbingTimelineEditor's onSegMouseDown/onResizeMouseDown. ──
  const [dragging, setDragging] = useState<{
    id: string; startX: number; startY: number; origStart: number; origLane: number
  } | null>(null)
  const [resizing, setResizing] = useState<{
    id: string; side: 'left' | 'right'; startX: number; origValue: number
  } | null>(null)
  const gestureSnapshotRef = useRef<VideoTimelineClip[]>([])

  function onClipMouseDown(e: React.MouseEvent, clip: VideoTimelineClip) {
    e.stopPropagation()
    setSelectedId(clip.id)
    gestureSnapshotRef.current = clips
    setDragging({ id: clip.id, startX: e.clientX, startY: e.clientY, origStart: clip.start_time, origLane: clip.lane })
  }

  function onResizeMouseDown(e: React.MouseEvent, clip: VideoTimelineClip, side: 'left' | 'right') {
    e.stopPropagation()
    e.preventDefault()
    setSelectedId(clip.id)
    gestureSnapshotRef.current = clips
    setResizing({ id: clip.id, side, startX: e.clientX, origValue: side === 'left' ? clip.trim_in : clip.trim_out })
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (dragging) {
        const dSec = (e.clientX - dragging.startX) / zoom
        const laneDelta = Math.round((e.clientY - dragging.startY) / (LANE_H + LANE_GAP))
        const newLane = Math.max(0, Math.min(MAX_LANES - 1, dragging.origLane + laneDelta))
        setClips(positionClip(gestureSnapshotRef.current, dragging.id, newLane, dragging.origStart + dSec))
      } else if (resizing) {
        const dSec = (e.clientX - resizing.startX) / zoom
        const clip = gestureSnapshotRef.current.find(c => c.id === resizing.id)
        const asset = clip ? assetsById[clip.asset_id] : null
        const maxDur = asset?.kind === 'image' ? MAX_IMAGE_DUR : (asset?.duration_seconds ?? MAX_IMAGE_DUR * 4)
        setClips(resizeClip(gestureSnapshotRef.current, resizing.id, resizing.side, resizing.origValue + dSec, maxDur))
      }
    }
    function onUp() { setDragging(null); setResizing(null) }
    if (dragging || resizing) {
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, resizing, zoom, assetsById])

  // ── Add from bin: "+" button (appends to targetLane) and native HTML5
  // drag-and-drop onto a specific lane at a specific drop position. ──
  function addAssetToLane(asset: VideoProjectAsset, lane: number) {
    const withNew = addClipToTimeline(clips, asset, lane)
    const newClip = withNew[withNew.length - 1]
    setClips(withNew)
    setSelectedId(newClip.id)
  }

  function onLaneDrop(e: React.DragEvent, lane: number) {
    e.preventDefault()
    const assetId = e.dataTransfer.getData('text/plain')
    const asset = assetsById[assetId]
    if (!asset || asset.status !== 'ready') return
    const rect = e.currentTarget.getBoundingClientRect()
    const desiredStart = Math.max(0, (e.clientX - rect.left) / zoom)
    const withNew = addClipToTimeline(clips, asset, lane)
    const newClip = withNew[withNew.length - 1]
    setClips(positionClip(withNew, newClip.id, lane, desiredStart))
    setSelectedId(newClip.id)
  }

  function deleteSelected() {
    if (!selectedId) return
    setClips(removeClip(clips, selectedId))
    setSelectedId(null)
  }

  function addLane() {
    setManualLaneCount(n => Math.min(MAX_LANES, n + 1))
  }

  function removeLane(idx: number) {
    if (clips.some(c => c.lane === idx)) {
      toast.info('Move or delete the clips on this lane before removing it.')
      return
    }
    setClips(clips.map(c => (c.lane > idx ? { ...c, lane: c.lane - 1 } : c)))
    setManualLaneCount(n => Math.max(MIN_LANES, n - 1))
    if (targetLane >= idx && targetLane > 0) setTargetLane(l => l - 1)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.updateVideoProjectTimeline(videoProjectId, clips)
      setSavedSnapshot(JSON.stringify(clips))
      toast.ok('Timeline saved.')
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Could not save the timeline.')
    } finally {
      setSaving(false)
    }
  }

  // ── Ruler ticks ───────────────────────────────────────────────
  const totalDuration = Math.max(30, ...clips.map(c => c.start_time + clipDuration(c)), 0) + 10
  const tickStep = zoom >= 80 ? 5 : zoom >= 35 ? 10 : 30
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t <= totalDuration; t += tickStep) out.push(t)
    return out
  }, [totalDuration, tickStep])
  const trackWidth = Math.max(600, totalDuration * zoom + 80)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13, padding: '24px 0' }}>
        <span className="spinner" /> Loading timeline…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="empty-state" style={{ padding: '20px 0' }}>
        <p>{loadError}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} onMouseDown={() => setSelectedId(null)}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={e => e.stopPropagation()}>
        <span style={{ display: 'flex', width: 15, height: 15, color: 'var(--text-3)' }}>{icons.layers}</span>
        <strong style={{ fontSize: 13.5 }}>Timeline</strong>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Drag clips from Media below onto a lane, or use +</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn--ghost" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? <span className="spinner" /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.check}</span>} Save
        </button>
        {onClose && (
          <button className="ds-icon-btn" title="Close timeline" onClick={onClose}>{icons.close}</button>
        )}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onMouseDown={e => e.stopPropagation()}>
        <button className="ds-icon-btn" title="Delete selected clip" disabled={!selected} onClick={deleteSelected}>
          <span style={{ width: 14, height: 14, opacity: selected ? 1 : 0.4, display: 'flex' }}>{icons.trash}</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border-2)' }} />
        <button className="ds-icon-btn" title="Undo (Ctrl/⌘+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'UNDO' })}>
          <span style={{ width: 14, height: 14, opacity: history.past.length ? 1 : 0.4, display: 'flex' }}>{icons.undo}</span>
        </button>
        <button className="ds-icon-btn" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'REDO' })}>
          <span style={{ width: 14, height: 14, opacity: history.future.length ? 1 : 0.4, display: 'flex' }}>{icons.redo}</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--border-2)' }} />
        <button className="ds-icon-btn" title="Add lane" disabled={laneCount >= MAX_LANES} onClick={addLane}>
          <span style={{ width: 14, height: 14, opacity: laneCount >= MAX_LANES ? 0.4 : 1, display: 'flex' }}>{icons.plus}</span>
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{laneCount} lane{laneCount !== 1 ? 's' : ''}</span>

        <div style={{ flex: 1 }} />

        <span style={{ display: 'flex', width: 14, height: 14, color: 'var(--text-3)' }}>{icons.zoomOut}</span>
        <input type="range" min={15} max={150} step={5} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 100 }} />
        <span style={{ display: 'flex', width: 14, height: 14, color: 'var(--text-3)' }}>{icons.zoomIn}</span>
      </div>

      {/* ── Main row: lane labels + scrollable lane tracks, plus a
          selected-clip preview to the side. ───────────────────────── */}
      <div style={{ display: 'flex', gap: 12 }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* Lane label gutter */}
          <div style={{ width: 84, flexShrink: 0, background: 'var(--bg-3)', borderRight: '1px solid var(--border)' }}>
            <div style={{ height: RULER_H, borderBottom: '1px solid var(--border)' }} />
            {Array.from({ length: laneCount }).map((_, i) => (
              <div
                key={i}
                onClick={() => setTargetLane(i)}
                title="Click to make this the target lane for + buttons below"
                style={{
                  height: LANE_H, marginTop: i === 0 ? 0 : LANE_GAP, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', padding: '0 8px', cursor: 'pointer',
                  background: targetLane === i ? 'var(--surface-2)' : 'transparent',
                  borderLeft: targetLane === i ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Lane {i + 1}</span>
                {laneCount > MIN_LANES && !clips.some(c => c.lane === i) && (
                  <button
                    className="ds-icon-btn"
                    style={{ width: 18, height: 18, padding: 0 }}
                    title="Remove empty lane"
                    onClick={e => { e.stopPropagation(); removeLane(i) }}
                  >
                    <span style={{ width: 10, height: 10, display: 'flex' }}>{icons.close}</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Scrollable lane tracks */}
          <div ref={trackScrollRef} style={{ overflowX: 'auto', flex: 1, background: 'var(--bg-2)' }}>
            <div style={{ position: 'relative', width: trackWidth, userSelect: 'none' as const }}>
              {/* Ruler */}
              <div style={{ position: 'relative', height: RULER_H, borderBottom: '1px solid var(--border)' }}>
                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: 1, height: 6, background: 'var(--border-2)', marginRight: 3 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
                  </div>
                ))}
              </div>

              {/* Lanes */}
              <div ref={laneAreaRef} style={{ position: 'relative' }}>
                {Array.from({ length: laneCount }).map((_, laneIdx) => (
                  <div
                    key={laneIdx}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => onLaneDrop(e, laneIdx)}
                    style={{
                      position: 'relative', height: LANE_H, marginTop: laneIdx === 0 ? 0 : LANE_GAP,
                      background: laneIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                      borderTop: '1px solid var(--border-2)',
                    }}
                  >
                    {clips.filter(c => c.lane === laneIdx).map(clip => {
                      const asset = assetsById[clip.asset_id]
                      const isSel = clip.id === selectedId
                      const colors = KIND_COLOR[clip.kind]
                      const w = Math.max(clipDuration(clip) * zoom, 30)
                      return (
                        <div
                          key={clip.id}
                          onMouseDown={e => onClipMouseDown(e, clip)}
                          onClick={e => { e.stopPropagation(); setSelectedId(clip.id) }}
                          style={{
                            position: 'absolute', left: clip.start_time * zoom, top: 5, height: LANE_H - 10, width: w,
                            borderRadius: 7, background: colors.fill,
                            border: `1.5px solid ${isSel ? colors.border : colors.border + '88'}`,
                            boxShadow: isSel ? `0 0 0 2px ${colors.border}44` : 'none',
                            cursor: dragging?.id === clip.id ? 'grabbing' : 'grab',
                            overflow: 'hidden', padding: '4px 8px', zIndex: isSel ? 20 : 5,
                            display: 'flex', alignItems: 'center', gap: 5,
                          }}
                        >
                          <span style={{ fontSize: 12 }}>{KIND_ICON[clip.kind]}</span>
                          <span style={{
                            fontSize: 11.5, color: 'var(--text-1)', whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {asset?.original_filename ?? clip.kind}
                          </span>
                          <div onMouseDown={e => onResizeMouseDown(e, clip, 'left')}
                            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                          <div onMouseDown={e => onResizeMouseDown(e, clip, 'right')}
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Selected-clip preview — see this component's docblock for why
            there's no composed multi-lane playback here. */}
        <div style={{ width: 220, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-2)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {selected && selectedAsset ? (
            <>
              <div style={{ width: '100%', height: 110, borderRadius: 6, overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {selectedAsset.kind === 'image' ? (
                  <img src={api.videoProjectAssetFileUrl(videoProjectId, selectedAsset.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : selectedAsset.kind === 'video' ? (
                  <video
                    key={selectedAsset.id}
                    src={api.videoProjectAssetFileUrl(videoProjectId, selectedAsset.id)}
                    controls
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onLoadedMetadata={e => { e.currentTarget.currentTime = selected.trim_in }}
                  />
                ) : (
                  <span style={{ width: 30, height: 30, display: 'flex', color: 'var(--text-3)' }}>{icons.music}</span>
                )}
              </div>
              {selectedAsset.kind === 'audio' && (
                <audio
                  key={selectedAsset.id}
                  src={api.videoProjectAssetFileUrl(videoProjectId, selectedAsset.id)}
                  controls
                  style={{ width: '100%' }}
                  onLoadedMetadata={e => { e.currentTarget.currentTime = selected.trim_in }}
                />
              )}
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedAsset.original_filename ?? selected.kind}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                Lane {selected.lane + 1} · {fmt(Math.floor(selected.start_time))} · {clipDuration(selected).toFixed(1)}s
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                Trim {selected.trim_in.toFixed(1)}s – {selected.trim_out.toFixed(1)}s
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: '0 6px' }}>
              Select a clip on the timeline to preview it here.
            </div>
          )}
        </div>
      </div>

      {/* ── Media strip — ready bin assets, draggable onto a lane above
          or added via + to the highlighted target lane. Not-yet-ready
          assets (still processing/failed) aren't shown here — they have
          no playable file yet, see VideoProjectAsset.status. ─────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onMouseDown={e => e.stopPropagation()}>
        {readyAssets.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No ready media yet — upload or finish dubbing a clip to add it here.</span>
        )}
        {readyAssets.map(a => {
          const colors = KIND_COLOR[a.kind]
          return (
            <div
              key={a.id}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', a.id)}
              title="Drag onto a lane, or use + to add to the highlighted lane"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 9px', borderRadius: 7,
                border: `1px solid ${colors.border}66`, background: colors.fill, cursor: 'grab', maxWidth: 220,
              }}
            >
              <span style={{ fontSize: 13 }}>{KIND_ICON[a.kind]}</span>
              <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.original_filename ?? a.kind}
              </span>
              <button
                className="ds-icon-btn"
                style={{ width: 18, height: 18, padding: 0, flexShrink: 0 }}
                title={`Add to Lane ${targetLane + 1}`}
                onClick={() => addAssetToLane(a, targetLane)}
              >
                <span style={{ width: 10, height: 10, display: 'flex' }}>{icons.plus}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
