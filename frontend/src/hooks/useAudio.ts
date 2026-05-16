import { useState, useCallback, useRef } from 'react'
import { loadAudioRawBlob, audioBufferToWav } from '../audio'
import type { TimelineClip } from '../types'

interface UseAudioReturn {
  mergedUrl: string | null
  merging: boolean
  mergeError: string | null
  mergeSelected: (orderedClips: TimelineClip[]) => Promise<void>
  resetMerge: () => void
}

export function useAudio(): UseAudioReturn {
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const prevMergedUrl = useRef<string | null>(null)

  const resetMerge = useCallback(() => {
    if (prevMergedUrl.current) {
      URL.revokeObjectURL(prevMergedUrl.current)
      prevMergedUrl.current = null
    }
    setMergedUrl(null)
    setMergeError(null)
  }, [])

  const mergeSelected = useCallback(async (orderedClips: TimelineClip[]): Promise<void> => {
    if (!orderedClips.length) return
    setMerging(true)
    setMergeError(null)

    let ctx: AudioContext | null = null

    try {
      ctx = new AudioContext()

      type Segment = {
        buffer: AudioBuffer
        trimStart: number
        dur: number
        volume: number
        isGap: boolean
      }

      const segments: Segment[] = []

      for (const clip of orderedClips) {
        if (clip.isGap) {
          const silenceBuf = ctx.createBuffer(1, Math.round(clip.dur * 44100), 44100)
          segments.push({ buffer: silenceBuf, trimStart: 0, dur: clip.dur, volume: 1, isGap: true })
          continue
        }

        const raw = await loadAudioRawBlob(`audio_${clip.scriptId}`)
        if (!raw) {
          console.warn(`[useAudio] No audio blob found for script ${clip.scriptId}, skipping`)
          continue
        }

        const arr = await raw.arrayBuffer()
        const buf = await ctx.decodeAudioData(arr)
        segments.push({
          buffer: buf,
          trimStart: clip.trimStart,
          dur: clip.dur,
          volume: clip.volume,
          isGap: false,
        })
      }

      if (!segments.length) throw new Error('No audio clips could be loaded')

      const sr = segments.find(s => !s.isGap)?.buffer.sampleRate ?? 44100
      const totalSamples = segments.reduce((a, seg) => a + Math.round(seg.dur * sr), 0)

      if (totalSamples <= 0) throw new Error('Total audio duration is zero')

      const merged = ctx.createBuffer(1, totalSamples, sr)
      const out = merged.getChannelData(0)
      let offset = 0

      for (const seg of segments) {
        const startSample = Math.round(seg.trimStart * sr)
        const durSamples = Math.round(seg.dur * sr)
        const src = seg.buffer.getChannelData(0)

        for (let i = 0; i < durSamples; i++) {
          const srcIdx = startSample + i
          out[offset + i] = (srcIdx < src.length ? src[srcIdx] : 0) * seg.volume
        }
        offset += durSamples
      }

      const wav = audioBufferToWav(merged)
      const blob = new Blob([wav], { type: 'audio/wav' })

      // Revoke previous URL to avoid memory leak
      if (prevMergedUrl.current) {
        URL.revokeObjectURL(prevMergedUrl.current)
      }

      const url = URL.createObjectURL(blob)
      prevMergedUrl.current = url
      setMergedUrl(url)
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

  return { mergedUrl, merging, mergeError, mergeSelected, resetMerge }
}