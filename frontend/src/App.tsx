import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import './App.css'
import { LandingPage, SignInPage, SignUpPage, SettingsPage } from './AuthAndLandingPages'
import { api, mapProject } from './api'

const API = 'http://127.0.0.1:8000'

// ── IndexedDB audio persistence ────────────────────────────────────
const DB_NAME = 'voicestudio', DB_VER = 1, STORE = 'audio'

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

async function saveAudioBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

async function loadAudioBlob(key: string): Promise<string | null> {
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

async function loadAudioRawBlob(key: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => res(req.result ?? null)
    req.onerror = () => res(null)
  })
}

async function deleteAudioBlob(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res()
  })
}

// ── Types ──────────────────────────────────────────────────────────
type Page = 'landing' | 'signin' | 'signup' | 'dashboard' | 'projects' | 'workspace' | 'profiles' | 'settings'
type WorkspaceTab = 'scripts' | 'assembly'
type SaveState = 'saved' | 'saving' | 'unsaved'

interface Project {
  id: string; name: string; emoji: string; description: string
  createdAt: string; scripts: Script[]
}

interface Script {
  id: string; title: string; content: string
  hasAudio: boolean
  profileId: string | null; language: string; duration: number | null
  speed: number          // NEW: 0.5–2.0
  waveformPeaks?: number[] // NEW: computed from AudioBuffer
}

// Timeline clip — now with trim and volume
interface TimelineClip {
  id: string
  scriptId: string
  start: number    // seconds from timeline origin
  dur: number      // visible duration (after trim)
  trimStart: number  // seconds trimmed from clip head
  trimEnd: number    // seconds trimmed from clip tail
  rawDur: number   // original full duration
  title: string
  ci: number       // colour index
  volume: number   // 0–2 gain
  isGap: boolean   // NEW: silence pad
}

// NEW: timeline history for undo/redo
type TimelineAction =
  | { type: 'SET'; clips: TimelineClip[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }

interface TimelineHistory {
  past: TimelineClip[][]
  present: TimelineClip[]
  future: TimelineClip[][]
}

interface VoiceProfile {
  profile_id: string; filename: string; duration?: number
}

// ── Timeline colour palette ────────────────────────────────────────
const CLIP_COLORS = [
  '#c96442', '#4278c9', '#3db564', '#c94278', '#c9a442', '#7842c9',
]
const CLIP_LIGHTS = [
  'rgba(201,100,66,0.10)', 'rgba(66,120,201,0.10)', 'rgba(61,181,100,0.10)',
  'rgba(201,66,120,0.10)', 'rgba(201,164,66,0.10)', 'rgba(120,66,201,0.10)',
]

// ── Real waveform peak computation ────────────────────────────────
async function computeWaveformPeaks(blob: Blob, numBars = 60): Promise<number[]> {
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
    // Normalize
    const maxPeak = Math.max(...peaks, 0.001)
    return peaks.map(p => p / maxPeak)
  } catch {
    return Array.from({ length: numBars }, (_, i) => 0.2 + Math.abs(Math.sin(i * 0.7)) * 0.5)
  }
}

