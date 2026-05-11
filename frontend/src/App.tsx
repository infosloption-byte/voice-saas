import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import './App.css'

const API = 'http://localhost:8000'

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

async function deleteAudioBlob(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res()
  })
}

// ── Types ──────────────────────────────────────────────────────────
type Page = 'dashboard' | 'projects' | 'workspace' | 'profiles'
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
}

// New: timeline placement
interface TimelineClip {
  id: string
  scriptId: string
  start: number    // seconds from timeline origin
  dur: number      // duration in seconds
  title: string
  ci: number       // color index
}

interface VoiceProfile {
  profile_id: string; filename: string; duration?: number
}

// ── Timeline colour palette (warm accent family) ───────────────────
const CLIP_COLORS = [
  '#c96442', '#4278c9', '#3db564', '#c94278', '#c9a442', '#7842c9',
]
const CLIP_LIGHTS = [
  'rgba(201,100,66,0.10)', 'rgba(66,120,201,0.10)', 'rgba(61,181,100,0.10)',
  'rgba(201,66,120,0.10)', 'rgba(201,164,66,0.10)', 'rgba(120,66,201,0.10)',
]

function waveBar(scriptId: string, i: number): number {
  const seed = (scriptId.charCodeAt(0) ?? 65) * 17 + i * 13
  return 0.2 + Math.abs(Math.sin(seed * 0.7)) * 0.5 + Math.abs(Math.sin(seed * 0.3)) * 0.2
}

// ── History reducer ────────────────────────────────────────────────
interface HistoryState { past: string[]; present: string; future: string[] }

