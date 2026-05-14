import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { LandingPage } from './LandingPage'
import { SignInPage, SignUpPage } from './AuthPages'
import { SettingsPage } from './SettingsPage'
import { api, mapProject } from './api'
import { deleteAudioBlob, loadAudioRawBlob, audioBufferToWav, uid } from './audio'
import { icons } from './constants'
import { DashboardPage, ProjectsPage, ProfilesPage, NewProjectModal, ShortcutsModal } from './AppPages'
import { WorkspacePage } from './WorkspacePage'
import { AssemblyPage } from './AssemblyPage'
import type { Page, WorkspaceTab, Project, Script, TimelineClip, VoiceProfile } from './types'

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
  const [user, setUser] = useState<any>(null)
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

  useEffect(() => { checkUser() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      setPage(current =>
        ['landing', 'signin', 'signup'].includes(current) ? 'dashboard' : current
      )
    } catch {
      setUser(null)
      setPage(current =>
        !['landing', 'signin', 'signup'].includes(current) ? 'landing' : current
      )
    } finally {
      setAuthLoading(false)
    }
  }, [loadProjects])

  const loadProfiles = useCallback(() => {
    api.get('/voice-profiles').then(d => setVoiceProfiles(d || [])).catch(() => { })
  }, [])

  useEffect(() => { if (user) loadProfiles() }, [user])
  useEffect(() => { setSidebarOpen(false) }, [page, activeProjectId])

  // ── Project CRUD ──────────────────────────────────────────────────

  async function addProject(name: string, emoji: string, description: string) {
    const pId = uid()
    const p: Project = { id: pId, name, emoji, description, createdAt: new Date().toISOString(), scripts: [] }
    setProjects(prev => [p, ...prev])
    setActiveProjectId(p.id)
    setWorkspaceTab('scripts')
    setPage('workspace')
    try {
      await api.post('/projects', { id: pId, name, emoji, description })
    } catch (e) { console.error('Failed to save project', e) }
  }

  async function deleteProject(id: string) {
    const proj = projects.find(p => p.id === id)
    proj?.scripts.forEach(s => { if (s.hasAudio) deleteAudioBlob(`audio_${s.id}`) })
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) { setActiveProjectId(null); setPage('projects') }
    try {
      await api.delete(`/projects/${id}`)
    } catch (e) { console.error('Failed to delete project', e) }
  }

  async function updateProject(id: string, update: Partial<Project>) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...update } : p))
    try {
      await api.put(`/projects/${id}`, update)
    } catch (e) { console.error('Failed to update project', e) }
  }

  // ── Script CRUD ───────────────────────────────────────────────────

  async function addScript(projectId: string) {
    const proj = projects.find(p => p.id === projectId)
    const s: Script = {
      id: uid(), title: 'Untitled Script', content: '',
      hasAudio: false, profileId: null, language: 'en',
      duration: null, speed: 1.0,
    }
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: [...p.scripts, s] } : p
    ))
    setActiveScriptId(s.id)
    try {
      await api.post(`/projects/${projectId}/scripts`, {
        id: s.id, title: s.title, content: s.content,
        has_audio: false, profile_id: null, language: s.language,
        duration: null, speed: s.speed,
        order_index: proj?.scripts.length ?? 0,
      })
    } catch (e) { console.error('Failed to add script', e) }
  }

  async function updateScript(projectId: string, scriptId: string, update: Partial<Script>) {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, scripts: p.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s) }
        : p
    ))
    const payload: Record<string, any> = { project_id: projectId, script_id: scriptId }
    if ('title'         in update) payload.title          = update.title
    if ('content'       in update) payload.content        = update.content
    if ('hasAudio'      in update) payload.has_audio      = update.hasAudio
    if ('profileId'     in update) payload.profile_id     = update.profileId
    if ('language'      in update) payload.language       = update.language
    if ('duration'      in update) payload.duration       = update.duration
    if ('speed'         in update) payload.speed          = update.speed
    if ('waveformPeaks' in update) payload.waveform_peaks = update.waveformPeaks
    try {
      await api.post('/scripts/update', payload)
    } catch (e) { console.error('Failed to update script', e) }
  }

  async function deleteScript(projectId: string, scriptId: string) {
    deleteAudioBlob(`audio_${scriptId}`)
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts: p.scripts.filter(s => s.id !== scriptId) } : p
    ))
    setActiveScriptId(null)
    try {
      await api.delete(`/projects/${projectId}/scripts/${scriptId}`)
    } catch (e) { console.error('Failed to delete script', e) }
  }

  async function reorderScripts(projectId: string, scripts: Script[]) {
    updateProject(projectId, { scripts })
    try {
      const payload = scripts.map((s, i) => ({ id: s.id, order_index: i }))
      await api.post(`/projects/${projectId}/scripts/reorder`, { scripts: payload })
    } catch (e) { console.error('Failed to reorder scripts', e) }
  }

  function openProject(id: string) {
    setActiveProjectId(id)
    const proj = projects.find(p => p.id === id)
    setActiveScriptId(proj?.scripts[0]?.id ?? null)
    setWorkspaceTab('scripts'); setMergedUrl(null)
    setPage('workspace')
  }

  // ── Audio merge/export ────────────────────────────────────────────

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
        const durSamples  = Math.round(seg.dur * sr)
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

  async function exportProjectZip() {
    alert('ZIP export: Install JSZip (npm install jszip) and import it to enable ZIP export. Individual WAV files are already downloadable from the Assembly tab.')
  }

  async function signOut() {
    try { await api.post('/logout') } catch { /* ignore */ }
    setUser(null)
    setProjects([])
    setPage('landing')
  }

  // ── Nav config ────────────────────────────────────────────────────
  const navItems = [
    { key: 'dashboard' as Page, label: 'Dashboard',     icon: icons.dashboard },
    { key: 'projects'  as Page, label: 'Projects',      icon: icons.projects  },
    { key: 'profiles'  as Page, label: 'Voice Profiles', icon: icons.profiles  },
  ]

  // ── Auth loading guard ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  // ── Auth / Landing pages (outside main shell) ─────────────────────
  if (page === 'landing') return (
    <LandingPage onSignIn={() => setPage('signin')} onSignUp={() => setPage('signup')} />
  )

  if (page === 'signin') return (
    <SignInPage
      onSignIn={async (email, password) => { await api.post('/login', { email, password }); await checkUser() }}
      onSignUp={() => setPage('signup')}
      onBack={() => setPage('landing')}
    />
  )

  if (page === 'signup') return (
    <SignUpPage
      onSignUp={async (name, email, password) => { await api.post('/register', { name, email, password }); await checkUser() }}
      onSignIn={() => setPage('signin')}
      onBack={() => setPage('landing')}
    />
  )

  // ── Main app shell ────────────────────────────────────────────────
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
                {key === 'projects' && projects.length > 0     && <span className="nav-item__count">{projects.length}</span>}
                {key === 'profiles' && voiceProfiles.length > 0 && <span className="nav-item__count">{voiceProfiles.length}</span>}
              </button>
            ))}
            <button className={`nav-item ${page === 'settings' ? 'nav-item--active' : ''}`} onClick={() => setPage('settings')}>
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
          <button
            className="btn btn--ghost btn--sm"
            onClick={signOut}
            style={{ width: '100%', justifyContent: 'flex-start', gap: 8, color: 'var(--err)', borderColor: 'rgba(192,57,43,0.2)', marginBottom: 8, fontSize: 12.5 }}
            title="Sign out"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 14, height: 14, flexShrink: 0 }}>
              <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" />
              <path d="M13 14l4-4-4-4" />
              <line x1="17" y1="10" x2="7" y2="10" />
            </svg>
            Sign out
          </button>
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
          {page === 'projects' && (
            <button className="btn btn--primary btn--sm" onClick={() => setShowNewProject(true)}>{icons.plus}<span className="btn__label"> New Project</span></button>
          )}
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
          {page === 'dashboard' && (
            <DashboardPage
              projects={projects} voiceProfiles={voiceProfiles}
              onOpenProject={openProject} onGoProjects={() => setPage('projects')} onGoProfiles={() => setPage('profiles')}
            />
          )}
          {page === 'projects' && (
            <ProjectsPage projects={projects} onOpen={openProject} onDelete={deleteProject} onNew={() => setShowNewProject(true)} />
          )}
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
          {page === 'profiles' && (
            <ProfilesPage profiles={voiceProfiles} onRefresh={loadProfiles} />
          )}
          {page === 'settings' && (
            <SettingsPage
              darkMode={darkMode}
              onToggleDark={() => setDarkMode(v => !v)}
              onSignOut={signOut}
              user={user ? { name: user.name, email: user.email } : { name: '', email: '' }}
            />
          )}
          {page === 'workspace' && !activeProject && (
            <div className="empty-state">
              {icons.projects}
              <p>No project selected.</p>
              <button className="btn btn--primary" onClick={() => setPage('projects')}>Go to Projects</button>
            </div>
          )}
        </div>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreate={addProject} />}
      {showShortcuts  && <ShortcutsModal  onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}