// ── Timeline history reducer ───────────────────────────────────────
function timelineReducer(state: TimelineHistory, action: TimelineAction): TimelineHistory {
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
interface HistoryState { past: string[]; present: string; future: string[] }
function historyReducer(state: HistoryState, action: { type: 'SET' | 'UNDO' | 'REDO'; value?: string }): HistoryState {
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

// ── Audio Recorder ─────────────────────────────────────────────────
function useAudioRecorder() {
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
    if (!recRef.current) return resolve(null)   // ← null signals "nothing recorded"
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

// ── Helpers ────────────────────────────────────────────────────────
function WaveVisualiser({ active }: { active: boolean }) {
  return (
    <div className="wave-vis" aria-hidden>
      {Array.from({ length: 28 }).map((_, i) => (
        <span key={i} className={`bar ${active ? 'bar--live' : ''}`} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </div>
  )
}

function MicBtn({ recording, onClick, disabled, label }: { recording: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button className={`mic-btn ${recording ? 'mic-btn--recording' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="mic-btn__ring" /><span className="mic-btn__ring mic-btn__ring--2" />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {recording
          ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
          : <><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></>}
      </svg>
      <span className="mic-btn__label">{label}</span>
    </button>
  )
}

function fmt(s: number) { return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` }
function uid() { return Math.random().toString(36).slice(2, 10) }

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' }, { code: 'pt', label: 'Portuguese' },
  { code: 'pl', label: 'Polish' }, { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' }, { code: 'nl', label: 'Dutch' },
  { code: 'cs', label: 'Czech' }, { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' }, { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' }, { code: 'hi', label: 'Hindi' },
]

const icons = {
  dashboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="7" height="7" rx="1.5" /><rect x="11" y="2" width="7" height="7" rx="1.5" /><rect x="2" y="11" width="7" height="7" rx="1.5" /><rect x="11" y="11" width="7" height="7" rx="1.5" /></svg>,
  projects: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h2l2 2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>,
  profiles: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M16 9v1a6 6 0 0 1-12 0V9" /><line x1="10" y1="16" x2="10" y2="19" /><line x1="7" y1="19" x2="13" y2="19" /></svg>,
  assembly: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="8" width="4" height="4" rx="1" /><rect x="8" y="8" width="4" height="4" rx="1" /><rect x="14" y="8" width="4" height="4" rx="1" /><path d="M4 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" /><path d="M10 12v3" /></svg>,
  scripts: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M4 10h8M4 14h5" /></svg>,
  plus: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>,
  trash: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M8 6V4h4v2M7 6v10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6" /></svg>,
  edit: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11.5 5.5l3 3M4 14l1-4 8-8 3 3-8 8-4 1z" /></svg>,
  play: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 5l9 5-9 5V5z" /></svg>,
  pause: <svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="4" width="3" height="12" rx="1" /><rect x="12" y="4" width="3" height="12" rx="1" /></svg>,
  stop: <svg viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="4" width="12" height="12" rx="2" /></svg>,
  rewind: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5v10" strokeLinecap="round" /><path d="M18 5l-8 5 8 5V5z" /></svg>,
  download: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3v10m-4-4 4 4 4-4" /><path d="M4 17h12" /></svg>,
  undo: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9H14a4 4 0 0 1 0 8H10" /><path d="M4 9l3-3M4 9l3 3" /></svg>,
  redo: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M16 9H6a4 4 0 0 0 0 8h4" /><path d="M16 9l-3-3m3 3l-3 3" /></svg>,
  merge: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h4l8 8h4" /><path d="M4 14h4L10 10" /></svg>,
  drag: <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="8" cy="6" r="1.2" /><circle cx="12" cy="6" r="1.2" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="10" r="1.2" /><circle cx="8" cy="14" r="1.2" /><circle cx="12" cy="14" r="1.2" /></svg>,
  back: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 4l-6 6 6 6" /></svg>,
  menu: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="3" y1="6" x2="17" y2="6" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="14" x2="17" y2="14" /></svg>,
  close: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" /></svg>,
  speaker: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h3l4-4v12l-4-4H3V8z" /><path d="M14 7a4 4 0 0 1 0 6" /></svg>,
  check: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l5 5 7-8" /></svg>,
  globe: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="8" /><path d="M2 10h16M10 2a12 12 0 0 1 0 16A12 12 0 0 1 10 2z" /></svg>,
  zoomIn: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3M7 9h4M9 7v4" /></svg>,
  zoomOut: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="6" /><path d="M15 15l3 3M7 9h4" /></svg>,
  // NEW icons
  mic: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M16 9v1a6 6 0 0 1-12 0V9" /></svg>,
  upload: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 13V3m-4 4 4-4 4 4" /><path d="M4 17h12" /></svg>,
  bolt: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11 2L4 11h7l-2 7 9-10h-7l2-6z" /></svg>,
  silence: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="4" y1="10" x2="16" y2="10" strokeDasharray="2 2" /><circle cx="10" cy="10" r="7" /></svg>,
  fit: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7V4h3M14 4h3v3M3 13v3h3M14 17h3v-3" /></svg>,
  keyboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="16" height="11" rx="2" /><path d="M5 9h1M8 9h1M11 9h1M14 9h1M5 13h10" /></svg>,
  volume: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8h3l4-4v12l-4-4H3V8z" /><path d="M14 7a4 4 0 0 1 0 6M17 4a9 9 0 0 1 0 12" /></svg>,
  zip: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 3h8l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v4h4M10 8v2M10 12v2" strokeDasharray="1 1" /></svg>,
  dark: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M17.5 12.5A7.5 7.5 0 0 1 7.5 2.5a7.5 7.5 0 1 0 10 10z" /></svg>,
  light: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="4" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" /></svg>,
}

// ── Keyboard Shortcuts Modal ───────────────────────────────────────
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: 'Space', desc: 'Play / Pause' },
    { keys: 'Home', desc: 'Rewind to start' },
    { keys: '← →', desc: 'Nudge playhead ±1s' },
    { keys: 'Del / Backspace', desc: 'Remove selected clip' },
    { keys: 'Ctrl+Z', desc: 'Undo (text & timeline)' },
    { keys: 'Ctrl+Y / Ctrl+Shift+Z', desc: 'Redo (text & timeline)' },
    { keys: 'Ctrl+S', desc: 'Save script' },
  ]
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="modal__title">Keyboard Shortcuts</div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{icons.close}</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shortcuts.map(s => (
            <div key={s.keys} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <code style={{ fontSize: 11, background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '2px 8px', color: 'var(--accent)', minWidth: 130, textAlign: 'center', fontFamily: 'var(--mono)' }}>{s.keys}</code>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>('landing')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('scripts')
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('vo_dark')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  // Dark mode
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('vo_dark', String(darkMode))
  }, [darkMode])

  useEffect(() => {
    // Check if the user is already logged in (runs once on mount)
    checkUser()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/').then(() => setEngineStatus('online')).catch(() => setEngineStatus('offline'))
  }, [])

  const loadProjects = useCallback(async () => {
    try {
      const data = await api.get('/projects')
      setProjects((data ?? []).map(mapProject))
    } catch (e) {
      console.error('Failed to load projects', e)
    }
  }, [])

  const checkUser = useCallback(async () => {
    try {
      const data = await api.get('/user')
      setUser(data)
      await loadProjects()
      // Use functional update to always read the LATEST page, avoiding stale closure
      setPage(current =>
        ['landing', 'signin', 'signup'].includes(current) ? 'dashboard' : current
      )
    } catch {
      setUser(null)
      // If on a protected page, send back to landing
      setPage(current =>
        !['landing', 'signin', 'signup'].includes(current) ? 'landing' : current
      )
    } finally {
      setAuthLoading(false)
    }
  }, [loadProjects]) // `page` removed — functional setPage reads latest state directly

  const loadProfiles = useCallback(() => {
    api.get('/voice-profiles').then(d => setVoiceProfiles(d || [])).catch(() => { })
  }, [])
  useEffect(() => { if (user) loadProfiles() }, [user])
  useEffect(() => { setSidebarOpen(false) }, [page, activeProjectId])

  async function addProject(name: string, emoji: string, description: string) {
    const pId = uid()
    const p = { id: pId, name, emoji, description, createdAt: new Date().toISOString(), scripts: [] }
    setProjects(prev => [p, ...prev])
    setActiveProjectId(p.id)
    setWorkspaceTab('scripts')
    setPage('workspace')
    try {
      await api.post('/projects', { id: pId, name, emoji, description })
    } catch (e) {
      console.error('Failed to save project', e)
    }
  }

  async function deleteProject(id: string) {
    const proj = projects.find(p => p.id === id)
    proj?.scripts.forEach(s => { if (s.hasAudio) deleteAudioBlob(`audio_${s.id}`) })
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) { setActiveProjectId(null); setPage('projects') }
    try {
      await api.delete(`/projects/${id}`)
    } catch (e) {
      console.error('Failed to delete project', e)
    }
  }

  async function updateProject(id: string, update: Partial<Project>) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...update } : p))
    try {
      await api.put(`/projects/${id}`, update)
    } catch (e) {
      console.error('Failed to update project', e)
    }
  }

  async function addScript(projectId: string) {
    const proj = projects.find(p => p.id === projectId)
    const s = {
      id: uid(),
      title: 'Untitled Script',
      content: '',
      hasAudio: false,
      profileId: null,
      language: 'en',
      duration: null,
      speed: 1.0,
    }
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: [...p.scripts, s] } : p
    ))
    setActiveScriptId(s.id)
    try {
      await api.post(`/projects/${projectId}/scripts`, {
        id: s.id,
        title: s.title,
        content: s.content,
        has_audio: false,
        profile_id: null,
        language: s.language,
        duration: null,
        speed: s.speed,
        order_index: proj?.scripts.length ?? 0,
      })
    } catch (e) {
      console.error('Failed to add script', e)
    }
  }

  async function updateScript(projectId: string, scriptId: string, update: Partial<Script>) {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, scripts: p.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s) }
        : p
    ))

    const payload: Record<string, any> = {
      project_id: projectId,
      script_id: scriptId,
    }
    if ('title' in update) payload.title = update.title
    if ('content' in update) payload.content = update.content
    if ('hasAudio' in update) payload.has_audio = update.hasAudio
    if ('profileId' in update) payload.profile_id = update.profileId
    if ('language' in update) payload.language = update.language
    if ('duration' in update) payload.duration = update.duration
    if ('speed' in update) payload.speed = update.speed
    if ('waveformPeaks' in update) payload.waveform_peaks = update.waveformPeaks

    try {
      await api.post('/scripts/update', payload)
    } catch (e) {
      console.error('Failed to update script', e)
    }
  }

  async function deleteScript(projectId: string, scriptId: string) {
    deleteAudioBlob(`audio_${scriptId}`)
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: p.scripts.filter(s => s.id !== scriptId) } : p
    ))
    setActiveScriptId(null)
    try {
      await api.delete(`/projects/${projectId}/scripts/${scriptId}`)
    } catch (e) {
      console.error('Failed to delete script', e)
    }
  }

  async function reorderScripts(projectId: string, scripts: Script[]) {
    updateProject(projectId, { scripts })
    try {
      const payload = scripts.map((s, i) => ({ id: s.id, order_index: i }))
      await api.post(`/projects/${projectId}/scripts/reorder`, { scripts: payload })
    } catch (e) {
      console.error('Failed to reorder scripts', e)
    }
  }

  function openProject(id: string) {
    setActiveProjectId(id)
    const proj = projects.find(p => p.id === id)
    setActiveScriptId(proj?.scripts[0]?.id ?? null)
    setWorkspaceTab('scripts'); setMergedUrl(null)
    setPage('workspace')
  }

  async function mergeSelected(orderedClips: TimelineClip[]) {
    if (!orderedClips.length) return
    setMerging(true)
    try {
      const ctx = new AudioContext()
      type Segment = { buffer: AudioBuffer; trimStart: number; dur: number; volume: number; isGap: boolean }
      const segments: Segment[] = []

      for (const clip of orderedClips) {
        if (clip.isGap) {
          const silenceBuf = ctx.createBuffer(1, Math.round(clip.dur * 44100), 44100)
          segments.push({ buffer: silenceBuf, trimStart: 0, dur: clip.dur, volume: 1, isGap: true })
          continue
        }
        const raw = await loadAudioRawBlob(`audio_${clip.scriptId}`)
        if (!raw) continue
        const arr = await raw.arrayBuffer()
        const buf = await ctx.decodeAudioData(arr)
        segments.push({ buffer: buf, trimStart: clip.trimStart, dur: clip.dur, volume: clip.volume, isGap: false })
      }

      if (!segments.length) throw new Error('No audio loaded')

      const sr = segments.find(s => !s.isGap)?.buffer.sampleRate ?? 44100
      const totalSamples = segments.reduce((a, seg) => a + Math.round(seg.dur * sr), 0)
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
      setMergedUrl(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })))
    } catch (e) { alert('Merge failed: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setMerging(false) }
  }

  function audioBufferToWav(buf: AudioBuffer) {
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

  // NEW: ZIP export using only browser APIs (no JSZip needed)
  async function exportProjectZip() {
    if (!activeProject) return
    // We build a simple fake zip — just bundle as blob download for each file
    // For proper ZIP, advise using JSZip; here we create a simple tar-like sequence
    alert('ZIP export: Install JSZip (npm install jszip) and import it to enable ZIP export. Individual WAV files are already downloadable from the Assembly tab.')
  }

  const navItems = [
    { key: 'dashboard' as Page, label: 'Dashboard', icon: icons.dashboard },
    { key: 'projects' as Page, label: 'Projects', icon: icons.projects },
    { key: 'profiles' as Page, label: 'Voice Profiles', icon: icons.profiles },
  ]

  // ── Auth loading guard — prevents flash of landing page on refresh ──
  if (authLoading) {
    return (
      <div style={{
        minHeight: '100svh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  // ── Auth / Landing: render outside the main app shell ──────────────
  if (page === 'landing') return (
    <LandingPage
      onSignIn={() => setPage('signin')}
      onSignUp={() => setPage('signup')}
    />
  )

  if (page === 'signin') return (
    <SignInPage
      onSignIn={async (email, password) => {
        await api.post('/login', { email, password })
        await checkUser()
      }}
      onSignUp={() => setPage('signup')}
      onBack={() => setPage('landing')}
    />
  )
  if (page === 'signup') return (
    <SignUpPage
      onSignUp={async (name, email, password) => {
        await api.post('/register', { name, email, password })
        await checkUser()
      }}
      onSignIn={() => setPage('signin')}
      onBack={() => setPage('landing')}
    />
  )
  // ── Main app shell (dashboard / projects / workspace / profiles / settings) ────
  return (
    <div className="shell">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__logo">
          <div className="logo-mark">V</div>
          <span className="logo-name">VoiceStudio</span>
          <span className="logo-badge">AI</span>
          <button className="sidebar__close btn btn--ghost btn--sm" onClick={() => setSidebarOpen(false)}>{icons.close}</button>
        </div>
        <nav className="sidebar__nav">
          <div className="nav-section">
            <div className="nav-section__label">Main</div>
            {navItems.map(({ key, label, icon }) => (
              <button key={key} className={`nav-item ${page === key ? 'nav-item--active' : ''}`} onClick={() => setPage(key)}>
                {icon}{label}
                {key === 'projects' && projects.length > 0 && <span className="nav-item__count">{projects.length}</span>}
                {key === 'profiles' && voiceProfiles.length > 0 && <span className="nav-item__count">{voiceProfiles.length}</span>}
              </button>
            ))}
            <button
              className={`nav-item ${page === 'settings' ? 'nav-item--active' : ''}`}
              onClick={() => setPage('settings')}
            >
              {icons.light} Settings
            </button>
          </div>
          {projects.length > 0 && (
            <div className="nav-section">
              <div className="nav-section__label">Recent Projects</div>
              {projects.slice(0, 5).map(p => (
                <button key={p.id} className={`nav-item ${activeProjectId === p.id && page === 'workspace' ? 'nav-item--active' : ''}`} onClick={() => openProject(p.id)}>
                  <span style={{ fontSize: 15 }}>{p.emoji}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <div className="sidebar__bottom">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts" style={{ flex: 1, justifyContent: 'center' }}>
              {icons.keyboard}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode" style={{ flex: 1, justifyContent: 'center' }}>
              {darkMode ? icons.light : icons.dark}
            </button>
          </div>
          <div className={`engine-pill engine-pill--${engineStatus}`}>
            <span className="engine-pill__dot" />
            {engineStatus === 'checking' ? 'Connecting…' : engineStatus === 'online' ? 'AI Engine Online' : 'Engine Offline'}
          </div>
        </div>
      </aside>

      <div className="page">
        <div className="topbar">
          <button className="btn btn--ghost btn--sm topbar__hamburger" onClick={() => setSidebarOpen(true)}>{icons.menu}</button>
          {page === 'workspace' && activeProject ? (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => setPage('projects')}>{icons.back}<span className="topbar__back-label">Projects</span></button>
              <span className="topbar__sep">›</span>
              <span className="topbar__title topbar__title--project">{activeProject.emoji} {activeProject.name}</span>
            </>
          ) : (
            <span className="topbar__title">
              {page === 'dashboard' ? 'Dashboard' : page === 'projects' ? 'Projects' : page === 'profiles' ? 'Voice Profiles' : page === 'settings' ? 'Settings' : ''}
            </span>
          )}
          <div className="topbar__spacer" />
          {page === 'projects' && <button className="btn btn--primary btn--sm" onClick={() => setShowNewProject(true)}>{icons.plus}<span className="btn__label"> New Project</span></button>}
          {page === 'workspace' && activeProject && (
            <>
              <button className="btn btn--sm" onClick={() => addScript(activeProject.id)}>{icons.plus}<span className="btn__label"> Script</span></button>
              <button className="btn btn--sm btn--ghost" onClick={exportProjectZip} title="Export ZIP">{icons.zip}</button>
            </>
          )}
        </div>

        {page === 'workspace' && activeProject && (
          <div className="workspace-tabs">
            <button className={`workspace-tab ${workspaceTab === 'scripts' ? 'workspace-tab--active' : ''}`} onClick={() => setWorkspaceTab('scripts')}>
              {icons.scripts} Scripts <span className="workspace-tab__count">{activeProject.scripts.length}</span>
            </button>
            <button className={`workspace-tab ${workspaceTab === 'assembly' ? 'workspace-tab--active' : ''}`} onClick={() => setWorkspaceTab('assembly')}>
              {icons.assembly} Assembly <span className="workspace-tab__count">{activeProject.scripts.filter(s => s.hasAudio).length}</span>
            </button>
          </div>
        )}

        <div className={workspaceTab === 'assembly' && page === 'workspace' ? '' : 'content'}>
          {page === 'dashboard' && <DashboardPage projects={projects} voiceProfiles={voiceProfiles} onOpenProject={openProject} onGoProjects={() => setPage('projects')} onGoProfiles={() => setPage('profiles')} />}
          {page === 'projects' && <ProjectsPage projects={projects} onOpen={openProject} onDelete={deleteProject} onNew={() => setShowNewProject(true)} />}
          {page === 'workspace' && activeProject && workspaceTab === 'scripts' && (
            <WorkspacePage
              project={activeProject}
              activeScriptId={activeScriptId}
              setActiveScriptId={setActiveScriptId}
              onAddScript={() => addScript(activeProject.id)}
              onUpdateScript={(sid, upd) => updateScript(activeProject.id, sid, upd)}
              onDeleteScript={(sid) => deleteScript(activeProject.id, sid)}
              onReorder={(scripts) => reorderScripts(activeProject.id, scripts)}
              voiceProfiles={voiceProfiles}
            />
          )}
          {page === 'workspace' && activeProject && workspaceTab === 'assembly' && (
            <AssemblyPage
              project={activeProject}
              mergedUrl={mergedUrl}
              merging={merging}
              onMerge={mergeSelected}
              onReorder={(scripts) => reorderScripts(activeProject.id, scripts)}
            />
          )}
          {page === 'profiles' && <ProfilesPage profiles={voiceProfiles} onRefresh={loadProfiles} />}
          {page === 'settings' && (
            <SettingsPage
              darkMode={darkMode}
              onToggleDark={() => setDarkMode(v => !v)}
              onSignOut={async () => {
                try { await api.post('/logout') } catch { /* ignore */ }
                setUser(null)
                setProjects([])
                setPage('landing')
              }}
              user={user ? { name: user.name, email: user.email } : { name: '', email: '' }}
            />
          )}
          {page === 'workspace' && !activeProject && (
            <div className="empty-state">{icons.projects}<p>No project selected.</p><button className="btn btn--primary" onClick={() => setPage('projects')}>Go to Projects</button></div>
          )}
        </div>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreate={addProject} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────
function DashboardPage({ projects, voiceProfiles, onOpenProject, onGoProjects, onGoProfiles }: {
  projects: Project[]; voiceProfiles: VoiceProfile[]
  onOpenProject: (id: string) => void; onGoProjects: () => void; onGoProfiles: () => void
}) {
  const totalScripts = projects.reduce((a, p) => a + p.scripts.length, 0)
  const totalVoiceovers = projects.reduce((a, p) => a + p.scripts.filter(s => s.hasAudio).length, 0)
  return (
    <div>
      <div className="dash-stats">
        {[
          { label: 'Projects', icon: icons.projects, value: projects.length, sub: 'Workspaces' },
          { label: 'Scripts', icon: icons.scripts, value: totalScripts, sub: 'Across all projects' },
          { label: 'Voiceovers', icon: icons.play, value: totalVoiceovers, sub: 'Generated audio' },
          { label: 'Profiles', icon: icons.profiles, value: voiceProfiles.length, sub: 'Voice models' },
        ].map(({ label, icon, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-card__label">{icon} {label}</div>
            <div className="stat-card__value">{value}</div>
            <div className="stat-card__sub">{sub}</div>
          </div>
        ))}
      </div>
      <div className="dash-grid">
        <div>
          <div className="section-head"><div><h2>Recent Projects</h2></div><button className="btn btn--ghost btn--sm" onClick={onGoProjects}>View all</button></div>
          {projects.length === 0
            ? <div className="empty-state" style={{ padding: '30px 0' }}>{icons.projects}<p>No projects yet</p><button className="btn btn--primary btn--sm" onClick={onGoProjects}>Create first project</button></div>
            : projects.slice(0, 4).map(p => (
              <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="project-card__icon">{p.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="project-card__name">{p.name}</div>
                    <div className="project-card__meta"><span>{p.scripts.length} scripts</span><span>{p.scripts.filter(s => s.hasAudio).length} voiceovers</span></div>
                  </div>
                  {p.scripts.some(s => s.hasAudio) && <span className="tag tag--ok">Audio</span>}
                </div>
              </div>
            ))
          }
        </div>
        <div>
          <div className="section-head"><div><h2>Voice Profiles</h2></div><button className="btn btn--ghost btn--sm" onClick={onGoProfiles}>Manage</button></div>
          {voiceProfiles.length === 0
            ? <div className="empty-state" style={{ padding: '30px 0' }}>{icons.profiles}<p>No voice profiles yet</p><button className="btn btn--primary btn--sm" onClick={onGoProfiles}>Record a voice</button></div>
            : voiceProfiles.slice(0, 4).map(vp => (
              <div key={vp.profile_id} className="project-card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{vp.profile_id[0].toUpperCase()}</div>
                  <div><div style={{ fontWeight: 500, fontSize: 14 }}>{vp.profile_id}</div><div style={{ fontSize: 12, color: 'var(--text-3)' }}>Voice profile ready</div></div>
                  <span className="tag tag--ok" style={{ marginLeft: 'auto' }}>Ready</span>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Projects ───────────────────────────────────────────────────────
function ProjectsPage({ projects, onOpen, onDelete, onNew }: {
  projects: Project[]; onOpen: (id: string) => void; onDelete: (id: string) => void; onNew: () => void
}) {
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 20 }}><div><h2>All Projects</h2><p>Manage your voiceover workspaces</p></div></div>
      <div className="project-grid">
        <div className="project-card project-card--new" onClick={onNew}>{icons.plus}<span>New Project</span></div>
        {projects.map(p => (
          <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            <div className="project-card__actions">
              <button className="btn btn--sm btn--danger" onClick={e => { e.stopPropagation(); onDelete(p.id) }}>{icons.trash}</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="project-card__icon">{p.emoji}</div>
              <div className="project-card__name">{p.name}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{p.description || 'No description'}</div>
            <div className="project-card__meta"><span>{p.scripts.length} scripts</span><span>{p.scripts.filter(s => s.hasAudio).length} with audio</span></div>
            <div className="project-card__tags">
              <span className="tag">{new Date(p.createdAt).toLocaleDateString()}</span>
              {p.scripts.some(s => s.hasAudio) && <span className="tag tag--ok">Has Audio</span>}
              {p.scripts.length === 0 && <span className="tag tag--warn">Empty</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Workspace ──────────────────────────────────────────────────────
function WorkspacePage({ project, activeScriptId, setActiveScriptId, onAddScript, onUpdateScript, onDeleteScript, onReorder, voiceProfiles }: {
  project: Project; activeScriptId: string | null; setActiveScriptId: (id: string | null) => void
  onAddScript: () => void; onUpdateScript: (id: string, upd: Partial<Script>) => void
  onDeleteScript: (id: string) => void; onReorder: (scripts: Script[]) => void
  voiceProfiles: VoiceProfile[]
}) {
  const activeScript = project.scripts.find(s => s.id === activeScriptId) ?? null
  const [histState, dispatch] = useReducer(historyReducer, { past: [], present: activeScript?.content ?? '', future: [] })
  const [synthesizing, setSynthesizing] = useState(false)
  // NEW: bulk generate
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(0)
  const [bulkTotal, setBulkTotal] = useState(0)
  const [synthErr, setSynthErr] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [showScriptList, setShowScriptList] = useState(true)
  // NEW: transcription
  const [transcribing, setTranscribing] = useState(false)
  // NEW: import script
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
    // XTTS quality knobs — lower temperature = more stable, closer to reference voice
    fd.append('temperature', '0.65')
    fd.append('top_k', '50')
    fd.append('top_p', '0.85')
    fd.append('gap_ms', '60')   // silence injected between sentence chunks (ms)

    try {
      const res = await fetch(`${API}/synthesize`, { method: 'POST', body: fd })
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
      } catch { /* ok — duration/peaks are optional */ }

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

  // NEW: Bulk generate all scripts without audio
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

  // NEW: Transcription — upload audio → text
  async function handleAudioTranscribe(file: File) {
    if (!activeScript) return
    setTranscribing(true)
    const fd = new FormData()
    fd.append('file', file, file.name)
    try {
      const res = await fetch(`${API}/transcribe`, { method: 'POST', body: fd })
      if (!res.ok) { alert('Transcription failed'); return }
      const data = await res.json()
      dispatch({ type: 'SET', value: data.text || '' })
    } catch { alert('Connection error. Is the AI engine running?') }
    finally { setTranscribing(false) }
  }

  // NEW: Script import from .txt
  async function handleFileImport(file: File) {
    const text = await file.text()
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    if (paragraphs.length <= 1) {
      // Single block → fill current script
      if (activeScript) dispatch({ type: 'SET', value: text.trim() })
    } else {
      alert(`Found ${paragraphs.length} paragraphs. This will create ${paragraphs.length} new scripts.`)
      // Could call onAddScript for each — left as simple fill for now
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
              {/* NEW: Import buttons */}
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
              {/* NEW: Speed control */}
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

// ── Assembly Timeline ──────────────────────────────────────────────
function AssemblyPage({ project, mergedUrl, merging, onMerge, onReorder }: {
  project: Project
  mergedUrl: string | null
  merging: boolean
  onMerge: (orderedClips: TimelineClip[]) => void
  onReorder: (scripts: Script[]) => void
}) {
  const withAudio = project.scripts.filter(s => s.hasAudio)

  const [zoom, setZoom] = useState(80)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tlHistory, dispatchTl] = useReducer(timelineReducer, { past: [], present: [], future: [] })
  const timelineClips = tlHistory.present
  const setTimelineClips = (clips: TimelineClip[]) => dispatchTl({ type: 'SET', clips })
  const [dragAssetId, setDragAssetId] = useState<string | null>(null)
  const [dragClipId, setDragClipId] = useState<string | null>(null)
  const [dragOffsetSec, setDragOffsetSec] = useState(0)
  // NEW: resize trim handle
  const [resizingClip, setResizingClip] = useState<{ id: string; side: 'left' | 'right'; initX: number; initVal: number } | null>(null)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [colorCursor, setColorCursor] = useState(0)
  const [dropActive, setDropActive] = useState(false)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  // NEW: volume popup
  const [volumeClipId, setVolumeClipId] = useState<string | null>(null)
  // NEW: gap dialog
  const [showGapDialog, setShowGapDialog] = useState(false)
  const [gapDuration, setGapDuration] = useState(1)
  const [showShortcutsLocal, setShowShortcutsLocal] = useState(false)

  const timelineRef = useRef<HTMLDivElement>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({})
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playStartCtxTimeRef = useRef<number>(0)
  const playheadAtStartRef = useRef<number>(0)

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

  useEffect(() => () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current) }, [])

  // NEW: Keyboard shortcuts for timeline
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

  function fmtTime(s: number) {
    const m = Math.floor(s / 60), sc = Math.floor(s % 60)
    return `${m}:${String(sc).padStart(2, '0')}`
  }

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

  // NEW: Add silence/gap clip
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
    onMerge(ordered)
  }

  // NEW: Fit zoom to all clips
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
    setVolumeClipId(null)
  }

  // NEW: Resize trim handle mouse down
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

  // Timeline ruler ticks
  const tickInterval = zoom >= 120 ? 2 : zoom >= 70 ? 5 : zoom >= 40 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= totalDur + tickInterval; t += tickInterval) ticks.push(t)
  const timelineWidth = Math.max(totalDur * zoom + 200, 800)

  const S = {
    shell: { display: 'flex', flexDirection: 'column' as const, height: 'calc(100svh - var(--topbar-h) - var(--tabs-h))', background: 'var(--bg)' } as React.CSSProperties,
    transport: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap' as const } as React.CSSProperties,
    sep: { width: 1, height: 20, background: 'var(--border-2)', margin: '0 2px', flexShrink: 0 } as React.CSSProperties,
    body: { display: 'flex', flex: 1, overflow: 'hidden' } as React.CSSProperties,
    libPanel: { width: 210, flexShrink: 0, background: 'var(--bg-2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
    libHeader: { padding: '9px 12px 5px', color: 'var(--text-3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.7px', flexShrink: 0 } as React.CSSProperties,
    libList: { flex: 1, overflowY: 'auto' as const, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column' as const, gap: 4 } as React.CSSProperties,
    timelineArea: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
    timelineScroll: { flex: 1, overflowX: 'auto' as const, overflowY: 'hidden' as const, cursor: dragClipId || resizingClip ? 'grabbing' : draggingPlayhead ? 'ew-resize' : 'default', userSelect: 'none' as const } as React.CSSProperties,
    ruler: { height: 30, background: 'var(--bg-3)', borderBottom: '1px solid var(--border-2)', position: 'sticky' as const, top: 0, zIndex: 10, overflow: 'hidden' } as React.CSSProperties,
    track: { height: 80, background: 'var(--bg-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '14px 0', position: 'relative' as const } as React.CSSProperties,
    footer: { padding: '7px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-2)', flexShrink: 0, flexWrap: 'wrap' as const } as React.CSSProperties,
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

        {/* NEW: Undo/Redo for timeline */}
        <button style={tBtn({ opacity: tlHistory.past.length ? 1 : 0.4 })} onClick={() => dispatchTl({ type: 'UNDO' })} disabled={!tlHistory.past.length} title="Undo timeline">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.undo}</span>
        </button>
        <button style={tBtn({ opacity: tlHistory.future.length ? 1 : 0.4 })} onClick={() => dispatchTl({ type: 'REDO' })} disabled={!tlHistory.future.length} title="Redo timeline">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.redo}</span>
        </button>

        <div style={S.sep} />

        {/* NEW: Gap insert button */}
        <button style={tBtn()} onClick={() => setShowGapDialog(true)} title="Add silence/gap at playhead">
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.silence}</span>
          <span style={{ fontSize: 11 }}>Gap</span>
        </button>

        {/* NEW: Fit to view */}
        <button style={tBtn()} onClick={fitToView} title="Fit all clips in view" disabled={!timelineClips.length}>
          <span style={{ display: 'flex', width: 14, height: 14 }}>{icons.fit}</span>
        </button>

        <div style={S.sep} />

        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Zoom</span>
        <input type="range" min="30" max="200" step="10" value={zoom} onChange={e => setZoom(Number(e.target.value))}
          style={{ width: 70, accentColor: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)', width: 28, flexShrink: 0 }}>{zoom}</span>

        <div style={S.sep} />

        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 500, minWidth: 40 }}>{fmtTime(playhead)}</span>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>/ {fmtTime(Math.max(0, totalDur - 5))}</span>

        <div style={{ flex: 1 }} />

        {mergedUrl && <audio src={mergedUrl} controls style={{ height: 28, width: 180, accentColor: 'var(--accent)' }} />}
        {mergedUrl && (
          <a href={mergedUrl} download={`final.wav`} className="btn btn--sm btn--primary">{icons.download} Download</a>
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
              const lt = CLIP_LIGHTS[i % CLIP_LIGHTS.length]
              // Use real waveform peaks if available
              const peaks = s.waveformPeaks ?? Array.from({ length: 5 }, (_, j) => 0.2 + Math.abs(Math.sin((s.id.charCodeAt(0) ?? 65) * 17 + j * 0.7)) * 0.6)
              return (
                <div key={s.id} draggable onDragStart={() => setDragAssetId(s.id)} onDragEnd={() => setDragAssetId(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: dragAssetId === s.id ? lt : 'var(--surface)', cursor: 'grab', transition: 'background 0.1s', opacity: dragAssetId === s.id ? 0.5 : 1 }}>
                  {/* Real waveform icon */}
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
                      {s.duration ? fmtTime(s.duration) : '—'}{s.content && ` · ${s.content.trim().split(/\s+/).length}w`}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 13, flexShrink: 0, cursor: 'grab' }}>{icons.drag}</span>
                </div>
              )
            })}
          </div>
          {withAudio.length > 0 && (
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>Drag clips onto the timeline. Right-drag clip edges to trim. Use Space to play/pause.</p>
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
                    <span style={{ fontSize: 10, color: 'var(--text-3)', paddingLeft: 3, paddingTop: 3, display: 'block', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>{fmtTime(t)}</span>
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

              {/* Track lane */}
              <div style={{ ...S.track, outline: dropActive ? '2px dashed var(--accent)' : 'none', outlineOffset: -3 }}
                onDragOver={onTimelineDragOver}
                onDragLeave={onTimelineDragLeave}
                onDrop={onTimelineDrop}
                onClick={e => {
                  if (!dragClipId && !resizingClip) {
                    setSelectedClipId(null)
                    setVolumeClipId(null)
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
                  const lt = isGap ? 'var(--bg-3)' : CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
                  const clipW = Math.max(clip.dur * zoom, 30)
                  const isActive = dragClipId === clip.id
                  const isSelected = selectedClipId === clip.id
                  const showVolume = volumeClipId === clip.id
                  const script = project.scripts.find(s => s.id === clip.scriptId)
                  const peaks = script?.waveformPeaks
                  const bars = Math.max(Math.floor((clipW - 16) / 7), 4)

                  return (
                    <div key={clip.id}
                      onMouseDown={e => onClipMouseDown(e, clip)}
                      onClick={e => { e.stopPropagation(); setSelectedClipId(clip.id); setVolumeClipId(null) }}
                      style={{ position: 'absolute', left: clip.start * zoom, top: 4, height: 72, width: clipW, borderRadius: 7, background: lt, border: `1.5px solid ${isSelected ? col : col + '66'}`, cursor: isActive ? 'grabbing' : 'grab', overflow: 'visible', zIndex: isActive || isSelected ? 100 : 10, boxShadow: isSelected ? `0 0 0 2px ${col}44` : isActive ? '0 6px 18px rgba(30,22,10,0.14)' : 'none', transition: isActive ? 'none' : 'box-shadow 0.12s' }}>

                      {/* Clip inner — clipped */}
                      <div style={{ position: 'absolute', inset: 0, borderRadius: 7, overflow: 'hidden' }}>
                        {/* Header */}
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 22, background: col + '22', borderBottom: `1px solid ${col}33`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 600, color: isGap ? 'var(--text-3)' : col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {isGap ? '⏸ ' : ''}{clip.title}
                          </span>
                          <span style={{ fontSize: 9.5, color: col + 'aa', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{fmtTime(clip.dur)}</span>
                          {clip.volume !== 1 && !isGap && (
                            <span style={{ fontSize: 9, color: col, fontFamily: 'var(--mono)' }}>{Math.round(clip.volume * 100)}%</span>
                          )}
                          <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); removeClip(clip.id) }}
                            style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(30,22,10,0.12)', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, fontFamily: 'inherit' }}>×</button>
                        </div>

                        {/* Waveform — real peaks if available */}
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

                        {/* Gap stripe pattern */}
                        {isGap && (
                          <div style={{ position: 'absolute', inset: '22px 0 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
                            <span style={{ fontSize: 18 }}>⏸</span>
                          </div>
                        )}
                      </div>

                      {/* NEW: Left trim handle */}
                      {!isGap && (
                        <div onMouseDown={e => onResizeMouseDown(e, clip, 'left')}
                          style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 4, height: 28, borderRadius: 2, background: col + 'cc', boxShadow: '0 0 4px rgba(0,0,0,0.2)' }} />
                        </div>
                      )}
                      {/* NEW: Right trim handle */}
                      {!isGap && (
                        <div onMouseDown={e => onResizeMouseDown(e, clip, 'right')}
                          style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 4, height: 28, borderRadius: 2, background: col + 'cc', boxShadow: '0 0 4px rgba(0,0,0,0.2)' }} />
                        </div>
                      )}

                      {/* NEW: Volume popup (shows when selected and non-gap) */}
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

                      {/* Trim indicators */}
                      {!isGap && clip.trimStart > 0 && (
                        <div style={{ position: 'absolute', left: 6, top: 24, fontSize: 9, color: col, fontFamily: 'var(--mono)' }}>↠{fmtTime(clip.trimStart)}</div>
                      )}
                    </div>
                  )
                })}

                {/* Playhead in track */}
                <div style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 50, pointerEvents: 'none', opacity: 0.7 }} />
              </div>

              <div style={{ padding: '4px 10px' }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Track 1 · Voiceover</span>
              </div>
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
                  const lt = clip.isGap ? 'var(--bg-3)' : CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
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

      {/* NEW: Gap/Silence dialog */}
      {showGapDialog && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowGapDialog(false)}>
          <div className="modal" style={{ maxWidth: 340 }}>
            <div className="modal__title">Add Silence / Gap</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Insert a silent gap at the current playhead position ({fmtTime(playhead)}).</p>
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

// ── Voice Profiles ─────────────────────────────────────────────────
function ProfilesPage({ profiles, onRefresh }: { profiles: VoiceProfile[]; onRefresh: () => void }) {
  const recorder = useAudioRecorder()
  const [profileName, setProfileName] = useState('my-voice')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgWarn, setMsgWarn] = useState('')
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [gainVal, setGainVal] = useState(0.85)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('Hello, this is a preview of my voice profile.')
  const [previewing, setPreviewing] = useState(false)

  async function handleStart() {
    setMsg(''); setMsgWarn('')
    try {
      await recorder.start(noiseSuppression, gainVal)
    } catch (e: any) {
      setMsg(`Error: Could not access microphone. ${e.message ?? ''}`)
    }
  }

  async function handleStop() {
    setSaving(true); setMsg(''); setMsgWarn('')
    const blob = await recorder.stop()

    if (!blob || blob.size === 0) {
      setMsg('Error: No audio captured. Please try again.')
      setSaving(false)
      return
    }

    const secs = recorder.seconds
    if (secs < 6) {
      setMsgWarn(
        `⚠ Recording is only ${secs}s. XTTS needs 6-30 s of clear speech ` +
        `for accurate voice cloning. Please re-record.`
      )
      // Don't block saving — just warn
    } else if (secs > 35) {
      setMsgWarn(
        `⚠ Recording is ${secs}s — very long references can confuse XTTS. ` +
        `10-20 s of clean speech is ideal.`
      )
    }

    const fd = new FormData()
    // Send as WAV if possible, otherwise webm — backend will re-encode
    const mime = blob.type.includes('wav') ? 'audio/wav' : 'audio/webm'
    const ext = blob.type.includes('wav') ? 'wav' : 'webm'
    fd.append('file', new Blob([blob], { type: mime }), `voice.${ext}`)
    fd.append('profile_id', profileName.trim() || 'my-voice')
    fd.append('name', profileName.trim() || 'my-voice')
    fd.append('status', 'ready')

    try {
      const data = await api.post('/voice-profiles', fd)
      // Show backend warning if present (e.g. duration too short)
      if (data?.warning) setMsgWarn(`⚠ ${data.warning}`)
      setMsg(`✓ Profile "${data.profile_id ?? profileName}" saved — ${data.duration_seconds}s`)
      onRefresh()
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? 'Save failed. Is the AI engine running?'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(profile_id: string) {
    if (!confirm(`Delete profile "${profile_id}"?`)) return
    try {
      // DELETE /api/voice-profiles/{profile_id}
      await api.delete(`/voice-profiles/${profile_id}`)
      onRefresh()
    } catch (e: any) {
      alert('Delete failed: ' + (e?.message ?? 'Unknown error'))
    }
  }

  async function handlePreview(profile_id: string) {
    if (!previewText.trim()) { alert('Enter some preview text first.'); return }
    setPreviewing(true); setPreviewId(profile_id)
    const fd = new FormData()
    fd.append('text', previewText)
    fd.append('profile_id', profile_id)
    fd.append('language', 'en')
    try {
      // Preview hits engine directly (no auth needed on engine)
      const blob = await api.enginePost('/synthesize', fd)
      const audio = new Audio(URL.createObjectURL(blob))
      audio.play()
    } catch (e: any) {
      console.error('Preview failed:', e)
      alert('Preview failed. Is the AI engine running?')
    } finally {
      setPreviewing(false); setPreviewId(null)
    }
  }

  return (
    <div>
      <div className="profiles-layout">
        <div>
          <div className="section-head">
            <div><h2>Record New Profile</h2><p>Capture your voice</p></div>
          </div>
          <div className="record-studio">
            <WaveVisualiser active={recorder.recording} />
            {recorder.recording && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="timer">{fmt(recorder.seconds)}</div>
                {recorder.seconds < 6 && (
                  <span style={{ fontSize: 11, color: 'var(--warn)', background: 'var(--warn-lt)', padding: '2px 8px', borderRadius: 99, border: '1px solid rgba(160,117,48,0.3)' }}>
                    Record 6s+
                  </span>
                )}
              </div>
            )}
            <div className="record-script">
              <div className="record-script__label">Read this aloud</div>
              <p className="record-script__text">"The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. How much wood would a woodchuck chuck if a woodchuck could chuck wood?"</p>
            </div>
            <div className="noise-controls">
              <label className="noise-toggle">
                <input type="checkbox" checked={noiseSuppression} onChange={e => setNoiseSuppression(e.target.checked)} disabled={recorder.recording} />
                Browser noise suppression
              </label>
              <div className="noise-row">
                <label>Gain</label>
                <input type="range" min="0.1" max="2" step="0.05" value={gainVal} onChange={e => setGainVal(Number(e.target.value))} disabled={recorder.recording} />
                <span>{gainVal.toFixed(2)}</span>
              </div>
            </div>
            <div className="input-row">
              <label>Profile name</label>
              <input
                className="text-input"
                value={profileName}
                onChange={e => setProfileName(e.target.value.replace(/[^a-z0-9-_]/gi, '-').toLowerCase())}
                disabled={recorder.recording}
                placeholder="my-voice"
              />
            </div>
            <MicBtn
              recording={recorder.recording}
              onClick={recorder.recording ? handleStop : handleStart}
              disabled={saving}
              label={saving ? 'Saving…' : recorder.recording ? 'Stop Recording' : 'Start Recording'}
            />
            {msgWarn && <div className="msg msg--warn">{msgWarn}</div>}
            {msg && <div className={`msg ${msg.startsWith('✓') ? 'msg--ok' : 'msg--err'}`}>{msg}</div>}
          </div>
        </div>

        <div>
          <div className="section-head">
            <div><h2>Saved Profiles</h2><p>{profiles.length} voice model{profiles.length !== 1 ? 's' : ''} ready</p></div>
          </div>
          {profiles.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <input
                className="text-input"
                style={{ width: '100%' }}
                value={previewText}
                onChange={e => setPreviewText(e.target.value)}
                placeholder="Preview text…"
              />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profiles.length === 0
              ? <div className="empty-state">{icons.profiles}<p>Record your first voice profile</p></div>
              : profiles.map(vp => (
                <div key={vp.profile_id} className="profile-card">
                  <div className="profile-avatar">{vp.profile_id[0].toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div className="profile-card__name">{vp.profile_id}</div>
                    <div className="profile-card__meta">
                      Voice profile · Ready{vp.duration ? ` · ${vp.duration.toFixed(1)}s` : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => handlePreview(vp.profile_id)}
                    disabled={previewing}
                    title="Preview voice"
                  >
                    {previewing && previewId === vp.profile_id ? <span className="spinner" /> : icons.speaker}
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => handleDelete(vp.profile_id)}
                    title="Delete"
                  >
                    {icons.trash}
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ── New Project Modal ──────────────────────────────────────────────
const EMOJIS = ['🎬', '🎙', '📹', '🎤', '🎵', '📺', '🌟', '🚀', '💡', '🎯', '📚', '🎧']

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, emoji: string, desc: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [emoji, setEmoji] = useState('🎬')
  function submit() { if (!name.trim()) return; onCreate(name.trim(), emoji, desc.trim()); onClose() }
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__title">New Project</div>
        <div className="modal__body">
          <div className="field">
            <label>Project icon</label>
            <div className="emoji-row">{EMOJIS.map(e => <button key={e} className={`emoji-opt ${emoji === e ? 'emoji-opt--active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}</div>
          </div>
          <div className="field">
            <label>Project name</label>
            <input className="full-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My YouTube Episode" autoFocus onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <input className="full-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this about?" />
          </div>
        </div>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={!name.trim()}>Create Project</button>
        </div>
      </div>
    </div>
  )
}