function historyReducer(
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

  const stop = useCallback((): Promise<Blob> => new Promise(resolve => {
    if (!recRef.current) return resolve(new Blob())
    recRef.current.onstop = () => {
      resolve(new Blob(chunksRef.current, { type: recRef.current?.mimeType || 'audio/webm' }))
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
}

// ── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('scripts')
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [projects, setProjects] = useState<Project[]>(() => {
    try { return JSON.parse(localStorage.getItem('vo_projects') || '[]') } catch { return [] }
  })
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  useEffect(() => { localStorage.setItem('vo_projects', JSON.stringify(projects)) }, [projects])

  useEffect(() => {
    fetch(`${API}/`).then(r => r.json()).then(() => setEngineStatus('online')).catch(() => setEngineStatus('offline'))
  }, [])

  const loadProfiles = useCallback(() => {
    fetch(`${API}/voice-profile/list`).then(r => r.json()).then(d => setVoiceProfiles(d.profiles || [])).catch(() => {})
  }, [])
  useEffect(() => { loadProfiles() }, [])
  useEffect(() => { setSidebarOpen(false) }, [page, activeProjectId])

  function addProject(name: string, emoji: string, description: string) {
    const p: Project = { id: uid(), name, emoji, description, createdAt: new Date().toISOString(), scripts: [] }
    setProjects(prev => [p, ...prev])
    setActiveProjectId(p.id); setWorkspaceTab('scripts'); setPage('workspace')
  }

  function deleteProject(id: string) {
    const proj = projects.find(p => p.id === id)
    proj?.scripts.forEach(s => { if (s.hasAudio) deleteAudioBlob(`audio_${s.id}`) })
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) { setActiveProjectId(null); setPage('projects') }
  }

  function updateProject(id: string, update: Partial<Project>) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...update } : p))
  }

  function addScript(projectId: string) {
    const s: Script = { id: uid(), title: 'Untitled Script', content: '', hasAudio: false, profileId: null, language: 'en', duration: null }
    const proj = projects.find(p => p.id === projectId)
    updateProject(projectId, { scripts: [...(proj?.scripts ?? []), s] })
    setActiveScriptId(s.id)
  }

  function updateScript(projectId: string, scriptId: string, update: Partial<Script>) {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: p.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s) } : p
    ))
  }

  function deleteScript(projectId: string, scriptId: string) {
    deleteAudioBlob(`audio_${scriptId}`)
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: p.scripts.filter(s => s.id !== scriptId) } : p
    ))
    setActiveScriptId(null)
  }

  function reorderScripts(projectId: string, scripts: Script[]) {
    updateProject(projectId, { scripts })
  }

  function openProject(id: string) {
    setActiveProjectId(id)
    const proj = projects.find(p => p.id === id)
    setActiveScriptId(proj?.scripts[0]?.id ?? null)
    setWorkspaceTab('scripts'); setMergedUrl(null)
    setPage('workspace')
  }

  // Merge accepts ordered script IDs from the timeline
  async function mergeSelected(orderedScriptIds: string[]) {
    if (!orderedScriptIds.length) return
    setMerging(true)
    try {
      const ctx = new AudioContext()
      const buffers: AudioBuffer[] = []
      for (const sid of orderedScriptIds) {
        const url = await loadAudioBlob(`audio_${sid}`)
        if (!url) continue
        const arr = await (await fetch(url)).arrayBuffer()
        buffers.push(await ctx.decodeAudioData(arr))
      }
      if (!buffers.length) throw new Error('No audio loaded')
      const totalLen = buffers.reduce((a, b) => a + b.length, 0)
      const merged = ctx.createBuffer(1, totalLen, buffers[0].sampleRate)
      let offset = 0
      for (const buf of buffers) { merged.copyToChannel(buf.getChannelData(0), 0, offset); offset += buf.length }
      const wav = audioBufferToWav(merged)
      setMergedUrl(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })))
    } catch { alert('Merge failed. Ensure all timeline clips have audio.') }
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

  const navItems = [
    { key: 'dashboard' as Page, label: 'Dashboard', icon: icons.dashboard },
    { key: 'projects' as Page, label: 'Projects', icon: icons.projects },
    { key: 'profiles' as Page, label: 'Voice Profiles', icon: icons.profiles },
  ]

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
              {page === 'dashboard' ? 'Dashboard' : page === 'projects' ? 'Projects' : 'Voice Profiles'}
            </span>
          )}
          <div className="topbar__spacer" />
          {page === 'projects' && <button className="btn btn--primary btn--sm" onClick={() => setShowNewProject(true)}>{icons.plus}<span className="btn__label"> New Project</span></button>}
          {page === 'workspace' && activeProject && <button className="btn btn--sm" onClick={() => addScript(activeProject.id)}>{icons.plus}<span className="btn__label"> Script</span></button>}
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
          {page === 'workspace' && !activeProject && (
            <div className="empty-state">{icons.projects}<p>No project selected.</p><button className="btn btn--primary" onClick={() => setPage('projects')}>Go to Projects</button></div>
          )}
        </div>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreate={addProject} />}
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
  const [synthErr, setSynthErr] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [showScriptList, setShowScriptList] = useState(true)
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

  async function generateVoiceover() {
    if (!activeScript || !histState.present.trim()) { setSynthErr('Write some script content first.'); return }
    const pid = activeScript.profileId || voiceProfiles[0]?.profile_id
    if (!pid) { setSynthErr('No voice profile selected.'); return }
    setSynthesizing(true); setSynthErr('')
    const fd = new FormData()
    fd.append('text', histState.present.trim())
    fd.append('profile_id', pid)
    fd.append('language', activeScript.language || 'en')
    try {
      const res = await fetch(`${API}/synthesize`, { method: 'POST', body: fd })
      if (!res.ok) { const e = await res.json(); setSynthErr(e.detail || 'Synthesis failed'); return }
      const blob = await res.blob()
      // Extract actual duration from the audio buffer
      let duration: number | null = null
      try {
        const tempUrl = URL.createObjectURL(blob)
        const audioCtx = new AudioContext()
        const arr = await (await fetch(tempUrl)).arrayBuffer()
        const buf = await audioCtx.decodeAudioData(arr)
        duration = Math.round(buf.duration * 10) / 10
        await audioCtx.close()
        URL.revokeObjectURL(tempUrl)
      } catch { /* duration stays null */ }
      await saveAudioBlob(`audio_${activeScript.id}`, blob)
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      onUpdateScript(activeScript.id, { hasAudio: true, profileId: pid, language: activeScript.language || 'en', duration })
    } catch { setSynthErr('Connection error. Is the AI engine running?') }
    finally { setSynthesizing(false) }
  }

  const wordCount = histState.present.trim() ? histState.present.trim().split(/\s+/).length : 0

  return (
    <div className="workspace">
      <div className={`script-panel ${!showScriptList ? 'script-panel--hidden' : ''}`}>
        <div className="script-panel__head">
          <h3>Scripts <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({project.scripts.length})</span></h3>
          <button className="btn btn--sm btn--primary" onClick={onAddScript}>{icons.plus}</button>
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
                placeholder="Write your script here…"
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
              <button className="btn btn--primary btn--sm" onClick={generateVoiceover} disabled={synthesizing || !histState.present.trim()}>
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
  onMerge: (orderedScriptIds: string[]) => void
  onReorder: (scripts: Script[]) => void
}) {
  const withAudio = project.scripts.filter(s => s.hasAudio)

  const [zoom, setZoom] = useState(80)        // pixels per second
  const [playhead, setPlayhead] = useState(0) // seconds
  const [playing, setPlaying] = useState(false)
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([])
  const [dragAssetId, setDragAssetId] = useState<string | null>(null)
  const [dragClipId, setDragClipId] = useState<string | null>(null)
  const [dragOffsetSec, setDragOffsetSec] = useState(0)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [colorCursor, setColorCursor] = useState(0)
  const [dropActive, setDropActive] = useState(false)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)

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
        } catch {}
      }
    })
  }, [project.scripts])

  // Stop playback when leaving
  useEffect(() => () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current) }, [])

  const totalDur = timelineClips.length
    ? Math.max(...timelineClips.map(c => c.start + c.dur)) + 5
    : 30

  // Playback ticker
  function stopPlayback() {
    scheduledSourcesRef.current.forEach(s => { try { s.stop(); s.disconnect() } catch {} })
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

    timelineClips.forEach(clip => {
      const buf = audioBuffersRef.current[clip.scriptId]
      if (!buf) return
      const offsetIntoClip = Math.max(0, fromPlayhead - clip.start)
      if (offsetIntoClip >= clip.dur) return  // clip already passed

      const whenToStart = ctxNow + Math.max(0, clip.start - fromPlayhead)
      const source = ctx.createBufferSource()
      source.buffer = buf
      source.connect(ctx.destination)
      source.start(whenToStart, offsetIntoClip)
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

  // Cleanup on unmount
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
    setTimelineClips(prev => [...prev, {
      id: 'tc_' + uid(),
      scriptId: script.id,
      start: startSec,
      dur: script.duration ?? Math.max(5, Math.ceil((script.content.trim().split(/\s+/).length || 50) / 2.5)),
      title: script.title,
      ci,
    }])
  }

  function removeClip(clipId: string) {
    setTimelineClips(prev => prev.filter(c => c.id !== clipId))
  }

  function handleMerge() {
    const ordered = [...timelineClips]
      .sort((a, b) => a.start - b.start)
      .map(c => c.scriptId)
    onMerge(ordered)
  }

  // ── Drag: asset → timeline ────────────────────────────────────────
  function onTimelineDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }
  function onTimelineDragLeave() { setDropActive(false) }
  function onTimelineDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropActive(false)
    if (!dragAssetId) return
    const script = project.scripts.find(s => s.id === dragAssetId)
    if (!script) return
    addToTimeline(script, getSecFromEvent(e))
    setDragAssetId(null)
  }

  // ── Drag: clip on timeline ────────────────────────────────────────
  function onClipMouseDown(e: React.MouseEvent, clip: TimelineClip) {
    e.preventDefault()
    e.stopPropagation()
    setDragOffsetSec(getSecFromEvent(e) - clip.start)
    setDragClipId(clip.id)
  }
  function onTimelineMouseMove(e: React.MouseEvent) {
    if (dragClipId) {
      const newStart = Math.max(0, Math.round((getSecFromEvent(e) - dragOffsetSec) * 10) / 10)
      setTimelineClips(prev => prev.map(c => c.id === dragClipId ? { ...c, start: newStart } : c))
    }
    if (draggingPlayhead) {
      const pos = Math.max(0, Math.round(getSecFromEvent(e) * 10) / 10)
      setPlayhead(pos)
    }
  }
  function onTimelineMouseUp() {
    if (draggingPlayhead && playing) startPlayback(playhead)
    setDragClipId(null)
    setDraggingPlayhead(false)
  }

  // Timeline ruler ticks
  const tickInterval = zoom >= 120 ? 2 : zoom >= 70 ? 5 : zoom >= 40 ? 10 : 30
  const ticks: number[] = []
  for (let t = 0; t <= totalDur + tickInterval; t += tickInterval) ticks.push(t)
  const timelineWidth = Math.max(totalDur * zoom + 200, 800)

  // Styles
  const S = {
    shell: {
      display: 'flex', flexDirection: 'column' as const,
      height: 'calc(100svh - var(--topbar-h) - var(--tabs-h))',
      background: 'var(--bg)',
    } as React.CSSProperties,
    transport: {
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', borderBottom: '1px solid var(--border)',
      background: 'var(--bg)', flexShrink: 0,
    } as React.CSSProperties,
    sep: {
      width: 1, height: 20, background: 'var(--border-2)', margin: '0 2px', flexShrink: 0,
    } as React.CSSProperties,
    body: {
      display: 'flex', flex: 1, overflow: 'hidden',
    } as React.CSSProperties,
    libPanel: {
      width: 210, flexShrink: 0, background: 'var(--bg-2)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
    } as React.CSSProperties,
    libHeader: {
      padding: '9px 12px 5px', color: 'var(--text-3)',
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const,
      letterSpacing: '0.7px', flexShrink: 0,
    } as React.CSSProperties,
    libList: {
      flex: 1, overflowY: 'auto' as const, padding: '4px 8px 8px',
      display: 'flex', flexDirection: 'column' as const, gap: 4,
    } as React.CSSProperties,
    timelineArea: {
      flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
    } as React.CSSProperties,
    timelineScroll: {
      flex: 1,
      overflowX: 'auto' as const,
      overflowY: 'hidden' as const,
      cursor: dragClipId ? 'grabbing' : draggingPlayhead ? 'ew-resize' : 'default',
      userSelect: 'none' as const,
    } as React.CSSProperties,
    ruler: {
      height: 30, background: 'var(--bg-3)',
      borderBottom: '1px solid var(--border-2)',
      position: 'sticky' as const, top: 0, zIndex: 10,
      overflow: 'hidden',
    } as React.CSSProperties,
    track: {
      height: 80, background: 'var(--bg-2)',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      margin: '14px 0',
      position: 'relative' as const,
    } as React.CSSProperties,
    footer: {
      padding: '7px 14px', borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg-2)', flexShrink: 0,
      flexWrap: 'wrap' as const,
    } as React.CSSProperties,
  }

  const transportBtn = (extra: React.CSSProperties = {}) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 4, padding: '5px 9px', borderRadius: 6,
    border: '1px solid var(--border-2)', background: 'var(--surface)',
    color: 'var(--text-1)', fontSize: 13, fontWeight: 500,
    fontFamily: 'var(--font)', cursor: 'pointer', flexShrink: 0,
    ...extra,
  } as React.CSSProperties)

  return (
    <div style={S.shell}>

      {/* ── Transport bar ─────────────────────────────────── */}
      <div style={S.transport}>
        <button style={transportBtn()} onClick={() => { stopPlayback(); setPlayhead(0) }} title="Rewind">
          <span style={{ display: 'flex', width: 16, height: 16 }}>{icons.rewind}</span>
        </button>
        <button
          onClick={() => playing ? stopPlayback() : startPlayback(playhead)}
          style={transportBtn({ background: 'var(--accent)', color: '#fff', border: 'none', width: 34, height: 34, borderRadius: '50%', padding: 0 })}
        >
          <span style={{ display: 'flex', width: 16, height: 16 }}>{playing ? icons.pause : icons.play}</span>
        </button>
        <button style={transportBtn()} onClick={() => { stopPlayback(); setPlayhead(0) }} title="Stop">
          <span style={{ display: 'flex', width: 16, height: 16 }}>{icons.stop}</span>
        </button>

        <div style={S.sep} />

        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Zoom</span>
        <input
          type="range" min="30" max="200" step="10" value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          style={{ width: 80, accentColor: 'var(--accent)', flexShrink: 0 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)', width: 28, flexShrink: 0 }}>{zoom}</span>

        <div style={S.sep} />

        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 500, minWidth: 40 }}>
          {fmtTime(playhead)}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>/ {fmtTime(Math.max(0, totalDur - 5))}</span>

        <div style={{ flex: 1 }} />

        {timelineClips.length > 0 && !mergedUrl && (
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
            {timelineClips.length} clip{timelineClips.length !== 1 ? 's' : ''} on track
          </span>
        )}
        {mergedUrl && (
          <audio src={mergedUrl} controls style={{ height: 28, width: 180, accentColor: 'var(--accent)' }} />
        )}
        {mergedUrl && (
          <a href={mergedUrl} download={`${project.name.replace(/\s+/g, '-')}-final.wav`} className="btn btn--sm btn--primary">
            {icons.download} Download
          </a>
        )}
        <button
          onClick={handleMerge}
          disabled={timelineClips.length < 1 || merging}
          style={transportBtn({
            background: mergedUrl ? 'var(--ok)' : 'var(--accent)',
            color: '#fff', border: 'none', padding: '6px 14px',
            opacity: timelineClips.length < 1 || merging ? 0.5 : 1,
          })}
        >
          {merging ? <><span className="spinner" /> Merging…</> : mergedUrl ? <>{icons.check} Re-export</> : <>{icons.merge} Export WAV</>}
        </button>
      </div>

      {/* ── Main body ─────────────────────────────────────── */}
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
              return (
                <div
                  key={s.id}
                  draggable
                  onDragStart={() => setDragAssetId(s.id)}
                  onDragEnd={() => setDragAssetId(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 9px', borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: dragAssetId === s.id ? lt : 'var(--surface)',
                    cursor: 'grab', transition: 'background 0.1s',
                    opacity: dragAssetId === s.id ? 0.5 : 1,
                  }}
                >
                  {/* Mini waveform icon */}
                  <div style={{
                    width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                    background: lt, border: `1px solid ${col}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 16 }}>
                      {[0, 1, 2, 3, 4].map(j => (
                        <div key={j} style={{
                          width: 2.5, borderRadius: 1.5,
                          height: Math.round(waveBar(s.id, j) * 14) + 'px',
                          background: col,
                        }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      {s.duration ? fmtTime(s.duration) : '—'}
                      {s.content && ` · ${s.content.trim().split(/\s+/).length}w`}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 13, flexShrink: 0, cursor: 'grab' }}>{icons.drag}</span>
                </div>
              )
            })}
          </div>
          {withAudio.length > 0 && (
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Drag clips onto the timeline track to arrange them.
              </p>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div style={S.timelineArea}>
          <div
            ref={timelineRef}
            style={S.timelineScroll}
            onMouseMove={onTimelineMouseMove}
            onMouseUp={onTimelineMouseUp}
            onMouseLeave={onTimelineMouseUp}
          >
            <div style={{ width: timelineWidth, position: 'relative', minHeight: '100%' }}>

              {/* Time ruler — click to place, drag playhead to scrub */}
              <div
                style={S.ruler}
                onMouseDown={e => {
                  if ((e.target as HTMLElement).closest('[data-playhead]')) return
                  const pos = Math.max(0, Math.round(getSecFromEvent(e) * 10) / 10)
                  setPlayhead(pos)
                  setDraggingPlayhead(true)
                  if (playing) stopPlayback()
                }}
              >

                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, bottom: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', paddingLeft: 3, paddingTop: 3, display: 'block', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
                      {fmtTime(t)}
                    </span>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 8, background: 'var(--border-2)' }} />
                  </div>
                ))}
                {/* Half-way minor ticks */}
                {ticks.slice(0, -1).flatMap(t => [0.25, 0.5, 0.75].map(frac => (
                  <div key={`m${t}_${frac}`} style={{
                    position: 'absolute',
                    left: t * zoom + frac * zoom * tickInterval,
                    bottom: 0, width: 1,
                    height: frac === 0.5 ? 7 : 4,
                    background: 'var(--border)'
                  }} />
                )))}
                {/* Playhead on ruler — draggable */}
                <div
                  data-playhead="true"
                  style={{ position: 'absolute', left: playhead * zoom, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 20 }}
                >
                  {/* Drag handle */}
                  <div
                    data-playhead="true"
                    onMouseDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDraggingPlayhead(true)
                      if (playing) stopPlayback()
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 14,
                      height: 18,
                      background: 'var(--accent)',
                      borderRadius: '3px 3px 2px 2px',
                      cursor: draggingPlayhead ? 'grabbing' : 'ew-resize',
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      paddingBottom: 2,
                      boxShadow: '0 2px 6px rgba(201,100,66,0.4)',
                    }}
                  >
                    {/* Down-arrow indicator */}
                    <svg width="6" height="5" viewBox="0 0 6 5" style={{ display: 'block' }}>
                      <polygon points="0,0 6,0 3,5" fill="rgba(255,255,255,0.7)" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Track lane */}
              <div
                style={{
                  ...S.track,
                  outline: dropActive ? '2px dashed var(--accent)' : 'none',
                  outlineOffset: -3,
                }}
                onDragOver={onTimelineDragOver}
                onDragLeave={onTimelineDragLeave}
                onDrop={onTimelineDrop}
                onClick={e => {
                  if (!dragClipId) {
                    const pos = getSecFromEvent(e)
                    setPlayhead(pos)
                    if (playing) startPlayback(pos)
                  }
                }}
              >
                {/* Background grid lines */}
                {ticks.map(t => (
                  <div key={t} style={{ position: 'absolute', left: t * zoom, top: 0, bottom: 0, width: 1, background: 'var(--border-3)' }} />
                ))}

                {/* Empty hint */}
                {timelineClips.length === 0 && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, color: 'var(--text-3)', pointerEvents: 'none',
                    letterSpacing: '0.2px',
                  }}>
                    {dropActive ? '✦ Drop to place clip' : 'Drag clips from the library onto this track'}
                  </div>
                )}

                {/* Clips */}
                {timelineClips.map(clip => {
                  const col = CLIP_COLORS[clip.ci % CLIP_COLORS.length]
                  const lt = CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
                  const clipW = Math.max(clip.dur * zoom, 50)
                  const bars = Math.max(Math.floor((clipW - 16) / 7), 4)
                  const isActive = dragClipId === clip.id
                  return (
                    <div
                      key={clip.id}
                      onMouseDown={e => onClipMouseDown(e, clip)}
                      style={{
                        position: 'absolute',
                        left: clip.start * zoom,
                        top: 4, height: 72, width: clipW,
                        borderRadius: 7,
                        background: lt,
                        border: `1.5px solid ${col}66`,
                        cursor: isActive ? 'grabbing' : 'grab',
                        overflow: 'hidden',
                        zIndex: isActive ? 100 : 10,
                        boxShadow: isActive ? '0 6px 18px rgba(30,22,10,0.14)' : 'none',
                        transition: isActive ? 'none' : 'box-shadow 0.12s',
                      }}
                    >
                      {/* Header strip */}
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: 22,
                        background: col + '22',
                        borderBottom: `1px solid ${col}33`,
                        display: 'flex', alignItems: 'center',
                        padding: '0 5px', gap: 4,
                      }}>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {clip.title}
                        </span>
                        <span style={{ fontSize: 9.5, color: col + 'aa', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                          {fmtTime(clip.dur)}
                        </span>
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); removeClip(clip.id) }}
                          style={{
                            width: 14, height: 14, borderRadius: 3,
                            background: 'rgba(30,22,10,0.12)',
                            border: 'none', cursor: 'pointer',
                            color: 'var(--text-2)', fontSize: 10,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: 0, flexShrink: 0, fontFamily: 'inherit',
                          }}
                        >×</button>
                      </div>

                      {/* Waveform bars */}
                      <div style={{
                        position: 'absolute', bottom: 6, left: 6, right: 6,
                        display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 30, overflow: 'hidden',
                      }}>
                        {Array.from({ length: bars }).map((_, j) => (
                          <div key={j} style={{
                            width: 3.5, borderRadius: 2, flexShrink: 0,
                            height: Math.round(waveBar(clip.scriptId, j) * 28) + 'px',
                            background: col + '99',
                          }} />
                        ))}
                      </div>

                      {/* Audio preview mini player (bottom-right, only if narrow enough) */}
                      {audioUrls[clip.scriptId] && clipW > 160 && (
                        <audio
                          src={audioUrls[clip.scriptId]}
                          style={{
                            position: 'absolute', bottom: 3, right: 4,
                            height: 18, width: Math.min(clipW - 50, 120),
                            accentColor: col,
                          }}
                          controls
                          onMouseDown={e => e.stopPropagation()}
                        />
                      )}
                    </div>
                  )
                })}

                {/* Playhead line in track */}
                <div style={{
                  position: 'absolute', left: playhead * zoom, top: 0, bottom: 0,
                  width: 2, background: 'var(--accent)', zIndex: 50, pointerEvents: 'none',
                  opacity: 0.7,
                }} />
              </div>

              {/* Second track row label */}
              <div style={{ padding: '4px 10px' }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Track 1 · Voiceover
                </span>
              </div>
            </div>
          </div>

          {/* Footer status bar */}
          <div style={S.footer}>
            {timelineClips.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No clips on timeline yet — drag from the library.</span>
            ) : (
              <>
                {[...timelineClips].sort((a, b) => a.start - b.start).map(clip => {
                  const col = CLIP_COLORS[clip.ci % CLIP_COLORS.length]
                  const lt = CLIP_LIGHTS[clip.ci % CLIP_LIGHTS.length]
                  return (
                    <span key={clip.id} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 99,
                      background: lt, color: col,
                      border: `1px solid ${col}44`,
                      whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 120,
                      textOverflow: 'ellipsis',
                    }}>
                      {clip.title.substring(0, 16)}
                    </span>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Voice Profiles ─────────────────────────────────────────────────
function ProfilesPage({ profiles, onRefresh }: { profiles: VoiceProfile[]; onRefresh: () => void }) {
  const recorder = useAudioRecorder()
  const [profileName, setProfileName] = useState('my-voice')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [gainVal, setGainVal] = useState(0.85)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('Hello, this is a preview of my voice profile.')
  const [previewing, setPreviewing] = useState(false)

  async function handleRecord() {
    if (recorder.recording) {
      setSaving(true); setMsg('')
      const blob = await recorder.stop()
      const fd = new FormData()
      fd.append('file', blob, 'voice.webm')
      fd.append('profile_id', profileName.trim() || 'my-voice')
      try {
        const res = await fetch(`${API}/voice-profile/save`, { method: 'POST', body: fd })
        const data = await res.json()
        if (data.success) { setMsg(`✓ Profile "${data.profile_id}" saved (${data.duration_seconds}s)`); onRefresh() }
        else setMsg('Failed to save.')
      } catch { setMsg('Connection error.') }
      finally { setSaving(false) }
    } else { setMsg(''); await recorder.start(noiseSuppression, gainVal) }
  }

  async function handleDelete(profile_id: string) {
    if (!confirm(`Delete profile "${profile_id}"?`)) return
    try {
      await fetch(`${API}/voice-profile/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile_id }) })
      onRefresh()
    } catch { alert('Delete failed.') }
  }

  async function handlePreview(profile_id: string) {
    setPreviewing(true); setPreviewId(profile_id)
    const fd = new FormData()
    fd.append('text', previewText); fd.append('profile_id', profile_id); fd.append('language', 'en')
    try {
      const res = await fetch(`${API}/synthesize`, { method: 'POST', body: fd })
      if (!res.ok) { alert('Preview failed'); return }
      const blob = await res.blob()
      const audio = new Audio(URL.createObjectURL(blob))
      audio.play()
    } catch { alert('Connection error.') }
    finally { setPreviewing(false); setPreviewId(null) }
  }

  return (
    <div>
      <div className="profiles-layout">
        <div>
          <div className="section-head"><div><h2>Record New Profile</h2><p>Capture your voice</p></div></div>
          <div className="record-studio">
            <WaveVisualiser active={recorder.recording} />
            {recorder.recording && <div className="timer">{fmt(recorder.seconds)}</div>}
            <div className="record-script">
              <div className="record-script__label">Read this aloud</div>
              <p className="record-script__text">"The quick brown fox jumps over the lazy dog. She sells seashells by the seashore."</p>
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
              <input className="text-input" value={profileName} onChange={e => setProfileName(e.target.value.replace(/[^a-z0-9-_]/gi, '-'))} disabled={recorder.recording} placeholder="my-voice" />
            </div>
            <MicBtn recording={recorder.recording} onClick={handleRecord} disabled={saving}
              label={saving ? 'Saving…' : recorder.recording ? 'Stop & Save' : 'Start Recording'} />
            {msg && <div className={`msg ${msg.startsWith('✓') ? 'msg--ok' : 'msg--err'}`}>{msg}</div>}
          </div>
        </div>

        <div>
          <div className="section-head"><div><h2>Saved Profiles</h2><p>{profiles.length} voice model{profiles.length !== 1 ? 's' : ''} ready</p></div></div>
          {profiles.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <input className="text-input" style={{ width: '100%' }} value={previewText} onChange={e => setPreviewText(e.target.value)} placeholder="Preview text…" />
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
                    <div className="profile-card__meta">Voice profile · Ready</div>
                  </div>
                  <button className="btn btn--sm btn--ghost"
                    onClick={() => handlePreview(vp.profile_id)}
                    disabled={previewing}
                    title="Preview voice"
                  >
                    {previewing && previewId === vp.profile_id ? <span className="spinner" /> : icons.speaker}
                  </button>
                  <button className="btn btn--sm btn--danger" onClick={() => handleDelete(vp.profile_id)} title="Delete">{icons.trash}</button>
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