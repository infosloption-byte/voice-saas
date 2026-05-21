import { useState, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import { loadAudioRawBlob, audioBufferToWav } from '../audio'
import type { TimelineClip, Script } from '../types'

interface BgMusic { blob: Blob; volume: number }

interface UseAudioReturn {
  mergedUrl: string | null
  mergedBlob: Blob | null
  merging: boolean
  mergeError: string | null
  mergeSelected: (orderedClips: TimelineClip[], bgMusic?: BgMusic) => Promise<void>
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

  const mergeSelected = useCallback(async (orderedClips: TimelineClip[], bgMusic?: BgMusic): Promise<void> => {
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

      // Mix in background music
      if (bgMusic) {
        try {
          const bgArr = await bgMusic.blob.arrayBuffer()
          const bgBuf = await ctx.decodeAudioData(bgArr)
          const bgSrc = bgBuf.getChannelData(0)
          const bgSr = bgBuf.sampleRate

          for (let i = 0; i < totalSamples; i++) {
            const bgIdx = Math.floor(i * (bgSr / sr)) % bgSrc.length
            out[i] = Math.max(-1, Math.min(1, out[i] + bgSrc[bgIdx] * bgMusic.volume))
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
      alert('No audio clips to export. Generate audio for your scripts first.')
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
