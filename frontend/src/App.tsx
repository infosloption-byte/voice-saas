import { useState, useEffect, useRef, useCallback, useReducer } from 'react'
import './App.css'

const API = 'http://localhost:8000'

// ── Types ──────────────────────────────────────────────────────────
type Page = 'dashboard' | 'projects' | 'workspace' | 'profiles' | 'assembly'

interface Project {
  id: string
  name: string
  emoji: string
  description: string
  createdAt: string
  scripts: Script[]
}

interface Script {
  id: string
  title: string
  content: string
  audioUrl: string | null
  profileId: string | null
  duration: number | null
}

interface VoiceProfile {
  profile_id: string
  filename: string
  duration?: number
}

// ── History reducer for undo/redo ──────────────────────────────────
interface HistoryState { past: string[]; present: string; future: string[] }

function historyReducer(state: HistoryState, action: { type: 'SET' | 'UNDO' | 'REDO'; value?: string }): HistoryState {
  switch (action.type) {
    case 'SET': {
      if (action.value === state.present) return state
      return { past: [...state.past, state.present].slice(-50), present: action.value!, future: [] }
    }
    case 'UNDO': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future] }
    }
    case 'REDO': {
      if (!state.future.length) return state
      const next = state.future[0]
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) }
    }
    default: return state
  }
}

// ── useAudioRecorder ────────────────────────────────────────────────
function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  const start = useCallback(async (noiseSuppression = true, noiseGain = 0.8) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
        sampleRate: 44100,
        channelCount: 1,
      }
    })

    // Web Audio API noise gate
    const ctx = new AudioContext()
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const dest = ctx.createMediaStreamDestination()

    // High-pass filter to remove low-freq rumble
    const hpf = ctx.createBiquadFilter()
    hpf.type = 'highpass'
    hpf.frequency.value = 80

    // Dynamic compressor to even out volume
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 30
    comp.ratio.value = 12
    comp.attack.value = 0.003
    comp.release.value = 0.25

    // Gain for noise floor control
    const gain = ctx.createGain()
    gain.gain.value = noiseGain

    source.connect(hpf).connect(comp).connect(gain).connect(dest)

    streamRef.current = stream

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    recRef.current = new MediaRecorder(dest.stream, { mimeType })
    chunksRef.current = []
    recRef.current.ondataavailable = e => chunksRef.current.push(e.data)
    recRef.current.start(100)
    setRecording(true)
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }, [])

  const stop = useCallback((): Promise<Blob> => {
    return new Promise(resolve => {
      if (!recRef.current) return resolve(new Blob())
      recRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recRef.current?.mimeType || 'audio/webm' })
        resolve(blob)
        streamRef.current?.getTracks().forEach(t => t.stop())
        ctxRef.current?.close()
      }
      recRef.current.stop()
      if (timerRef.current) clearInterval(timerRef.current)
      setRecording(false)
    })
  }, [])

  return { recording, seconds, start, stop }
}

