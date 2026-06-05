import { useState, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import { toast } from '../toast'
import { loadAudioRawBlob, audioBufferToWav } from '../audio'
import type { TimelineClip, Script } from '../types'

interface BgMusic { blob: Blob; volume: number }

interface LaneMix { solo: Record<number, boolean>; mute: Record<number, boolean> }

interface UseAudioReturn {
  mergedUrl: string | null
  mergedBlob: Blob | null
  merging: boolean
  mergeError: string | null
  mergeSelected: (orderedClips: TimelineClip[], bgMusic?: BgMusic, laneMix?: LaneMix) => Promise<void>
  resetMerge: () => void
  exportZip: (scripts: Script[], projectName: string) => Promise<void>
}

export function useAudio(): UseAudioReturn {
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const prevMergedUrl = useRef<string | null>(null)

  const resetMerge = useCallback(() => {
    if (prevMergedUrl.current) {
      URL.revokeObjectURL(prevMergedUrl.current)
      prevMergedUrl.current = null
    }
    setMergedUrl(null)
    setMergedBlob(null)
    setMergeError(null)
  }, [])

  const mergeSelected = useCallback(async (orderedClips: TimelineClip[], bgMusic?: BgMusic, laneMix?: LaneMix): Promise<void> => {
    if (!orderedClips.length) return
    setMerging(true)
    setMergeError(null)

    // ── Warn about very long projects ─────────────────────────────
    const totalDurationSec = orderedClips.reduce((a, c) => a + c.dur, 0)
    if (totalDurationSec > 15 * 60) {
      toast.info(`Assembling ${Math.round(totalDurationSec / 60)} min of audio — this may take a moment and use significant memory.`)
    }

    // ── Detect overlapping clips on the SAME lane and warn ────────
    // Cross-lane overlap is intentional layering; only same-lane overlap
    // (two clips fighting for the same row) is worth flagging.
    const byLane = new Map<number, typeof orderedClips>()
    for (const c of orderedClips) {
      const lane = c.lane ?? 0
      if (!byLane.has(lane)) byLane.set(lane, [])
      byLane.get(lane)!.push(c)
    }
    outer: for (const laneClips of byLane.values()) {
      const sorted = [...laneClips].sort((a, b) => a.start - b.start)
      let prevEnd = -Infinity
      for (const clip of sorted) {
        if (clip.start < prevEnd - 0.01) {
          toast.info('Some clips overlap on the same lane — they will be layered. Move one to a new lane or nudge it over for a clean sequence.')
          break outer
        }
        prevEnd = clip.start + clip.dur
      }
    }

    let ctx: AudioContext | null = null

    try {
      ctx = new AudioContext()

      // ── Position-based, lane-aware mixing ─────────────────────────
      // Each clip is placed at its absolute `start` on the timeline and
      // mixed (added) into the master buffer. Clips on different lanes that
      // overlap in time are layered together, just like a DAW. Gap clips
      // contribute nothing — silence is implicit from clip positions.

      // Determine which lanes are audible (solo/mute logic)
      const anySolo = laneMix ? Object.values(laneMix.solo).some(Boolean) : false

      type Placed = {
        buffer: AudioBuffer
        start: number
        trimStart: number
        dur: number
        volume: number
        fadeIn: number
        fadeOut: number
      }

      const placed: Placed[] = []

      for (const clip of orderedClips) {
        if (clip.isGap) continue

        // Solo/mute filtering
        if (laneMix) {
          const lane = clip.lane ?? 0
          if (laneMix.mute[lane]) continue
          if (anySolo && !laneMix.solo[lane]) continue
        }

        const raw = await loadAudioRawBlob(`audio_${clip.scriptId}`)
        if (!raw) {
          console.warn(`[useAudio] No audio blob found for script ${clip.scriptId}, skipping`)
          continue
        }

        const arr = await raw.arrayBuffer()
        const buf = await ctx.decodeAudioData(arr)
        placed.push({
          buffer: buf,
          start: clip.start,
          trimStart: clip.trimStart,
          dur: clip.dur,
          volume: clip.volume,
          fadeIn: clip.fadeIn ?? 0,
          fadeOut: clip.fadeOut ?? 0,
        })
      }

      if (!placed.length) throw new Error('No audio clips could be loaded')

      const sr = placed[0].buffer.sampleRate ?? 44100
      // Total length spans from 0 to the latest clip end on any lane.
      const totalDur = Math.max(...orderedClips.map(c => c.start + c.dur), 0)
      const totalSamples = Math.round(totalDur * sr)

      if (totalSamples <= 0) throw new Error('Total audio duration is zero')

      const merged = ctx.createBuffer(1, totalSamples, sr)
      const out = merged.getChannelData(0)

      for (const seg of placed) {
        const destStart  = Math.round(seg.start * sr)
        const srcStart   = Math.round(seg.trimStart * sr)
        const durSamples = Math.round(seg.dur * sr)
        const fadeInSamples  = Math.round(seg.fadeIn * sr)
        const fadeOutSamples = Math.round(seg.fadeOut * sr)
        const src = seg.buffer.getChannelData(0)

        for (let i = 0; i < durSamples; i++) {
          const destIdx = destStart + i
          if (destIdx < 0 || destIdx >= totalSamples) continue
          const srcIdx = srcStart + i
          const sample = srcIdx < src.length ? src[srcIdx] : 0

          // Linear fade envelope
          let env = 1.0
          if (fadeInSamples > 0 && i < fadeInSamples) env = i / fadeInSamples
          if (fadeOutSamples > 0 && i >= durSamples - fadeOutSamples) env = (durSamples - i) / fadeOutSamples

          out[destIdx] = Math.max(-1, Math.min(1, out[destIdx] + sample * seg.volume * env))
        }
      }

      // Mix in background music with crossfade at loop boundaries
      if (bgMusic) {
        try {
          const bgArr = await bgMusic.blob.arrayBuffer()
          const bgBuf = await ctx.decodeAudioData(bgArr)
          const bgSrc = bgBuf.getChannelData(0)
          const bgSr  = bgBuf.sampleRate

          // Pre-apply 100 ms fade-in/out envelope to the bg buffer so loop
          // boundaries don't produce audible clicks when the buffer restarts.
          const loopLen   = bgSrc.length
          const cfSamples = Math.min(Math.round(0.1 * bgSr), Math.floor(loopLen / 4))
          const bgEnv     = new Float32Array(loopLen)
          for (let i = 0; i < loopLen; i++) {
            let env = 1.0
            if (i < cfSamples)              env = i / cfSamples
            else if (i >= loopLen - cfSamples) env = (loopLen - i) / cfSamples
            bgEnv[i] = bgSrc[i] * env
          }

          for (let i = 0; i < totalSamples; i++) {
            const bgIdx = Math.floor(i * (bgSr / sr)) % loopLen
            out[i] = Math.max(-1, Math.min(1, out[i] + bgEnv[bgIdx] * bgMusic.volume))
          }
        } catch (e) {
          console.warn('[useAudio] Background music mixing failed, skipping:', e)
        }
      }

      const wav = audioBufferToWav(merged)
      const blob = new Blob([wav], { type: 'audio/wav' })

      if (prevMergedUrl.current) {
        URL.revokeObjectURL(prevMergedUrl.current)
      }

      const url = URL.createObjectURL(blob)
      prevMergedUrl.current = url
      setMergedUrl(url)
      setMergedBlob(blob)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMergeError(msg)
      console.error('[useAudio] Merge failed:', e)
    } finally {
      if (ctx) {
        ctx.close().catch(() => {})
      }
      setMerging(false)
    }
  }, [])

  const exportZip = useCallback(async (scripts: Script[], projectName: string): Promise<void> => {
    const zip = new JSZip()
    const audioFolder = zip.folder('audio')!
    let added = 0

    for (const script of scripts) {
      if (!script.hasAudio) continue
      const raw = await loadAudioRawBlob(`audio_${script.id}`)
      if (!raw) continue
      const safeName = script.title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || `script_${script.id}`
      audioFolder.file(`${safeName}.wav`, raw)
      added++
    }

    if (added === 0) {
      toast.info('No audio clips to export. Generate audio for your scripts first.')
      return
    }

    const meta = {
      project: projectName,
      exportedAt: new Date().toISOString(),
      scripts: scripts
        .filter(s => s.hasAudio)
        .map(s => ({ id: s.id, title: s.title, duration: s.duration, language: s.language })),
    }
    zip.file('metadata.json', JSON.stringify(meta, null, 2))

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'project'}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return { mergedUrl, mergedBlob, merging, mergeError, mergeSelected, resetMerge, exportZip }
}

export type { LaneMix }
}
