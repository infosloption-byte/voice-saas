import { useState, useRef, useCallback } from 'react'
import type { TimelineHistory, TimelineAction, TimelineClip, HistoryState } from './types'

// ── IndexedDB audio persistence ────────────────────────────────────
const DB_NAME = 'voicestudio', DB_VER = 1, STORE = 'audio'

export function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

export async function saveAudioBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function loadAudioBlob(key: string): Promise<string | null> {
  const db = await openDB()
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => {
      if (req.result) res(URL.createObjectURL(req.result))
      else res(null)
    }
    req.onerror = () => res(null)
  })
}

export async function loadAudioRawBlob(key: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror = () => res(null)
  })
}

export async function deleteAudioBlob(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res()
  })
}

export async function clearAllAudio(): Promise<void> {
  const db = await openDB()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => res()
  })
}

// ── Small utilities ────────────────────────────────────────────────
export function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export function uid() { return Math.random().toString(36).slice(2, 10) }

// ── Waveform peak computation ──────────────────────────────────────
export async function computeWaveformPeaks(blob: Blob, numBars = 60): Promise<number[]> {
  try {
    const ctx = new AudioContext()
    const arr = await blob.arrayBuffer()
    const buf = await ctx.decodeAudioData(arr)
    await ctx.close()
    const data = buf.getChannelData(0)
    const blockSize = Math.floor(data.length / numBars)
    const peaks: number[] = []
    for (let i = 0; i < numBars; i++) {
      let max = 0
      for (let j = 0; j < blockSize; j++) {
        const val = Math.abs(data[i * blockSize + j])
        if (val > max) max = val
      }
      peaks.push(max)
    }
    const maxPeak = Math.max(...peaks, 0.001)
    return peaks.map(p => p / maxPeak)
  } catch {
    return Array.from({ length: numBars }, (_, i) => 0.2 + Math.abs(Math.sin(i * 0.7)) * 0.5)
  }
}

// ── WAV encoder ────────────────────────────────────────────────────
export function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
  const data = buf.getChannelData(0), sr = buf.sampleRate
  const ab = new ArrayBuffer(44 + data.length * 2), v = new DataView(ab)
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true)
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return ab
}

// ── Timeline history reducer ───────────────────────────────────────
export function timelineReducer(state: TimelineHistory, action: TimelineAction): TimelineHistory {
  switch (action.type) {
    case 'SET':
      if (JSON.stringify(action.clips) === JSON.stringify(state.present)) return state
      return { past: [...state.past, state.present].slice(-30), present: action.clips, future: [] }
    case 'UNDO':
      if (!state.past.length) return state
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    case 'REDO':
      if (!state.future.length) return state
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    default: return state
  }
}

// ── Script text history reducer ────────────────────────────────────
export function historyReducer(
  state: HistoryState,
  action: { type: 'SET' | 'UNDO' | 'REDO'; value?: string }
): HistoryState {
  switch (action.type) {
    case 'SET':
      if (action.value === state.present) return state
      return { past: [...state.past, state.present].slice(-50), present: action.value!, future: [] }
    case 'UNDO':
      if (!state.past.length) return state
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    case 'REDO':
      if (!state.future.length) return state
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    default: return state
  }
}

// ── Audio Recorder hook ────────────────────────────────────────────
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  const start = useCallback(async (noiseSuppression = true, noiseGain = 0.85) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression, echoCancellation: true, autoGainControl: true, sampleRate: 44100, channelCount: 1 }
    })
    const ctx = new AudioContext(); ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const dest = ctx.createMediaStreamDestination()
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 80
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 12
    comp.attack.value = 0.003; comp.release.value = 0.25
    const gain = ctx.createGain(); gain.gain.value = noiseGain
    source.connect(hpf).connect(comp).connect(gain).connect(dest)
    streamRef.current = stream
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    recRef.current = new MediaRecorder(dest.stream, { mimeType })
    chunksRef.current = []
    recRef.current.ondataavailable = e => chunksRef.current.push(e.data)
    recRef.current.start(100)
    setRecording(true); setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }, [])

  const stop = useCallback((): Promise<Blob | null> => new Promise(resolve => {
    if (!recRef.current) return resolve(null)
    recRef.current.onstop = () => {
      const mimeType = recRef.current?.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: mimeType })
      resolve(blob.size > 0 ? blob : null)
      streamRef.current?.getTracks().forEach(t => t.stop())
      ctxRef.current?.close()
    }
    recRef.current.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
  }), [])

  return { recording, seconds, start, stop }
}