// ── WaveVisualiser ──────────────────────────────────────────────────
function WaveVisualiser({ active }: { active: boolean }) {
  return (
    <div className="wave-vis" aria-hidden>
      {Array.from({ length: 36 }).map((_, i) => (
        <span key={i} className={`bar ${active ? 'bar--live' : ''}`} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ── MicBtn ──────────────────────────────────────────────────────────
function MicBtn({ recording, onClick, disabled, label }: {
  recording: boolean; onClick: () => void; disabled?: boolean; label: string
}) {
  return (
    <button className={`mic-btn ${recording ? 'mic-btn--recording' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="mic-btn__ring" />
      <span className="mic-btn__ring mic-btn__ring--2" />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {recording
          ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
          : <><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></>
        }
      </svg>
      <span className="mic-btn__label">{label}</span>
    </button>
  )
}

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ── Sidebar icons ───────────────────────────────────────────────────
const icons = {
  dashboard: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/></svg>,
  projects:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h2l2 2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>,
  profiles:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M16 9v1a6 6 0 0 1-12 0V9"/><line x1="10" y1="16" x2="10" y2="19"/><line x1="7" y1="19" x2="13" y2="19"/></svg>,
  assembly:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="8" width="4" height="4" rx="1"/><rect x="8" y="8" width="4" height="4" rx="1"/><rect x="14" y="8" width="4" height="4" rx="1"/><path d="M4 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2"/><path d="M10 12v3"/></svg>,
  plus:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>,
  trash:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h12M8 6V4h4v2M7 6v10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6"/></svg>,
  edit:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11.5 5.5l3 3M4 14l1-4 8-8 3 3-8 8-4 1z"/></svg>,
  play:      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 5l9 5-9 5V5z"/></svg>,
  download:  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3v10m-4-4 4 4 4-4"/><path d="M4 17h12"/></svg>,
  undo:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9H14a4 4 0 0 1 0 8H10"/><path d="M4 9l3-3M4 9l3 3"/></svg>,
  redo:      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M16 9H6a4 4 0 0 0 0 8h4"/><path d="M16 9l-3-3m3 3l-3 3"/></svg>,
  merge:     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h4l8 8h4"/><path d="M4 14h4L10 10"/></svg>,
  drag:      <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="8" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="8" cy="14" r="1.2"/><circle cx="12" cy="14" r="1.2"/></svg>,
}

// ── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [engineStatus, setEngineStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [projects, setProjects] = useState<Project[]>(() => {
    try { return JSON.parse(localStorage.getItem('vo_projects') || '[]') } catch { return [] }
  })
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [assemblySelection, setAssemblySelection] = useState<Set<string>>(new Set())
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null
  const activeScript = activeProject?.scripts.find(s => s.id === activeScriptId) ?? null

  // Persist projects
  useEffect(() => {
    localStorage.setItem('vo_projects', JSON.stringify(projects))
  }, [projects])

  // Engine health
  useEffect(() => {
    fetch(`${API}/`).then(r => r.json()).then(() => setEngineStatus('online')).catch(() => setEngineStatus('offline'))
  }, [])

  // Load voice profiles
  const loadProfiles = useCallback(() => {
    fetch(`${API}/voice-profile/list`).then(r => r.json()).then(d => setVoiceProfiles(d.profiles || [])).catch(() => {})
  }, [])
  useEffect(() => { loadProfiles() }, [])

  // ── Project CRUD ─────────────────────────────────────────────────
  function addProject(name: string, emoji: string, description: string) {
    const p: Project = { id: uid(), name, emoji, description, createdAt: new Date().toISOString(), scripts: [] }
    setProjects(prev => [p, ...prev])
    setActiveProjectId(p.id)
    setPage('workspace')
  }

  function deleteProject(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) { setActiveProjectId(null); setPage('projects') }
  }

  function updateProject(id: string, update: Partial<Project>) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...update } : p))
  }

  // ── Script CRUD ──────────────────────────────────────────────────
  function addScript(projectId: string) {
    const s: Script = { id: uid(), title: 'Untitled Script', content: '', audioUrl: null, profileId: null, duration: null }
    updateProject(projectId, { scripts: [...(projects.find(p => p.id === projectId)?.scripts ?? []), s] })
    setActiveScriptId(s.id)
  }

  function updateScript(projectId: string, scriptId: string, update: Partial<Script>) {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, scripts: p.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s) }
        : p
    ))
  }

  function deleteScript(projectId: string, scriptId: string) {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: p.scripts.filter(s => s.id !== scriptId) } : p
    ))
    setActiveScriptId(null)
  }

  // ── Open workspace ────────────────────────────────────────────────
  function openProject(id: string) {
    setActiveProjectId(id)
    const proj = projects.find(p => p.id === id)
    setActiveScriptId(proj?.scripts[0]?.id ?? null)
    setPage('workspace')
  }

  // ── Merge audio (client-side via Web Audio) ───────────────────────
  async function mergeSelected() {
    const scripts = activeProject?.scripts.filter(s => assemblySelection.has(s.id) && s.audioUrl) ?? []
    if (!scripts.length) return
    setMerging(true)
    try {
      const ctx = new AudioContext()
      const buffers: AudioBuffer[] = []
      for (const s of scripts) {
        const res = await fetch(s.audioUrl!)
        const arr = await res.arrayBuffer()
        const buf = await ctx.decodeAudioData(arr)
        buffers.push(buf)
      }
      const totalLen = buffers.reduce((a, b) => a + b.length, 0)
      const merged = ctx.createBuffer(1, totalLen, buffers[0].sampleRate)
      let offset = 0
      for (const buf of buffers) {
        merged.copyToChannel(buf.getChannelData(0), 0, offset)
        offset += buf.length
      }
      // Encode to WAV
      const wav = audioBufferToWav(merged)
      const blob = new Blob([wav], { type: 'audio/wav' })
      setMergedUrl(URL.createObjectURL(blob))
    } catch {
      alert('Merge failed. Ensure all selected scripts have generated audio.')
    } finally {
      setMerging(false)
    }
  }

  // Minimal WAV encoder
  function audioBufferToWav(buf: AudioBuffer) {
    const numCh = 1, sr = buf.sampleRate, bps = 16
    const data = buf.getChannelData(0)
    const arrayBuf = new ArrayBuffer(44 + data.length * 2)
    const view = new DataView(arrayBuf)
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + data.length * 2, true); writeStr(8, 'WAVE')
    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true)
    view.setUint32(28, sr * numCh * bps / 8, true); view.setUint16(32, numCh * bps / 8, true)
    view.setUint16(34, bps, true); writeStr(36, 'data'); view.setUint32(40, data.length * 2, true)
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]))
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
    return arrayBuf
  }

  // ── Topbar breadcrumb ─────────────────────────────────────────────
  function topbarContent() {
    if (page === 'workspace' && activeProject) {
      return (
        <>
          <button className="btn btn--ghost btn--sm" onClick={() => setPage('projects')}>Projects</button>
          <span className="topbar__sep">›</span>
          <span className="topbar__title">{activeProject.emoji} {activeProject.name}</span>
        </>
      )
    }
    const labels: Record<Page, string> = {
      dashboard: 'Dashboard', projects: 'Projects', workspace: 'Workspace',
      profiles: 'Voice Profiles', assembly: 'Audio Assembly'
    }
    return <span className="topbar__title">{labels[page]}</span>
  }

  // ── Render pages ──────────────────────────────────────────────────
  return (
    <div className="shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar__logo">
          <div className="logo-mark">V</div>
          <span className="logo-name">VoiceStudio</span>
          <span className="logo-badge">AI</span>
        </div>

        <nav className="sidebar__nav">
          <div className="nav-section">
            <div className="nav-section__label">Main</div>
            {(['dashboard', 'projects', 'profiles', 'assembly'] as Page[]).map(p => (
              <button key={p} className={`nav-item ${page === p ? 'nav-item--active' : ''}`} onClick={() => setPage(p)}>
                {icons[p as keyof typeof icons]}
                {p.charAt(0).toUpperCase() + p.slice(1)}
                {p === 'projects' && projects.length > 0 && <span className="nav-item__count">{projects.length}</span>}
                {p === 'profiles' && voiceProfiles.length > 0 && <span className="nav-item__count">{voiceProfiles.length}</span>}
              </button>
            ))}
          </div>

          {projects.length > 0 && (
            <div className="nav-section">
              <div className="nav-section__label">Recent Projects</div>
              {projects.slice(0, 5).map(p => (
                <button key={p.id}
                  className={`nav-item ${activeProjectId === p.id && page === 'workspace' ? 'nav-item--active' : ''}`}
                  onClick={() => openProject(p.id)}
                >
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

      {/* Page */}
      <div className="page">
        <div className="topbar">
          {topbarContent()}
          <div className="topbar__spacer" />
          {page === 'projects' && (
            <button className="btn btn--primary" onClick={() => setShowNewProject(true)}>
              {icons.plus} New Project
            </button>
          )}
          {page === 'workspace' && activeProject && (
            <>
              <button className="btn" onClick={() => { addScript(activeProject.id) }}>
                {icons.plus} New Script
              </button>
              <button className="btn" onClick={() => { setPage('assembly') }}>
                {icons.merge} Assembly
              </button>
            </>
          )}
          {page === 'profiles' && (
            <button className="btn btn--primary" onClick={() => setPage('profiles')}>
              {icons.plus} New Profile
            </button>
          )}
        </div>

        <div className="content">
          {page === 'dashboard' && (
            <DashboardPage projects={projects} voiceProfiles={voiceProfiles} onOpenProject={openProject} onGoProjects={() => setPage('projects')} onGoProfiles={() => setPage('profiles')} />
          )}
          {page === 'projects' && (
            <ProjectsPage projects={projects} onOpen={openProject} onDelete={deleteProject} onNew={() => setShowNewProject(true)} />
          )}
          {page === 'workspace' && activeProject && (
            <WorkspacePage
              project={activeProject}
              activeScriptId={activeScriptId}
              setActiveScriptId={setActiveScriptId}
              onAddScript={() => addScript(activeProject.id)}
              onUpdateScript={(sid, upd) => updateScript(activeProject.id, sid, upd)}
              onDeleteScript={(sid) => deleteScript(activeProject.id, sid)}
              voiceProfiles={voiceProfiles}
            />
          )}
          {page === 'profiles' && (
            <ProfilesPage profiles={voiceProfiles} onRefresh={loadProfiles} />
          )}
          {page === 'assembly' && activeProject && (
            <AssemblyPage
              project={activeProject}
              selection={assemblySelection}
              setSelection={setAssemblySelection}
              mergedUrl={mergedUrl}
              merging={merging}
              onMerge={mergeSelected}
            />
          )}
          {page === 'workspace' && !activeProject && (
            <div className="empty-state">
              {icons.projects}
              <p>No project selected. Go to Projects to open one.</p>
              <button className="btn btn--primary" onClick={() => setPage('projects')}>Go to Projects</button>
            </div>
          )}
        </div>
      </div>

      {/* New project modal */}
      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} onCreate={addProject} />
      )}
    </div>
  )
}

// ── Dashboard ───────────────────────────────────────────────────────
function DashboardPage({ projects, voiceProfiles, onOpenProject, onGoProjects, onGoProfiles }: {
  projects: Project[]; voiceProfiles: VoiceProfile[]
  onOpenProject: (id: string) => void; onGoProjects: () => void; onGoProfiles: () => void
}) {
  const totalScripts = projects.reduce((a, p) => a + p.scripts.length, 0)
  const totalVoiceovers = projects.reduce((a, p) => a + p.scripts.filter(s => s.audioUrl).length, 0)
  const recent = projects.slice(0, 3)

  return (
    <div>
      <div className="dash-stats">
        <div className="stat-card">
          <div className="stat-card__label">{icons.projects} Projects</div>
          <div className="stat-card__value">{projects.length}</div>
          <div className="stat-card__sub">Total workspaces</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h8M2 12h5"/></svg>
            Scripts
          </div>
          <div className="stat-card__value">{totalScripts}</div>
          <div className="stat-card__sub">Across all projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{icons.play} Voiceovers</div>
          <div className="stat-card__value">{totalVoiceovers}</div>
          <div className="stat-card__sub">Generated audio files</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">{icons.profiles} Voice Profiles</div>
          <div className="stat-card__value">{voiceProfiles.length}</div>
          <div className="stat-card__sub">Cloned voice models</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div className="section-head">
            <div><h2>Recent Projects</h2></div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProjects}>View all</button>
          </div>
          {recent.length === 0
            ? <div className="empty-state" style={{ padding: '30px 0' }}>
                {icons.projects}<p>No projects yet</p>
                <button className="btn btn--primary btn--sm" onClick={onGoProjects}>Create first project</button>
              </div>
            : recent.map(p => (
              <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="project-card__icon">{p.emoji}</div>
                  <div>
                    <div className="project-card__name">{p.name}</div>
                    <div className="project-card__meta">{p.scripts.length} scripts · {p.scripts.filter(s => s.audioUrl).length} voiceovers</div>
                  </div>
                </div>
              </div>
            ))
          }
        </div>

        <div>
          <div className="section-head">
            <div><h2>Voice Profiles</h2></div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProfiles}>Manage</button>
          </div>
          {voiceProfiles.length === 0
            ? <div className="empty-state" style={{ padding: '30px 0' }}>
                {icons.profiles}<p>No voice profiles yet</p>
                <button className="btn btn--primary btn--sm" onClick={onGoProfiles}>Record a voice</button>
              </div>
            : voiceProfiles.slice(0, 4).map(vp => (
              <div key={vp.profile_id} className="project-card" style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>
                  {vp.profile_id[0].toUpperCase()}
                </div>
                <div style={{ marginLeft: 10 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{vp.profile_id}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Voice profile ready</div>
                </div>
                <span className="tag tag--ok" style={{ marginLeft: 'auto' }}>Ready</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Projects page ───────────────────────────────────────────────────
function ProjectsPage({ projects, onOpen, onDelete, onNew }: {
  projects: Project[]; onOpen: (id: string) => void
  onDelete: (id: string) => void; onNew: () => void
}) {
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 20 }}>
        <div><h2>All Projects</h2><p>Manage your YouTube voiceover workspaces</p></div>
      </div>
      <div className="project-grid">
        <div className="project-card project-card--new" onClick={onNew}>
          {icons.plus}<span>New Project</span>
        </div>
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
            <div className="project-card__meta">
              <span>{p.scripts.length} scripts</span>
              <span>{p.scripts.filter(s => s.audioUrl).length} with audio</span>
            </div>
            <div className="project-card__tags">
              <span className="tag">{new Date(p.createdAt).toLocaleDateString()}</span>
              {p.scripts.some(s => s.audioUrl) && <span className="tag tag--ok">Has Audio</span>}
              {p.scripts.length === 0 && <span className="tag tag--warn">Empty</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Workspace page ──────────────────────────────────────────────────
function WorkspacePage({ project, activeScriptId, setActiveScriptId, onAddScript, onUpdateScript, onDeleteScript, voiceProfiles }: {
  project: Project; activeScriptId: string | null; setActiveScriptId: (id: string | null) => void
  onAddScript: () => void; onUpdateScript: (id: string, upd: Partial<Script>) => void
  onDeleteScript: (id: string) => void; voiceProfiles: VoiceProfile[]
}) {
  const activeScript = project.scripts.find(s => s.id === activeScriptId) ?? null
  const [histState, dispatch] = useReducer(historyReducer, { past: [], present: activeScript?.content ?? '', future: [] })
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthErr, setSynthErr] = useState('')
  const prevScriptId = useRef<string | null>(null)

  // Sync history state when switching scripts
  useEffect(() => {
    if (activeScriptId !== prevScriptId.current) {
      dispatch({ type: 'SET', value: activeScript?.content ?? '' })
      prevScriptId.current = activeScriptId
    }
  }, [activeScriptId, activeScript?.content])

  // Debounced save
  useEffect(() => {
    if (!activeScript) return
    const t = setTimeout(() => { onUpdateScript(activeScript.id, { content: histState.present }) }, 400)
    return () => clearTimeout(t)
  }, [histState.present])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }) }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'REDO' }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function generateVoiceover() {
    if (!activeScript || !activeScript.content.trim()) { setSynthErr('Write some script content first.'); return }
    const pid = activeScript.profileId || voiceProfiles[0]?.profile_id
    if (!pid) { setSynthErr('No voice profile selected. Create one in Voice Profiles.'); return }
    setSynthesizing(true); setSynthErr('')
    const fd = new FormData()
    fd.append('text', activeScript.content.trim())
    fd.append('profile_id', pid)
    try {
      const res = await fetch(`${API}/synthesize`, { method: 'POST', body: fd })
      if (!res.ok) { const e = await res.json(); setSynthErr(e.detail || 'Synthesis failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      onUpdateScript(activeScript.id, { audioUrl: url, profileId: pid })
    } catch { setSynthErr('Connection error. Is the AI engine running?') }
    finally { setSynthesizing(false) }
  }

  const wordCount = histState.present.trim() ? histState.present.trim().split(/\s+/).length : 0

  return (
    <div className="workspace">
      {/* Script list */}
      <div className="script-panel">
        <div className="script-panel__head">
          <h3>Scripts ({project.scripts.length})</h3>
          <button className="btn btn--sm" onClick={onAddScript}>{icons.plus}</button>
        </div>
        <div className="script-list">
          {project.scripts.length === 0
            ? <div className="empty-state" style={{ padding: '24px 0' }}>
                {icons.edit}<p style={{ fontSize: 13 }}>No scripts yet</p>
                <button className="btn btn--sm btn--primary" onClick={onAddScript}>Add Script</button>
              </div>
            : project.scripts.map((s, i) => (
              <div key={s.id} className={`script-item ${s.id === activeScriptId ? 'script-item--active' : ''}`} onClick={() => setActiveScriptId(s.id)}>
                <div className="script-item__num">{i + 1}</div>
                <div className="script-item__body">
                  <div className="script-item__title">{s.title}</div>
                  <div className="script-item__meta">{s.content ? `${s.content.trim().split(/\s+/).length} words` : 'Empty'}</div>
                </div>
                <span className={`script-item__status ${s.audioUrl ? 'script-item__status--done' : s.content ? 'script-item__status--pending' : 'script-item__status--none'}`} />
              </div>
            ))
          }
        </div>
      </div>

      {/* Editor */}
      <div className="editor-panel">
        {!activeScript
          ? <div className="empty-state">{icons.edit}<p>Select a script or create a new one</p></div>
          : <>
            <div className="editor-toolbar">
              <input
                className="text-input"
                style={{ maxWidth: 220, flex: 'none' }}
                value={activeScript.title}
                onChange={e => onUpdateScript(activeScript.id, { title: e.target.value })}
                placeholder="Script title"
              />
              <div className="undo-redo">
                <button className="btn btn--sm btn--ghost" onClick={() => dispatch({ type: 'UNDO' })} disabled={!histState.past.length} title="Undo (Ctrl+Z)">{icons.undo}</button>
                <button className="btn btn--sm btn--ghost" onClick={() => dispatch({ type: 'REDO' })} disabled={!histState.future.length} title="Redo (Ctrl+Y)">{icons.redo}</button>
              </div>
              <div style={{ flex: 1 }} />
              <button className="btn btn--sm btn--danger" onClick={() => onDeleteScript(activeScript.id)}>{icons.trash}</button>
            </div>

            <div className="editor-body">
              <textarea
                className="script-textarea"
                value={histState.present}
                onChange={e => dispatch({ type: 'SET', value: e.target.value })}
                placeholder="Write your script here…"
              />
            </div>

            <div className="editor-footer">
              <span className="word-count">{wordCount} words · ~{Math.ceil(wordCount / 130)} min read</span>
              <div style={{ flex: 1 }} />

              {voiceProfiles.length > 0 && (
                <select
                  className="profile-select"
                  style={{ maxWidth: 160 }}
                  value={activeScript.profileId ?? voiceProfiles[0]?.profile_id ?? ''}
                  onChange={e => onUpdateScript(activeScript.id, { profileId: e.target.value })}
                >
                  {voiceProfiles.map(vp => <option key={vp.profile_id} value={vp.profile_id}>{vp.profile_id}</option>)}
                </select>
              )}

              <button className="btn btn--primary" onClick={generateVoiceover} disabled={synthesizing || !histState.present.trim()}>
                {synthesizing ? <><span className="spinner" /> Generating…</> : <>{icons.play} Generate Voiceover</>}
              </button>
            </div>

            {synthErr && <div className="msg msg--err" style={{ margin: '0 16px 12px' }}>{synthErr}</div>}

            {activeScript.audioUrl && (
              <div className="vo-audio-row" style={{ margin: '0 16px 16px' }}>
                <span style={{ fontSize: 12, color: 'var(--ok)', whiteSpace: 'nowrap' }}>✓ Voiceover ready</span>
                <audio src={activeScript.audioUrl} controls className="vo-audio-row" style={{ flex: 1, height: 32 }} />
                <a href={activeScript.audioUrl} download={`${activeScript.title}.wav`} className="btn btn--sm">{icons.download}</a>
              </div>
            )}
          </>
        }
      </div>
    </div>
  )
}

// ── Voice Profiles page ─────────────────────────────────────────────
function ProfilesPage({ profiles, onRefresh }: { profiles: VoiceProfile[]; onRefresh: () => void }) {
  const recorder = useAudioRecorder()
  const [profileName, setProfileName] = useState('my-voice')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [gainVal, setGainVal] = useState(0.85)

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
    } else {
      setMsg('')
      await recorder.start(noiseSuppression, gainVal)
    }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
        {/* Recording studio */}
        <div>
          <div className="section-head"><div><h2>Record New Profile</h2><p>Capture your voice with noise reduction</p></div></div>
          <div className="record-studio">
            <WaveVisualiser active={recorder.recording} />
            {recorder.recording && <div className="timer">{fmt(recorder.seconds)}</div>}

            <div className="record-script">
              <div className="record-script__label">Read this script aloud</div>
              <p className="record-script__text">
                "The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. How much wood would a woodchuck chuck if a woodchuck could chuck wood."
              </p>
            </div>

            <div className="noise-controls">
              <label className="noise-toggle">
                <input type="checkbox" checked={noiseSuppression} onChange={e => setNoiseSuppression(e.target.checked)} disabled={recorder.recording} />
                Browser noise suppression
              </label>
              <div className="noise-row">
                <label>Gain / clarity</label>
                <input type="range" min="0.1" max="2" step="0.05" value={gainVal}
                  onChange={e => setGainVal(Number(e.target.value))} disabled={recorder.recording} />
                <span>{gainVal.toFixed(2)}</span>
              </div>
              <div className="noise-row">
                <label>High-pass filter</label>
                <input type="range" min="60" max="200" step="10" defaultValue="80" disabled />
                <span>80Hz</span>
              </div>
            </div>

            <div className="input-row">
              <label>Profile name</label>
              <input className="text-input" value={profileName}
                onChange={e => setProfileName(e.target.value.replace(/[^a-z0-9-_]/gi, '-'))}
                disabled={recorder.recording} placeholder="my-voice" />
            </div>

            <MicBtn
              recording={recorder.recording}
              onClick={handleRecord}
              disabled={saving}
              label={saving ? 'Saving…' : recorder.recording ? 'Stop & Save' : 'Start Recording'}
            />

            {msg && <div className={`msg ${msg.startsWith('✓') ? 'msg--ok' : 'msg--err'}`}>{msg}</div>}

            <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
              Tip: Record 15–30 seconds in a quiet room.<br />The AI engine processes and cleans the audio server-side.
            </p>
          </div>
        </div>

        {/* Profiles list */}
        <div>
          <div className="section-head"><div><h2>Saved Profiles</h2><p>{profiles.length} voice model{profiles.length !== 1 ? 's' : ''} ready</p></div></div>
          <div className="profiles-grid" style={{ gridTemplateColumns: '1fr' }}>
            {profiles.length === 0
              ? <div className="empty-state">{icons.profiles}<p>Record your first voice profile</p></div>
              : profiles.map(vp => (
                <div key={vp.profile_id} className="profile-card">
                  <div className="profile-card__head">
                    <div className="profile-avatar">{vp.profile_id[0].toUpperCase()}</div>
                    <div>
                      <div className="profile-card__name">{vp.profile_id}</div>
                      <div className="profile-card__meta">Voice profile · Ready to use</div>
                    </div>
                    <span className="tag tag--ok" style={{ marginLeft: 'auto' }}>Active</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Assembly page ───────────────────────────────────────────────────
function AssemblyPage({ project, selection, setSelection, mergedUrl, merging, onMerge }: {
  project: Project; selection: Set<string>; setSelection: (s: Set<string>) => void
  mergedUrl: string | null; merging: boolean; onMerge: () => void
}) {
  const withAudio = project.scripts.filter(s => s.audioUrl)

  function toggle(id: string) {
    const next = new Set(selection)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelection(next)
  }

  function selectAll() { setSelection(new Set(withAudio.map(s => s.id))) }
  function clearAll() { setSelection(new Set()) }

  return (
    <div className="assembly">
      <div className="section-head">
        <div>
          <h2>Audio Assembly — {project.emoji} {project.name}</h2>
          <p>Select voiceovers to merge into one final audio file</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--sm btn--ghost" onClick={selectAll}>Select all</button>
          <button className="btn btn--sm btn--ghost" onClick={clearAll}>Clear</button>
        </div>
      </div>

      {withAudio.length === 0
        ? <div className="empty-state">
            {icons.merge}
            <p>No voiceovers yet. Go to the workspace to generate audio for your scripts.</p>
          </div>
        : <>
          <div className="assembly-list">
            {project.scripts.map((s, i) => (
              <div key={s.id} className={`assembly-item ${!s.audioUrl ? 'assembly-item--disabled' : ''}`}
                style={{ opacity: s.audioUrl ? 1 : 0.35 }}>
                <div className="assembly-item__drag">{icons.drag}</div>
                <div className="assembly-item__check">
                  <input type="checkbox" checked={selection.has(s.id)} disabled={!s.audioUrl}
                    onChange={() => toggle(s.id)} />
                </div>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-3)', flexShrink: 0 }}>{i + 1}</div>
                <div className="assembly-item__name">{s.title}</div>
                {s.audioUrl && <audio src={s.audioUrl} controls style={{ height: 28, width: 200, accentColor: 'var(--accent)' }} />}
                {!s.audioUrl && <span className="tag tag--warn">No audio</span>}
                <div className="assembly-item__dur">
                  {s.content ? `~${Math.ceil(s.content.split(/\s+/).length / 130)}m` : '—'}
                </div>
              </div>
            ))}
          </div>

          <div className="assembly-actions">
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              {selection.size} of {withAudio.length} files selected
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn btn--primary" onClick={onMerge} disabled={selection.size < 2 || merging}>
              {merging ? <><span className="spinner" /> Merging…</> : <>{icons.merge} Merge Selected</>}
            </button>
          </div>

          {mergedUrl && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 6 }}>
                ✓ Final Audio Ready
              </div>
              <audio src={mergedUrl} controls style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <a href={mergedUrl} download={`${project.name.replace(/\s+/g, '-')}-final.wav`} className="btn" style={{ alignSelf: 'flex-start' }}>
                {icons.download} Download Final WAV
              </a>
            </div>
          )}
        </>
      }
    </div>
  )
}

// ── New Project Modal ───────────────────────────────────────────────
const EMOJIS = ['🎬', '🎙', '📹', '🎤', '🎵', '📺', '🌟', '🚀', '💡', '🎯', '📚', '🎧']

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, emoji: string, desc: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [emoji, setEmoji] = useState('🎬')

  function submit() {
    if (!name.trim()) return
    onCreate(name.trim(), emoji, desc.trim())
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__title">New Project</div>
        <div className="modal__body">
          <div className="field">
            <label>Project icon</label>
            <div className="emoji-row">
              {EMOJIS.map(e => (
                <button key={e} className={`emoji-opt ${emoji === e ? 'emoji-opt--active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Project name</label>
            <input className="full-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My YouTube Series Episode 5" autoFocus onKeyDown={e => e.key === 'Enter' && submit()} />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <input className="full-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this project about?" />
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