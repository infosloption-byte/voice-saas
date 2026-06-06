import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { toast } from './toast'
import { api } from './api'
import { icons, CLIP_COLORS, CLIP_LIGHTS } from './constants'
import { loadAudioBlob, loadAudioRawBlob, saveAudioBlob, deleteAudioBlob, timelineReducer, uid, fmt } from './audio'
import type { Project, Script, TimelineClip, TimelineHistory } from './types'
import type { GateType } from './hooks/useGuestSession'
import type { LaneMix } from './hooks/useAudio'

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL as string | undefined
const GUTTER_W = 68  // px width of the per-lane controls gutter

interface BgMusic { blob: Blob; volume: number }

export function AssemblyPage({ project, mergedUrl, mergedBlob, merging, onMerge, onReorder, onSaveTimeline, onSaveLaneConfig, isGuest, onGuestGate, isPaidUser, onExportGate }: {
  project: Project
  mergedUrl: string | null
  mergedBlob: Blob | null
  merging: boolean
  onMerge: (orderedClips: TimelineClip[], bgMusic?: BgMusic, laneMix?: LaneMix) => void
  onReorder: (scripts: Script[]) => void
  onSaveTimeline: (clips: TimelineClip[]) => void
  onSaveLaneConfig?: (config: { solo: Record<number, boolean>; mute: Record<number, boolean> }) => void
  isGuest?: boolean
  onGuestGate?: (type: GateType) => void
  isPaidUser?: boolean
  onExportGate?: () => void
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

  // Clips whose referenced script no longer exists or has lost its audio
  const validScriptIds = new Set(withAudio.map(s => s.id))
  const brokenClipIds  = new Set(
    timelineClips
      .filter(c => !c.isGap && !validScriptIds.has(c.scriptId))
      .map(c => c.id)
  )
  const [dragAssetId, setDragAssetId] = useState<string | null>(null)
  const [dragClipId, setDragClipId] = useState<string | null>(null)
  const [dragOffsetSec, setDragOffsetSec] = useState(0)
  const [resizingClip, setResizingClip] = useState<{ id: string; side: 'left' | 'right'; initX: number; initVal: number } | null>(null)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  // Track every object URL we create so they can be revoked on unmount.
  const audioUrlsRef = useRef<string[]>([])
  useEffect(() => () => { audioUrlsRef.current.forEach(u => URL.revokeObjectURL(u)) }, [])
  const [colorCursor, setColorCursor] = useState(0)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [showGapDialog, setShowGapDialog] = useState(false)
  const [gapDuration, setGapDuration] = useState(1)
  const [manualLaneCount, setManualLaneCount] = useState(1)
  const [dropLane, setDropLane] = useState<number | null>(null)
  const [laneSolo, setLaneSolo] = useState<Record<number, boolean>>({})
  const [laneMute, setLaneMute] = useState<Record<number, boolean>>({})

  // Initialize solo/mute from persisted project lane config
  useEffect(() => {
    if (project.laneConfig) {
      setLaneSolo(project.laneConfig.solo ?? {})
      setLaneMute(project.laneConfig.mute ?? {})
    }
  }, [project.id])

  // Mobile lane picker: when user taps a library clip and there are multiple lanes
  const [lanePickTarget, setLanePickTarget] = useState<{ script: Script; col: string; lt: string } | null>(null)

  // Fade drag state: which clip handle is being dragged
  const [fadeDrag, setFadeDrag] = useState<{ id: string; side: 'in' | 'out'; initX: number; initVal: number } | null>(null)

  // Responsive: collapsible library panel
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [libOpen, setLibOpen] = useState(() => window.innerWidth >= 768)
  useEffect(() => {
    const handler = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) setLibOpen(true)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Number of vertical lanes to render: enough to cover every clip's lane,
  // at least one, and never fewer than the user asked for via "Add Lane".
  const laneCount = Math.max(
    1,
    manualLaneCount,
    ...timelineClips.map(c => (c.lane ?? 0) + 1)
  )
  const laneRefs = useRef<Record<number, HTMLDivElement | null>>({})

  function getLaneFromEvent(e: React.MouseEvent | React.DragEvent): number | null {
    for (let i = 0; i < laneCount; i++) {
      const el = laneRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientY >= r.top && e.clientY <= r.bottom) return i
    }
    return null
  }

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

  const saveLaneRef = useRef(onSaveLaneConfig)
  saveLaneRef.current = onSaveLaneConfig

  useEffect(() => {
    const timer = setTimeout(() => {
      saveLaneRef.current?.({ solo: laneSolo, mute: laneMute })
    }, 800)
    return () => clearTimeout(timer)
  }, [laneSolo, laneMute])

  // Load audio URLs from IndexedDB
  useEffect(() => {
    withAudio.forEach(async s => {
      if (!audioUrls[s.id]) {
        const url = await loadAudioBlob(`audio_${s.id}`)
        if (!url) return
        audioUrlsRef.current.push(url)
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
      if ((e.key === 's' || e.key === 'S') && selectedClipId && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        splitSelectedClip()
      }
      if (e.key === 'Escape' && selectedClipId) { e.preventDefault(); setSelectedClipId(null) }
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
    const anySolo = Object.values(laneSolo).some(Boolean)
    timelineClips.filter(c => !c.isGap).forEach(clip => {
      const lane = clip.lane ?? 0
      if (laneMute[lane]) return
      if (anySolo && !laneSolo[lane]) return
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
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft - GUTTER_W
    return Math.max(0, Math.round((x / zoom) * 10) / 10)
  }

  function addToTimeline(script: Script, startSec: number, lane = 0) {
    const ci = colorCursor % CLIP_COLORS.length
    setColorCursor(c => c + 1)
    const rawDur = script.duration ?? Math.max(5, Math.ceil((script.content.trim().split(/\s+/).length || 50) / 2.5))
    // First clip on an empty lane starts at 0; otherwise snap to drop position
    const laneHasClips = timelineClips.some(c => (c.lane ?? 0) === lane)
    const resolvedStart = laneHasClips ? startSec : 0
    setTimelineClips([...timelineClips, {
      id: 'tc_' + uid(),
      scriptId: script.id,
      start: resolvedStart,
      dur: rawDur,
      trimStart: 0,
      trimEnd: 0,
      rawDur,
      title: script.title,
      ci,
      volume: 1,
      isGap: false,
      lane,
    }])
  }

  // ── Per-clip editing actions (Split / Cut / Trim / Duplicate / Lane) ──
  // All actions reference the same underlying source audio via trimStart/
  // trimEnd offsets — the original clip in the library stays intact and
  // reusable, and splits are just two windows onto the same recording.
  function selectedClip(): TimelineClip | undefined {
    return timelineClips.find(c => c.id === selectedClipId)
  }

  // Divide the selected clip at the playhead into two independent clips.
  function splitSelectedClip() {
    const clip = selectedClip()
    if (!clip || clip.isGap) return
    const rel = Math.round((playhead - clip.start) * 10) / 10
    if (rel <= 0.1 || rel >= clip.dur - 0.1) {
      toast.info('Move the playhead inside the clip, then split.')
      return
    }
    const left: TimelineClip  = { ...clip, dur: rel, trimEnd: clip.rawDur - clip.trimStart - rel }
    const right: TimelineClip = {
      ...clip,
      id: 'tc_' + uid(),
      start: clip.start + rel,
      trimStart: clip.trimStart + rel,
      dur: clip.dur - rel,
    }
    setTimelineClips(timelineClips.flatMap(c => c.id === clip.id ? [left, right] : [c]))
    setSelectedClipId(right.id)
  }

  // Cut: split at the playhead and discard the tail (keep the head).
  function cutSelectedClip() {
    const clip = selectedClip()
    if (!clip || clip.isGap) return
    const rel = Math.round((playhead - clip.start) * 10) / 10
    if (rel <= 0.1 || rel >= clip.dur - 0.1) {
      toast.info('Move the playhead inside the clip, then cut.')
      return
    }
    const head: TimelineClip = { ...clip, dur: rel, trimEnd: clip.rawDur - clip.trimStart - rel }
    setTimelineClips(timelineClips.map(c => c.id === clip.id ? head : c))
  }

  // Trim head: set the clip's in-point to the playhead (drop everything before).
  function trimHeadToPlayhead() {
    const clip = selectedClip()
    if (!clip || clip.isGap) return
    const rel = Math.round((playhead - clip.start) * 10) / 10
    if (rel <= 0.1 || rel >= clip.dur - 0.1) {
      toast.info('Move the playhead inside the clip, then trim.')
      return
    }
    setTimelineClips(timelineClips.map(c => c.id === clip.id
      ? { ...c, start: clip.start + rel, trimStart: clip.trimStart + rel, dur: clip.dur - rel }
      : c))
  }

  function duplicateSelectedClip() {
    const clip = selectedClip()
    if (!clip) return
    const copy: TimelineClip = { ...clip, id: 'tc_' + uid(), start: clip.start + clip.dur + 0.1 }
    setTimelineClips([...timelineClips, copy])
    setSelectedClipId(copy.id)
  }

  function moveSelectedClipLane(delta: number) {
    const clip = selectedClip()
    if (!clip) return
    const newLane = Math.max(0, (clip.lane ?? 0) + delta)
    setTimelineClips(timelineClips.map(c => c.id === clip.id ? { ...c, lane: newLane } : c))
    if (newLane + 1 > laneCount) setManualLaneCount(newLane + 1)
  }

  // Remove a specific (empty) lane and shift clips on lower lanes up by one.
  function removeLane(laneIdx: number) {
    if (timelineClips.some(c => (c.lane ?? 0) === laneIdx)) {
      toast.info('Move or delete the clips on this lane before removing it.')
      return
    }
    setTimelineClips(timelineClips.map(c =>
      (c.lane ?? 0) > laneIdx ? { ...c, lane: (c.lane ?? 0) - 1 } : c
    ))
    setManualLaneCount(Math.max(1, laneCount - 1))
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
    const ordered  = [...timelineClips].sort((a, b) => a.start - b.start)
    const broken   = ordered.filter(c => brokenClipIds.has(c.id))
    const valid    = ordered.filter(c => !brokenClipIds.has(c.id))

    if (broken.length > 0) {
      toast.info(`${broken.length} clip${broken.length > 1 ? 's' : ''} skipped — audio missing: ${broken.map(c => c.title).join(', ')}. Regenerate those scripts first.`)
    }
    if (!valid.some(c => !c.isGap)) {
      toast.err('No clips with audio to assemble.')
      return
    }

    const bg = bgMusicBlob ? { blob: bgMusicBlob, volume: bgMusicVolume } : undefined
    onMerge(valid, bg, { solo: laneSolo, mute: laneMute })
  }

  async function handleExportMp3() {
    if (!mergedBlob || !ENGINE_URL) return
    setExportingMp3(true)
    try {
      const fd = new FormData()
      fd.append('file', mergedBlob, 'audio.wav')
      const blob = await api.enginePost('/export/mp3', fd) as Blob
      if (!(blob instanceof Blob)) throw new Error('Unexpected response from engine')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'final.mp3'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.err('MP3 export failed: ' + (e instanceof Error ? e.message : String(e)))
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
  function onTimelineDrop(e: React.DragEvent, lane = 0) {
    e.preventDefault(); setDropLane(null)
    if (!dragAssetId) return
    const script = project.scripts.find(s => s.id === dragAssetId)
    if (!script) return
    addToTimeline(script, getSecFromEvent(e), lane)
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

  // Snap threshold in screen pixels; convert to seconds at current zoom
  const SNAP_PX = 8

  function snapToGrid(rawStart: number, excludeId: string): number {
    const threshold = SNAP_PX / zoom
    const candidates = [
      0,
      playhead,
      ...timelineClips
        .filter(c => c.id !== excludeId)
        .flatMap(c => [c.start, c.start + c.dur]),
    ]
    let best = rawStart
    let bestDist = threshold
    for (const s of candidates) {
      const d = Math.abs(rawStart - s)
      if (d < bestDist) { bestDist = d; best = s }
    }
    return best
  }

  function onTimelineMouseMove(e: React.MouseEvent) {
    if (dragClipId) {
      const raw = Math.max(0, getSecFromEvent(e) - dragOffsetSec)
      const snapped = snapToGrid(raw, dragClipId)
      const newStart = Math.round(snapped * 10) / 10
      const hoverLane = getLaneFromEvent(e)
      setTimelineClips(timelineClips.map(c => c.id === dragClipId
        ? { ...c, start: newStart, lane: hoverLane !== null ? hoverLane : (c.lane ?? 0) }
        : c))
    }
    if (fadeDrag) {
      const dx = e.clientX - fadeDrag.initX
      const dSec = dx / zoom
      setTimelineClips(timelineClips.map(c => {
        if (c.id !== fadeDrag.id) return c
        if (fadeDrag.side === 'in') {
          const val = Math.max(0, Math.min(c.dur * 0.9, fadeDrag.initVal + dSec))
          return { ...c, fadeIn: Math.round(val * 100) / 100 }
        } else {
          const val = Math.max(0, Math.min(c.dur * 0.9, fadeDrag.initVal - dSec))
          return { ...c, fadeOut: Math.round(val * 100) / 100 }
        }
      }))
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
    setFadeDrag(null)
  }

  // ── Single clip renderer (used inside every lane row) ─────────────
  const actBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px',
    borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--surface)',
    color: 'var(--text-1)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
  }

  function renderClip(clip: TimelineClip) {
    const isGap    = clip.isGap
    const isBroken = brokenClipIds.has(clip.id)
    const col = isBroken ? '#c0392b' : isGap ? 'var(--text-3)' : CLIP_COLORS[clip.ci % CLIP_COLORS.length]
    const lt  = isBroken ? 'rgba(192,57,43,0.10)' : isGap ? 'var(--bg-3)' : CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
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
        style={{ position: 'absolute', left: GUTTER_W + clip.start * zoom, top: 4, height: 72, width: clipW, borderRadius: 7, background: lt, border: `1.5px solid ${isSelected ? col : col + '66'}`, cursor: isActive ? 'grabbing' : 'grab', overflow: 'visible', zIndex: isActive || isSelected ? 100 : 10, boxShadow: isSelected ? `0 0 0 2px ${col}44` : isActive ? '0 6px 18px rgba(30,22,10,0.14)' : 'none', transition: isActive ? 'none' : 'box-shadow 0.12s' }}>

        {/* Clip inner — clipped */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: 7, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 22, background: col + '22', borderBottom: `1px solid ${col}33`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: isGap ? 'var(--text-3)' : col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {isBroken ? '⚠ ' : isGap ? '⏸ ' : ''}{clip.title}
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

        {/* Fade-in handle (triangle at left, above waveform area) */}
        {!isGap && (
          <div
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setFadeDrag({ id: clip.id, side: 'in', initX: e.clientX, initVal: clip.fadeIn ?? 0 }) }}
            title={`Fade in: ${(clip.fadeIn ?? 0).toFixed(2)}s — drag right`}
            style={{ position: 'absolute', left: Math.max(0, (clip.fadeIn ?? 0) * zoom - 6), bottom: 4, width: 12, height: 12, cursor: 'ew-resize', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="0,10 10,10 10,0" fill={col + 'cc'} />
            </svg>
          </div>
        )}
        {/* Fade-out handle (triangle at right) */}
        {!isGap && (
          <div
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setFadeDrag({ id: clip.id, side: 'out', initX: e.clientX, initVal: clip.fadeOut ?? 0 }) }}
            title={`Fade out: ${(clip.fadeOut ?? 0).toFixed(2)}s — drag left`}
            style={{ position: 'absolute', right: Math.max(0, (clip.fadeOut ?? 0) * zoom - 6), bottom: 4, width: 12, height: 12, cursor: 'ew-resize', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="10,10 0,10 0,0" fill={col + 'cc'} />
            </svg>
          </div>
        )}

        {/* Fade overlay — visual ramp drawn over waveform */}
        {!isGap && (clip.fadeIn ?? 0) > 0 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: (clip.fadeIn ?? 0) * zoom, height: '100%', background: `linear-gradient(to right, ${lt}, transparent)`, pointerEvents: 'none', borderRadius: '7px 0 0 7px', zIndex: 5 }} />
        )}
        {!isGap && (clip.fadeOut ?? 0) > 0 && (
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: (clip.fadeOut ?? 0) * zoom, height: '100%', background: `linear-gradient(to left, ${lt}, transparent)`, pointerEvents: 'none', borderRadius: '0 7px 7px 0', zIndex: 5 }} />
        )}

        {/* Trim start indicator */}
        {!isGap && clip.trimStart > 0 && (
          <div style={{ position: 'absolute', left: 6, top: 24, fontSize: 9, color: col, fontFamily: 'var(--mono)' }}>↠{fmt(Math.floor(clip.trimStart))}</div>
        )}
      </div>
    )
  }

  // Ruler ticks
  const tickInterval = zoom >= 120 ? 2 : zoom >= 70 ? 5 : zoom >= 40 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= totalDur + tickInterval; t += tickInterval) ticks.push(t)
  const timelineWidth = Math.max(totalDur * zoom + 200, 800) + GUTTER_W

  const S = {
    shell:         { display: 'flex', flexDirection: 'column' as const, height: 'calc(100svh - var(--topbar-h) - var(--tabs-h))', background: 'var(--bg)' } as React.CSSProperties,
    transport:     { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap' as const, overflowX: 'auto' as const } as React.CSSProperties,
    sep:           { width: 1, height: 20, background: 'var(--border-2)', margin: '0 2px', flexShrink: 0 } as React.CSSProperties,
    body:          { display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' as const } as React.CSSProperties,
    libPanel:      { width: isMobile ? '100%' : 210, maxWidth: isMobile ? '100%' : 210, flexShrink: 0, background: 'var(--bg-2)', borderRight: '1px solid var(--border)', display: libOpen ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', position: isMobile ? 'absolute' as const : 'relative' as const, top: isMobile ? 0 : undefined, left: isMobile ? 0 : undefined, bottom: isMobile ? 0 : undefined, zIndex: isMobile ? 200 : undefined } as React.CSSProperties,
    libHeader:     { padding: '9px 12px 5px', color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.7px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
    libList:       { flex: 1, minHeight: 0, overflowY: 'auto' as const, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 } as React.CSSProperties,
    timelineArea:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minWidth: 0 } as React.CSSProperties,
    timelineScroll:{ flex: 1, overflowX: 'auto' as const, overflowY: 'auto' as const, cursor: dragClipId || resizingClip ? 'grabbing' : draggingPlayhead ? 'ew-resize' : 'default', userSelect: 'none' as const, WebkitOverflowScrolling: 'touch' as const } as React.CSSProperties,
    ruler:         { height: 30, background: 'var(--bg-3)', borderBottom: '1px solid var(--border-2)', position: 'sticky' as const, top: 0, zIndex: 10, overflow: 'hidden' } as React.CSSProperties,
    track:         { height: 80, background: 'var(--bg-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '14px 0 4px', position: 'relative' as const, overflow: 'visible' } as React.CSSProperties,
    musicTrack:    { height: 40, background: 'var(--bg-3)', borderBottom: '1px solid var(--border)', position: 'relative' as const } as React.CSSProperties,
    footer:        { padding: '7px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-2)', flexShrink: 0, flexWrap: 'wrap' as const, overflowX: 'auto' as const } as React.CSSProperties,
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

        {/* Library toggle — always visible, essential on mobile */}
        <button style={tBtn(libOpen
          ? { background: 'var(--accent)', color: '#fff', border: 'none' }
          : { background: 'var(--bg-3)' })}
          onClick={() => setLibOpen(o => !o)} title="Toggle clip library">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.speaker}</span>
          <span style={{ fontSize: 11 }}>Library</span>
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
          isPaidUser ? (
            <a href={mergedUrl} download="final.wav" style={tBtn()}>
              <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.download}</span>
              <span style={{ fontSize: 11 }}>WAV</span>
            </a>
          ) : (
            <button onClick={onExportGate ?? (() => onGuestGate?.('assembly_export'))} style={tBtn()}>
              <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.download}</span>
              <span style={{ fontSize: 11 }}>WAV</span>
            </button>
          )
        )}
        {mergedBlob && ENGINE_URL && (
          <button
            onClick={isPaidUser ? handleExportMp3 : (onExportGate ?? (() => onGuestGate?.('assembly_export')))}
            disabled={isPaidUser && exportingMp3}
            style={tBtn({ opacity: (isPaidUser && exportingMp3) ? 0.6 : 1 })}
            title="Export as MP3"
          >
            {(isPaidUser && exportingMp3) ? <span className="spinner" /> : <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.mp3}</span>}
            <span style={{ fontSize: 11 }}>MP3</span>
          </button>
        )}
        <button
          onClick={isPaidUser ? handleMerge : (onExportGate ?? (() => onGuestGate?.('assembly_export')))}
          disabled={isPaidUser && (timelineClips.length < 1 || merging)}
          style={tBtn({
            background: mergedUrl ? 'var(--ok)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            padding: '7px 18px',
            gap: 7,
            fontWeight: 600,
            fontSize: 13,
            borderRadius: 8,
            boxShadow: mergedUrl ? 'none' : '0 2px 8px rgba(var(--accent-rgb, 166,77,55),0.25)',
            opacity: (isPaidUser && (timelineClips.length < 1 || merging)) ? 0.5 : 1,
          })}
        >
          {(isPaidUser && merging)
            ? <><span className="spinner" /> Merging…</>
            : mergedUrl
              ? <><span style={{ display: 'flex', width: 14, height: 14 }}>{icons.check}</span> Re-export</>
              : <><span style={{ display: 'flex', width: 16, height: 16 }}>{icons.merge}</span> Export WAV</>
          }
        </button>
      </div>

      {/* Lane picker modal — shown on mobile when tapping a library clip with multiple lanes */}
      {lanePickTarget && (
        <>
          <div onClick={() => setLanePickTarget(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 299 }} />
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 300, width: 'min(340px, calc(100vw - 32px))', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-3)', marginBottom: 4 }}>Add to Lane</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: lanePickTarget.lt, border: `1px solid ${lanePickTarget.col}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 14 }}>
                    {(lanePickTarget.script.waveformPeaks ?? [0.4,0.7,0.5,0.9,0.6]).slice(0,5).map((p, j) => (
                      <div key={j} style={{ width: 2, borderRadius: 1, height: Math.max(2, Math.round(p * 12)) + 'px', background: lanePickTarget.col }} />
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lanePickTarget.script.title}</span>
              </div>
            </div>
            <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: laneCount }, (_, lane) => {
                const clipsInLane = timelineClips.filter(c => (c.lane ?? 0) === lane)
                const laneEnd = Math.max(0, ...clipsInLane.map(c => c.start + c.dur))
                return (
                  <button key={lane} onClick={() => {
                    addToTimeline(lanePickTarget.script, laneEnd, lane)
                    setLanePickTarget(null)
                  }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', cursor: 'pointer', textAlign: 'left', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>Lane {lane + 1}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      {clipsInLane.length === 0 ? 'empty' : `${clipsInLane.length} clip${clipsInLane.length !== 1 ? 's' : ''} · ends ${fmt(laneEnd)}`}
                    </span>
                  </button>
                )
              })}
            </div>
            <div style={{ padding: '0 12px 12px' }}>
              <button onClick={() => setLanePickTarget(null)} style={{ width: '100%', padding: '9px', border: '1px solid var(--border-2)', borderRadius: 8, background: 'transparent', cursor: 'pointer', color: 'var(--text-2)', fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* Main body */}
      <div style={S.body}>
        {/* Mobile overlay backdrop */}
        {isMobile && libOpen && (
          <div onClick={() => setLibOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199 }} />
        )}

        {/* Asset library */}
        <div style={S.libPanel}>
          <div style={S.libHeader}>
            <span>Clip Library</span>
            {isMobile && (
              <button onClick={() => setLibOpen(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
            )}
          </div>
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
              const addAtLaneEnd = () => {
                if (isMobile && laneCount > 1) {
                  // Show lane picker so user can choose which lane
                  setLanePickTarget({ script: s, col, lt })
                  setLibOpen(false)
                  return
                }
                const lane = 0
                const laneEnd = Math.max(0, ...timelineClips
                  .filter(c => (c.lane ?? 0) === lane)
                  .map(c => c.start + c.dur))
                addToTimeline(s, laneEnd, lane)
                if (isMobile) setLibOpen(false)
              }
              return (
                <div key={s.id}
                  draggable={!isMobile}
                  onDragStart={() => setDragAssetId(s.id)} onDragEnd={() => setDragAssetId(null)}
                  onClick={isMobile ? addAtLaneEnd : undefined}
                  title={isMobile ? 'Tap to add to timeline' : 'Drag onto the timeline'}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: dragAssetId === s.id ? lt : 'var(--surface)', cursor: isMobile ? 'pointer' : 'grab', transition: 'background 0.1s', opacity: dragAssetId === s.id ? 0.5 : 1 }}>
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
                  {isMobile ? (
                    <span aria-label="Add to timeline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, flexShrink: 0, background: 'var(--accent)', color: '#fff', fontSize: 18, lineHeight: 1, fontWeight: 600 }}>+</span>
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: 13, flexShrink: 0, cursor: 'grab' }}>{icons.drag}</span>
                  )}
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
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{isMobile ? 'Tap a clip to add it to the timeline. Drag edges to trim.' : 'Drag clips onto the timeline. Drag edges to trim. Space to play.'}</p>
            </div>
          )}
        </div>

        {/* Broken clip warning banner */}
        {brokenClipIds.size > 0 && (
          <div style={{ margin: '0 12px 6px', padding: '7px 12px', background: 'rgba(192,57,43,0.10)', border: '1px solid rgba(192,57,43,0.35)', borderRadius: 6, fontSize: 12, color: '#c0392b', display: 'flex', alignItems: 'center', gap: 6 }}>
            ⚠ {brokenClipIds.size} clip{brokenClipIds.size > 1 ? 's' : ''} {brokenClipIds.size > 1 ? 'have' : 'has'} missing audio (shown in red). Regenerate the script{brokenClipIds.size > 1 ? 's' : ''} or remove the clip{brokenClipIds.size > 1 ? 's' : ''} before assembling.
          </div>
        )}

        {/* Timeline */}
        <div style={S.timelineArea}>
          {/* Contextual action bar for the selected clip (always visible,
              never clipped by lane edges or the lane scroller) */}
          {(() => {
            const sel = timelineClips.find(c => c.id === selectedClipId)
            if (!sel) return null
            const selCol = sel.isGap ? 'var(--text-3)' : CLIP_COLORS[sel.ci % CLIP_COLORS.length]
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', flexShrink: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' as const }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: selCol, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sel.isGap ? '⏸ ' : ''}{sel.title}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>L{(sel.lane ?? 0) + 1} · {fmt(Math.floor(sel.dur))}</span>
                <div style={S.sep} />
                {!sel.isGap && (
                  <>
                    <button style={actBtn} onClick={splitSelectedClip} title="Split at playhead (S)">✂ Split</button>
                    <button style={actBtn} onClick={cutSelectedClip} title="Cut — keep head, drop tail after playhead">⤿ Cut</button>
                    <button style={actBtn} onClick={trimHeadToPlayhead} title="Trim — drop head before playhead">⤾ Trim</button>
                    <button style={actBtn} onClick={duplicateSelectedClip} title="Duplicate clip">⎘ Dup</button>
                    <div style={S.sep} />
                  </>
                )}
                <button style={actBtn} onClick={() => moveSelectedClipLane(-1)} disabled={(sel.lane ?? 0) === 0} title="Move up a lane">▲ Lane</button>
                <button style={actBtn} onClick={() => moveSelectedClipLane(1)} title="Move down a lane">▼ Lane</button>
                {!sel.isGap && (
                  <>
                    <div style={S.sep} />
                    <span style={{ display: 'flex', width: 12, height: 12, color: 'var(--text-2)' }}>{icons.volume}</span>
                    <input type="range" min="0" max="2" step="0.05" value={sel.volume}
                      onChange={e => setTimelineClips(timelineClips.map(c => c.id === sel.id ? { ...c, volume: parseFloat(e.target.value) } : c))}
                      style={{ width: 100, accentColor: selCol }} />
                    <span style={{ fontSize: 11, color: selCol, fontFamily: 'var(--mono)', width: 32 }}>{Math.round(sel.volume * 100)}%</span>
                    <div style={S.sep} />
                    <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>FadeIn</span>
                    <input type="range" min="0" max={Math.min(sel.dur * 0.9, 5)} step="0.05" value={sel.fadeIn ?? 0}
                      onChange={e => setTimelineClips(timelineClips.map(c => c.id === sel.id ? { ...c, fadeIn: parseFloat(e.target.value) } : c))}
                      style={{ width: 80, accentColor: selCol }} />
                    <span style={{ fontSize: 11, color: selCol, fontFamily: 'var(--mono)', width: 32 }}>{(sel.fadeIn ?? 0).toFixed(1)}s</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>Out</span>
                    <input type="range" min="0" max={Math.min(sel.dur * 0.9, 5)} step="0.05" value={sel.fadeOut ?? 0}
                      onChange={e => setTimelineClips(timelineClips.map(c => c.id === sel.id ? { ...c, fadeOut: parseFloat(e.target.value) } : c))}
                      style={{ width: 80, accentColor: selCol }} />
                    <span style={{ fontSize: 11, color: selCol, fontFamily: 'var(--mono)', width: 32 }}>{(sel.fadeOut ?? 0).toFixed(1)}s</span>
                  </>
                )}
                <div style={{ flex: 1 }} />
                <button style={actBtn} onClick={() => removeClip(sel.id)} title="Delete clip">🗑 Delete</button>
              </div>
            )
          })()}

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
                {/* Gutter spacer in ruler */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: GUTTER_W, background: 'var(--bg-3)', borderRight: '1px solid var(--border-2)', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>LANE</span>
                </div>
                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: GUTTER_W + t * zoom, top: 0, bottom: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', paddingLeft: 3, paddingTop: 3, display: 'block', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{fmt(t)}</span>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 8, background: 'var(--border-2)' }} />
                  </div>
                ))}
                {ticks.slice(0, -1).flatMap(t => [0.25, 0.5, 0.75].map(frac => (
                  <div key={`m${t}_${frac}`} style={{ position: 'absolute', left: GUTTER_W + t * zoom + frac * zoom * tickInterval, bottom: 0, width: 1, height: frac === 0.5 ? 7 : 4, background: 'var(--border)' }} />
                )))}
                {/* Playhead on ruler */}
                <div data-playhead="true" style={{ position: 'absolute', left: GUTTER_W + playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 20 }}>
                  <div data-playhead="true"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDraggingPlayhead(true); if (playing) stopPlayback() }}
                    style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 14, height: 18, background: 'var(--accent)', borderRadius: '3px 3px 2px 2px', cursor: draggingPlayhead ? 'grabbing' : 'ew-resize', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 2, boxShadow: '0 2px 6px rgba(201,100,66,0.4)' }}>
                    <svg width="6" height="5" viewBox="0 0 6 5"><polygon points="0,0 6,0 3,5" fill="rgba(255,255,255,0.7)" /></svg>
                  </div>
                </div>
              </div>

              {/* Track label */}
              <div style={{ padding: '4px 10px 0', paddingLeft: GUTTER_W + 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Track 1 · Voiceover{laneCount > 1 ? ` · ${laneCount} lanes` : ''}
                </span>
                <button
                  onClick={() => setManualLaneCount(laneCount + 1)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer' }}
                  title="Add a new vertical lane">+ Lane</button>
              </div>

              {/* Voice track lanes (vertical rows, all part of Track 1) */}
              {Array.from({ length: laneCount }).map((_, lane) => {
                const laneClips = timelineClips.filter(c => (c.lane ?? 0) === lane)
                const isDropTarget = dropLane === lane
                return (
                  <div key={lane}
                    ref={el => { laneRefs.current[lane] = el }}
                    style={{ ...S.track, marginTop: lane === 0 ? 4 : 2, outline: isDropTarget ? '2px dashed var(--accent)' : 'none', outlineOffset: -3, opacity: laneMute[lane] ? 0.35 : (Object.values(laneSolo).some(Boolean) && !laneSolo[lane]) ? 0.35 : 1 }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropLane(lane) }}
                    onDragLeave={() => { setDropLane(null) }}
                    onDrop={e => onTimelineDrop(e, lane)}
                    onClick={e => {
                      if (!dragClipId && !resizingClip) {
                        setSelectedClipId(null)
                        const pos = getSecFromEvent(e)
                        setPlayhead(pos)
                        if (playing) startPlayback(pos)
                      }
                    }}>
                    {ticks.map(t => (
                      <div key={t} style={{ position: 'absolute', left: GUTTER_W + t * zoom, top: 0, bottom: 0, width: 1, background: 'var(--border-3)' }} />
                    ))}

                    {/* Lane gutter — sticky at left:0 so it stays visible while scrolling horizontally */}
                    <div
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                      style={{ position: 'sticky', left: 0, top: 0, width: GUTTER_W, height: '100%', zIndex: 50, background: 'var(--bg-3)', borderRight: '2px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 0 }}>
                      {/* Lane label */}
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-3)', fontFamily: 'var(--mono)', letterSpacing: '0.5px' }}>L{lane + 1}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {/* Solo button */}
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); setLaneSolo(prev => ({ ...prev, [lane]: !prev[lane] })) }}
                          title={`Solo lane ${lane + 1} — only this lane plays`}
                          style={{ minWidth: 24, height: 24, borderRadius: 4, border: `1.5px solid ${laneSolo[lane] ? '#f5a623' : 'var(--border-2)'}`, background: laneSolo[lane] ? '#f5a623' : 'var(--surface)', color: laneSolo[lane] ? '#fff' : 'var(--text-2)', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: laneSolo[lane] ? '0 0 6px rgba(245,166,35,0.5)' : 'none' }}>S</button>
                        {/* Mute button */}
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); setLaneMute(prev => ({ ...prev, [lane]: !prev[lane] })) }}
                          title={`Mute lane ${lane + 1} — exclude from playback and export`}
                          style={{ minWidth: 24, height: 24, borderRadius: 4, border: `1.5px solid ${laneMute[lane] ? '#e74c3c' : 'var(--border-2)'}`, background: laneMute[lane] ? '#e74c3c' : 'var(--surface)', color: laneMute[lane] ? '#fff' : 'var(--text-2)', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: laneMute[lane] ? '0 0 6px rgba(231,76,60,0.5)' : 'none' }}>M</button>
                      </div>
                      {/* Remove lane button — always shown; warns if lane has clips */}
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); removeLane(lane) }}
                        title={laneClips.length === 0 ? 'Remove this lane' : 'Move or delete clips first'}
                        style={{ minWidth: 24, height: 20, borderRadius: 4, border: '1px solid var(--border-2)', background: laneClips.length === 0 ? 'var(--surface)' : 'transparent', color: laneClips.length === 0 ? 'var(--text-2)' : 'var(--border-2)', fontSize: 13, fontWeight: 400, cursor: laneClips.length === 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: laneClips.length === 0 ? 1 : 0.3, transition: 'opacity 0.15s' }}>×</button>
                    </div>

                    {timelineClips.length === 0 && lane === 0 && (
                      <div style={{ position: 'absolute', left: GUTTER_W, right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-3)', pointerEvents: 'none', letterSpacing: '0.2px' }}>
                        {isDropTarget ? '✦ Drop to place clip' : 'Drag clips from the library onto this track'}
                      </div>
                    )}

                    {/* Clips on this lane */}
                    {laneClips.map(renderClip)}

                    {/* Playhead in lane */}
                    <div style={{ position: 'absolute', left: GUTTER_W + playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 49, pointerEvents: 'none', opacity: 0.7 }} />
                  </div>
                )
              })}

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
                    <div style={{ position: 'absolute', left: GUTTER_W + playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 50, pointerEvents: 'none', opacity: 0.7 }} />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={S.footer}>
            {timelineClips.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{isMobile ? 'No clips yet — tap a clip in the library to add it.' : 'No clips on timeline yet — drag from the library.'}</span>
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
