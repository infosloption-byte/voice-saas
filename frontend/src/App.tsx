import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import './App.css'
import { LandingPage } from './LandingPage'
import { SignInPage, SignUpPage, ForgotPasswordPage, ResetPasswordPage } from './AuthPages'
import { SettingsPage } from './SettingsPage'
import { PrivacyPage, TermsPage } from './LegalPages'
import { PricingPage } from './PricingPage'
import { EmailVerifiedPage } from './EmailVerifiedPage'
import { api } from './api'
import { toast, subscribeToast, type ToastItem } from './toast'
import { useAuth } from './hooks/useAuth'
import { useProjects, notifyPlanLimit } from './hooks/useProjects'
import { useAudio } from './hooks/useAudio'
import { useGuestSession, type GateType } from './hooks/useGuestSession'
import { useGuestProject } from './hooks/useGuestProject'
import { useGuestVoiceProfiles } from './hooks/useGuestVoiceProfiles'
import { useGuestLimits } from './hooks/useGuestLimits'
import { GuestBanner } from './GuestBanner'
import { GuestUpgradeModal } from './GuestUpgradeModal'
import { icons } from './constants'
import { loadAudioRawBlob, saveAudioBlob, uid } from './audio'
import {
  DashboardPage, ProjectsPage, ProfilesPage,
  NewProjectModal, ShortcutsModal,
} from './AppPages'
import { WorkspacePage } from './WorkspacePage'
import { AssemblyPage } from './AssemblyPage'
import type { Page, WorkspaceTab, VoiceProfile, EngineStatus, EngineCaps } from './types'

// ── Cookie consent ────────────────────────────────────────────────
const COOKIE_KEY = 'vs_cookie_consent'
function CookieConsent({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9998, maxWidth: 560, width: 'calc(100% - 32px)',
      background: 'var(--surface)', border: '1px solid var(--border-2)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
      animation: 'modal-in 0.2s ease',
    }}>
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
        VoiceStudio uses essential cookies for authentication and your preferences.
        No advertising or tracking cookies are used.{' '}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="btn btn--ghost btn--sm" onClick={onDecline} style={{ fontSize: 12 }}>Decline</button>
        <button className="btn btn--primary btn--sm" onClick={onAccept} style={{ fontSize: 12 }}>Accept</button>
      </div>
    </div>
  )
}

// ── Email verification banner ─────────────────────────────────────
function VerificationBanner({ email, onResent }: { email: string; onResent: () => void }) {
  const [sending, setSending] = useState(false)
  async function resend() {
    setSending(true)
    try {
      await api.post('/email/verify/resend', {})
      toast.ok('Verification email sent to ' + email)
      onResent()
    } catch {
      toast.err('Failed to resend — try again in a minute')
    } finally { setSending(false) }
  }
  return (
    <div style={{
      background: 'var(--warn-lt)', borderBottom: '1px solid rgba(160,117,48,0.25)',
      padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10,
      fontSize: 12.5, color: 'var(--text-1)',
    }}>
      <span style={{ color: 'var(--warn)', width: 14, height: 14, flexShrink: 0 }}>{icons.mail}</span>
      <span style={{ flex: 1 }}>
        Please verify your email address. Check your inbox at <strong>{email}</strong>.
      </span>
      <button
        className="btn btn--ghost btn--sm"
        onClick={resend}
        disabled={sending}
        style={{ fontSize: 12, flexShrink: 0 }}
      >
        {sending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Resend email'}
      </button>
    </div>
  )
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => subscribeToast(t => {
    setToasts(prev => [...prev, t])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000)
  }), [])

  if (!toasts.length) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      maxWidth: 380, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} className={`msg msg--${t.kind}`} style={{
          pointerEvents: 'all', animation: 'modal-in 0.2s ease',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <span style={{ flex: 1, fontSize: 13 }}>{t.msg}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'inherit', opacity: 0.5, padding: '0 2px', lineHeight: 1, fontSize: 16 }}
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  // ── URL params (password reset, email verification) ────────────────
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '')
  const [resetEmail] = useState(() => new URLSearchParams(window.location.search).get('email') ?? '')

  const [page, setPage] = useState<Page>(() => {
    if (window.location.pathname === '/email-verified') return 'email-verified'
    if (new URLSearchParams(window.location.search).get('token')) return 'reset-password'
    return 'landing'
  })
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('scripts')
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('checking')
  // Per-engine availability reported by GET /
  const [engineCaps, setEngineCaps] = useState<EngineCaps>({ xtts: false, f5: false })
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('vo_dark')
    if (saved !== null) return saved === 'true'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [cookieConsent, setCookieConsent] = useState<boolean | null>(() => {
    const v = localStorage.getItem(COOKIE_KEY)
    return v === null ? null : v === 'true'
  })
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === '1'
  )

  const collapseSidebar = () => {
    setSidebarCollapsed(true)
    setSidebarOpen(false)
    localStorage.setItem('sidebar-collapsed', '1')
  }
  const expandSidebar = () => {
    setSidebarCollapsed(false)
    localStorage.setItem('sidebar-collapsed', '0')
  }

  const { user, loading: authLoading, checkUser, signIn, signUp, signOut: authSignOut } = useAuth()
  const {
    projects, loadProjects,
    addProject: addProjectBase,
    updateProject, deleteProject,
    addScript: addScriptBase,
    updateScript, deleteScript, reorderScripts,
    saveTimeline,
    uploadAudio,
    saveLaneConfig,
  } = useProjects()
  const { mergedUrl, mergedBlob, merging, mergeError, mergeSelected, resetMerge, exportZip } = useAudio()

  // ── Guest mode ────────────────────────────────────────────────────
  const [guestMode, setGuestMode]         = useState(false)
  const [guestGateType, setGuestGateType] = useState<GateType | null>(null)

  const guestLimits   = useGuestLimits()
  const guestSession  = useGuestSession()
  const guestProject  = useGuestProject(guestSession.session, guestLimits.script_limit)
  const guestProfiles = useGuestVoiceProfiles(guestSession.session, guestLimits.profile_limit)

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  // ── Dark mode ─────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('vo_dark', String(darkMode))
  }, [darkMode])

  // ── Bootstrap ─────────────────────────────────────────────────────
  useEffect(() => {


    if (resetToken) return // Don't auto-navigate when handling password reset

    checkUser().then(userData => {
      if (userData) {
        loadProjects()
        setPage('dashboard')
      } else if (guestSession.session) {
        // Resume existing valid guest session
        setGuestMode(true)
        const proj = guestProject.ensureProject(guestSession.session)
        setActiveProjectId(proj.id)
        setActiveScriptId(proj.scripts[0]?.id ?? null)
        setPage('workspace')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Engine status + capability probe ─────────────────────────────
  const checkEngine = useCallback(() => {
    api.get('/')
      .then((data: unknown) => {
        setEngineStatus('online')
        const d = data as Record<string, unknown>
        const engines = (d?.engines ?? {}) as Partial<EngineCaps>
        setEngineCaps({
          xtts: engines.xtts === true,
          f5:   engines.f5   === true,
        })
      })
      .catch(() => {
        setEngineStatus('offline')
        setEngineCaps({ xtts: false, f5: false })
      })
  }, [])

  // Initial probe on mount
  useEffect(() => { checkEngine() }, [checkEngine])

  // Re-probe every 30 s while offline so the indicator auto-recovers
  useEffect(() => {
    if (engineStatus !== 'offline') return
    const id = setInterval(checkEngine, 30_000)
    return () => clearInterval(id)
  }, [engineStatus, checkEngine])

  // ── Audio hydration ───────────────────────────────────────────────
  const hydratedAudioRef = useRef<Set<string>>(new Set())

  // Signature of every script that currently has server-backed audio. Changes
  // whenever a script gains/loses audio anywhere (not just when the count
  // changes), so cross-device additions are picked up.
  const audioHydrationKey = useMemo(
    () => projects
      .flatMap(p => p.scripts)
      .filter(s => s.hasAudio && s.audioUrl)
      .map(s => s.id)
      .join(','),
    [projects],
  )

  // Hydrate audio blobs from backend for scripts where IndexedDB was cleared
  useEffect(() => {
    if (!user || !projects.length) return
    projects.forEach(p => {
      p.scripts.forEach(async s => {
        if (!s.hasAudio || !s.audioUrl || hydratedAudioRef.current.has(s.id)) return
        const existing = await loadAudioRawBlob(`audio_${s.id}`)
        if (existing) { hydratedAudioRef.current.add(s.id); return } // already in IndexedDB
        try {
          const blob = await api.get(`/scripts/${s.id}/audio`) as Blob
          if (blob instanceof Blob) {
            await saveAudioBlob(`audio_${s.id}`, blob)
            hydratedAudioRef.current.add(s.id) // only mark done on success
          }
        } catch { /* non-critical; retried on next change; user can re-synthesize */ }
      })
    })
  }, [user?.id, audioHydrationKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice profiles ────────────────────────────────────────────────
  const loadProfiles = useCallback(() => {
    api.get('/voice-profiles')
      .then(d => setVoiceProfiles((d as VoiceProfile[]) || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (user) loadProfiles()
  }, [user, loadProfiles])

  // Close sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false)
  }, [page, activeProjectId])

  // ── Guest actions ─────────────────────────────────────────────────

  function enterGuestMode() {
    const sess = guestSession.session ?? guestSession.initSession(guestLimits.session_days)
    setGuestMode(true)
    // Pass sess directly so ensureProject can write to localStorage even
    // before the React state update for guestSession propagates.
    const proj = guestProject.ensureProject(sess)
    setActiveProjectId(proj.id)
    setActiveScriptId(proj.scripts[0]?.id ?? null)
    setPage('workspace')
  }

  async function migrateGuestData() {
    const proj = guestProject.project
    try {
      if (proj) {
        const newProj = await addProjectBase(proj.name, proj.emoji, proj.description || '')
        for (let i = 0; i < proj.scripts.length; i++) {
          const s = proj.scripts[i]
          await api.post(`/projects/${newProj.id}/scripts`, {
            id: uid(), title: s.title, content: s.content,
            has_audio: false, profile_id: null,
            language: s.language, duration: null,
            speed: s.speed, order_index: i,
          })
        }
        setActiveProjectId(newProj.id)
      }
    } catch (e) {
      console.error('[Guest migration] project failed:', e)
    }

    for (const vp of guestProfiles.profiles) {
      try {
        const blob = await loadAudioRawBlob(`guest_voice_${vp.profile_id}`)
        if (!blob) continue
        const fd = new FormData()
        fd.append('file', blob, 'voice.wav')
        fd.append('profile_id', vp.profile_id)
        fd.append('name', vp.name)
        fd.append('status', 'ready')
        await api.post('/voice-profiles', fd)
      } catch (e) {
        console.error('[Guest migration] profile failed:', vp.profile_id, e)
      }
    }

    guestSession.clearSession()
    guestProject.clearProject()
    guestProfiles.clearProfiles()
    setGuestMode(false)
    toast.ok('Your guest project has been saved to your account!')
  }

  // ── Actions ───────────────────────────────────────────────────────

  async function addProject(name: string, emoji: string, description: string) {
    try {
      const project = await addProjectBase(name, emoji, description)
      setActiveProjectId(project.id)
      setWorkspaceTab('scripts')
      setPage('workspace')
    } catch (e) {
      // Plan-limit errors get a clean upgrade message; everything else is generic.
      if (!notifyPlanLimit(e)) {
        toast.err('Failed to create project: ' + (e instanceof Error ? e.message : 'Unknown error'))
      }
    }
  }

  async function handleDeleteProject(id: string) {
    await deleteProject(id)
    if (activeProjectId === id) {
      setActiveProjectId(null)
      setPage('projects')
    }
  }

  async function addScript(projectId: string, template?: { title?: string; content?: string }) {
    const script = await addScriptBase(projectId, template)
    if (script) setActiveScriptId(script.id)
  }

  function openProject(id: string) {
    setActiveProjectId(id)
    const proj = projects.find(p => p.id === id)
    setActiveScriptId(proj?.scripts[0]?.id ?? null)
    setWorkspaceTab('scripts')
    resetMerge()
    setPage('workspace')
  }

  async function signOut() {
    await authSignOut()
    setActiveProjectId(null)
    setActiveScriptId(null)
    setGuestMode(false)
    setGuestGateType(null)
    setPage('landing')
  }

  // ── Auth loading guard ────────────────────────────────────────────
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

  // ── Public pages ──────────────────────────────────────────────────
  if (page === 'email-verified') return (
    <EmailVerifiedPage onGoToLogin={() => {
      window.history.replaceState({}, '', '/')
      setPage('signin')
    }} />
  )

  if (page === 'landing') return (
    <>
      <LandingPage
        onSignIn={() => setPage('signin')}
        onSignUp={() => setPage('signup')}
        onTryNow={enterGuestMode}
      />
      {cookieConsent === null && (
        <CookieConsent
          onAccept={() => { localStorage.setItem(COOKIE_KEY, 'true');  setCookieConsent(true) }}
          onDecline={() => { localStorage.setItem(COOKIE_KEY, 'false'); setCookieConsent(false) }}
        />
      )}
    </>
  )

  if (page === 'signin') return (
    <SignInPage
      onSignIn={async (email, password) => {
        await signIn(email, password)
        if (guestMode) await migrateGuestData()
        await loadProjects()
        setPage('dashboard')
      }}
      onSignUp={() => setPage('signup')}
      onBack={() => setPage('landing')}
      onForgotPassword={() => setPage('forgot-password')}
    />
  )

  if (page === 'signup') return (
    <SignUpPage
      onSignUp={async (name, email, password) => {
        await signUp(name, email, password)
        if (guestMode) await migrateGuestData()
        await loadProjects()
        setPage('dashboard')
      }}
      onSignIn={() => setPage('signin')}
      onBack={() => setPage('landing')}
      onTerms={() => setPage('terms')}
      onPrivacy={() => setPage('privacy')}
    />
  )

  if (page === 'forgot-password') return (
    <ForgotPasswordPage onBack={() => setPage('signin')} />
  )

  if (page === 'reset-password') return (
    <ResetPasswordPage
      token={resetToken}
      email={resetEmail}
      onSuccess={() => { toast.ok('Password reset! Please sign in.'); setPage('signin') }}
      onBack={() => setPage('signin')}
    />
  )

  if (page === 'privacy') return (
    <PrivacyPage onBack={() => setPage(user ? 'settings' : 'landing')} />
  )

  if (page === 'terms') return (
    <TermsPage onBack={() => setPage(user ? 'settings' : 'landing')} />
  )

  if (page === 'pricing') return (
    <PricingPage
      user={user}
      onBack={() => setPage(user ? 'settings' : 'landing')}
      onSignUp={() => setPage('signup')}
      onSubscribed={async () => { await checkUser(); setPage('settings') }}
    />
  )

  // ── Nav items ─────────────────────────────────────────────────────
  const navItems: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard',      icon: icons.dashboard },
    { key: 'projects',  label: 'Projects',        icon: icons.projects  },
    { key: 'profiles',  label: 'Voice Profiles',  icon: icons.profiles  },
  ]

  // ── Engine pill label ─────────────────────────────────────────────
  const enginePillLabel =
    engineStatus === 'checking'
      ? 'Connecting…'
      : engineStatus === 'offline'
        ? 'Engine Offline'
        : engineCaps.xtts && engineCaps.f5
          ? 'XTTS + F5-TTS Online'
          : engineCaps.xtts
            ? 'XTTS v2 Online'
            : 'Engine Online'

  // ── Main app shell ────────────────────────────────────────────────
  return (
    <div className={`shell${sidebarCollapsed ? ' shell--sidebar-collapsed' : ''}`}>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__logo">
          <div className="logo-mark" onClick={expandSidebar} style={{ cursor: 'pointer' }} title="VoiceStudio">V</div>
          <span className="logo-name">VoiceStudio</span>
          <span className="logo-badge">AI</span>
          <button
            className="sidebar__close btn btn--ghost btn--sm"
            onClick={collapseSidebar}
            title="Collapse sidebar"
          >
            {icons.close}
          </button>
        </div>

        <nav className="sidebar__nav">
          <div className="nav-section">
            <div className="nav-section__label">Main</div>
            {navItems.map(({ key, label, icon }) => (
              <button
                key={key}
                className={`nav-item ${page === key ? 'nav-item--active' : ''}`}
                onClick={() => setPage(key)}
                title={label}
              >
                {icon}
                {label}
                {key === 'projects' && projects.length > 0 && (
                  <span className="nav-item__count">{projects.length}</span>
                )}
                {key === 'profiles' && voiceProfiles.length > 0 && (
                  <span className="nav-item__count">{voiceProfiles.length}</span>
                )}
              </button>
            ))}
            <button
              className={`nav-item ${page === 'settings' ? 'nav-item--active' : ''}`}
              onClick={() => setPage('settings')}
            >
              {icons.light} Settings
            </button>
          </div>

          {(guestMode ? guestProject.project != null : projects.length > 0) && (
            <div className="nav-section">
              <div className="nav-section__label">Recent Projects</div>
              {guestMode && guestProject.project ? (
                <button
                  className={`nav-item ${page === 'workspace' ? 'nav-item--active' : ''}`}
                  onClick={() => setPage('workspace')}
                >
                  <span style={{ fontSize: 15 }}>{guestProject.project!.emoji}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {guestProject.project!.name}
                  </span>
                </button>
              ) : (
                projects.slice(0, 5).map(p => (
                  <button
                    key={p.id}
                    className={`nav-item ${activeProjectId === p.id && page === 'workspace' ? 'nav-item--active' : ''}`}
                    onClick={() => openProject(p.id)}
                  >
                    <span style={{ fontSize: 15 }}>{p.emoji}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </nav>

        <div className="sidebar__bottom">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {icons.keyboard}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setDarkMode(d => !d)}
              title="Toggle dark mode"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {darkMode ? icons.light : icons.dark}
            </button>
          </div>

          {!guestMode && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={signOut}
              style={{
                width: '100%', justifyContent: 'flex-start', gap: 8,
                color: 'var(--err)', borderColor: 'rgba(192,57,43,0.2)',
                marginBottom: 8, fontSize: 12.5,
              }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
                style={{ width: 14, height: 14, flexShrink: 0 }}>
                <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" />
                <path d="M13 14l4-4-4-4" />
                <line x1="17" y1="10" x2="7" y2="10" />
              </svg>
              Sign out
            </button>
          )}

          <div className={`engine-pill engine-pill--${engineStatus}`}>
            <span className="engine-pill__dot" />
            {enginePillLabel}
          </div>
        </div>
      </aside>

      <div className="page">
        {/* Email verification banner */}
        {user && !guestMode && !user.email_verified_at && (
          <VerificationBanner email={user.email} onResent={() => {}} />
        )}

        {/* Guest session countdown banner */}
        {guestMode && (
          <GuestBanner
            daysRemaining={guestSession.daysRemaining}
            hoursRemaining={guestSession.hoursRemaining}
            onSignUp={() => setPage('signup')}
            onSignIn={() => setPage('signin')}
          />
        )}

        {/* Topbar */}
        <div className="topbar">
          <button
            className="btn btn--ghost btn--sm topbar__hamburger"
            onClick={() => { expandSidebar(); setSidebarOpen(true) }}
            title="Open sidebar"
          >
            {icons.menu}
          </button>

          <div className="topbar__brand" onClick={() => setPage('dashboard')}>
            <div className="logo-mark">V</div>
            <span className="logo-name">VoiceStudio</span>
          </div>

          {page === 'workspace' && (activeProject || (guestMode && guestProject.project)) ? (() => {
            const p = guestMode ? guestProject.project! : activeProject!
            return (
              <>
                {!guestMode && (
                  <button className="btn btn--ghost btn--sm" onClick={() => setPage('projects')}>
                    {icons.back}
                    <span className="topbar__back-label">Projects</span>
                  </button>
                )}
                {!guestMode && <span className="topbar__sep">›</span>}
                <span className="topbar__title topbar__title--project">
                  {p.emoji} {p.name}
                </span>
              </>
            )
          })() : (
            <span className="topbar__title">
              {page === 'dashboard'  ? 'Dashboard'
                : page === 'projects'  ? 'Projects'
                : page === 'profiles'  ? 'Voice Profiles'
                : page === 'settings'  ? 'Settings'
                : ''}
            </span>
          )}

          <div className="topbar__spacer" />

          {page === 'projects' && (
            <button className="btn btn--primary btn--sm" onClick={() => setShowNewProject(true)}>
              {icons.plus}<span className="btn__label"> New Project</span>
            </button>
          )}
          {page === 'workspace' && (activeProject || guestMode) && (() => {
            const p = guestMode ? guestProject.project : activeProject
            if (!p) return null
            return (
              <>
                <button className="btn btn--sm" onClick={() => {
                  if (guestMode) {
                    const s = guestProject.addScript()
                    if (!s) setGuestGateType('script_limit')
                    else setActiveScriptId(s.id)
                  } else {
                    addScript(p.id)
                  }
                }}>
                  {icons.plus}<span className="btn__label"> Script</span>
                </button>
                {!guestMode && (
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => exportZip(p.scripts, p.name)}
                    title="Export all audio clips as ZIP"
                  >
                    {icons.zip}
                  </button>
                )}
              </>
            )
          })()}
        </div>

        {/* Workspace tabs */}
        {page === 'workspace' && (activeProject || (guestMode && guestProject.project)) && (() => {
          const tabProject = guestMode ? guestProject.project! : activeProject!
          return (
            <div className="workspace-tabs">
              <button
                className={`workspace-tab ${workspaceTab === 'scripts' ? 'workspace-tab--active' : ''}`}
                onClick={() => setWorkspaceTab('scripts')}
              >
                {icons.scripts} Scripts
                <span className="workspace-tab__count">{tabProject.scripts.length}</span>
              </button>
              <button
                className={`workspace-tab ${workspaceTab === 'assembly' ? 'workspace-tab--active' : ''}`}
                onClick={() => setWorkspaceTab('assembly')}
              >
                {icons.assembly} Assembly
                <span className="workspace-tab__count">
                  {tabProject.scripts.filter(s => s.hasAudio).length}
                </span>
              </button>
            </div>
          )
        })()}

        {/* Page content */}
        <div className={workspaceTab === 'assembly' && page === 'workspace' ? '' : 'content'}>
          {page === 'dashboard' && (
            <DashboardPage
              projects={guestMode && guestProject.project ? [guestProject.project] : projects}
              voiceProfiles={guestMode ? guestProfiles.asVoiceProfiles : voiceProfiles}
              onOpenProject={guestMode ? () => setPage('workspace') : openProject}
              onGoProjects={() => setPage('projects')}
              onGoProfiles={() => setPage('profiles')}
            />
          )}

          {page === 'projects' && (
            <ProjectsPage
              projects={guestMode && guestProject.project ? [guestProject.project] : projects}
              onOpen={guestMode ? () => setPage('workspace') : openProject}
              onDelete={guestMode ? () => {} : handleDeleteProject}
              onNew={guestMode ? () => setGuestGateType('script_limit') : () => setShowNewProject(true)}
            />
          )}

          {page === 'workspace' && workspaceTab === 'scripts' && (() => {
            const wsProject = guestMode ? guestProject.project : activeProject
            if (!wsProject) return null
            const wsProfiles = guestMode ? guestProfiles.asVoiceProfiles : voiceProfiles
            return (
              <WorkspacePage
                project={wsProject}
                activeScriptId={activeScriptId}
                setActiveScriptId={setActiveScriptId}
                onAddScript={tpl => {
                  if (guestMode) {
                    const s = guestProject.addScript(tpl)
                    if (!s) { setGuestGateType('script_limit'); return }
                    setActiveScriptId(s.id)
                  } else {
                    addScript(wsProject.id, tpl)
                  }
                }}
                onUpdateScript={(sid, upd) => {
                  if (guestMode) guestProject.updateScript(sid, upd)
                  else updateScript(wsProject.id, sid, upd)
                }}
                onDeleteScript={sid => {
                  if (guestMode) guestProject.deleteScript(sid)
                  else deleteScript(wsProject.id, sid)
                }}
                onReorder={scripts => {
                  if (guestMode) guestProject.reorderScripts(scripts)
                  else reorderScripts(wsProject.id, scripts)
                }}
                voiceProfiles={wsProfiles}
                engineCaps={engineCaps}
                onRecheckEngine={checkEngine}
                isGuest={guestMode}
                guestUsage={guestSession.session?.usage}
                guestLimits={guestLimits}
                getGuestVoiceBlob={pid => guestProfiles.getAudioBlob(pid)}
                onGuestGate={type => setGuestGateType(type)}
                onGuestSynthesisUsed={() => guestSession.updateUsage('synthesesUsed')}
                onUploadAudio={guestMode ? undefined : uploadAudio}
              />
            )
          })()}

          {page === 'workspace' && workspaceTab === 'assembly' && (() => {
            const p = guestMode ? guestProject.project : activeProject
            if (!p) return null
            return (
              <>
                {mergeError && (
                  <div className="msg msg--err" style={{ margin: '8px 16px 0' }}>
                    Export failed: {mergeError}
                  </div>
                )}
                <AssemblyPage
                  project={p}
                  mergedUrl={mergedUrl}
                  mergedBlob={mergedBlob}
                  merging={merging}
                  onMerge={(clips, bg, lm) => mergeSelected(clips, bg, lm)}
                  onReorder={(scripts) => guestMode ? guestProject.reorderScripts(scripts) : reorderScripts(p.id, scripts)}
                  onSaveTimeline={(clips) => { if (!guestMode) saveTimeline(p.id, clips) }}
                  onSaveLaneConfig={guestMode ? undefined : (cfg) => saveLaneConfig(p.id, cfg)}
                  isGuest={guestMode}
                  onGuestGate={type => setGuestGateType(type)}
                  isPaidUser={!guestMode && (user?.plan_name === 'starter' || user?.plan_name === 'pro')}
                  onExportGate={() => guestMode ? setGuestGateType('assembly_export') : setPage('pricing')}
                />
              </>
            )
          })()}

          {page === 'profiles' && (
            <ProfilesPage
              profiles={guestMode ? guestProfiles.asVoiceProfiles : voiceProfiles}
              onRefresh={guestMode ? () => {} : loadProfiles}
              engineCaps={engineCaps}
              isGuest={guestMode}
              guestLimits={guestLimits}
              guestProfilesCount={guestProfiles.profiles.length}
              guestPreviewsUsed={guestSession.session?.usage.previewsUsed ?? 0}
              onGuestSave={async (name, blob, dur) => {
                const ok = await guestProfiles.saveProfile(name, blob, dur)
                if (!ok) setGuestGateType('profile_limit')
                return ok
              }}
              onGuestDelete={pid => guestProfiles.deleteProfile(pid)}
              onGuestGate={type => setGuestGateType(type)}
              onIncrementPreview={() => guestSession.updateUsage('previewsUsed')}
              getGuestVoiceBlob={pid => guestProfiles.getAudioBlob(pid)}
            />
          )}

          {page === 'settings' && (
            <SettingsPage
              darkMode={darkMode}
              onToggleDark={() => setDarkMode(v => !v)}
              onSignOut={signOut}
              onDeleteAccount={signOut}
              onProfileSaved={checkUser}
              engineCaps={engineCaps}
              onGoPricing={() => setPage('pricing')}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => sidebarCollapsed ? expandSidebar() : collapseSidebar()}
              user={user
                ? { name: user.name, email: user.email, email_verified_at: user.email_verified_at, plan_name: user.plan_name }
                : { name: '', email: '' }}
            />
          )}

          {page === 'workspace' && !activeProject && !guestMode && (
            <div className="empty-state">
              {icons.projects}
              <p>No project selected.</p>
              <button className="btn btn--primary" onClick={() => setPage('projects')}>
                Go to Projects
              </button>
            </div>
          )}
        </div>
      </div>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={addProject}
        />
      )}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
      {guestGateType && (
        <GuestUpgradeModal
          type={guestGateType}
          guestLimits={guestLimits}
          onSignUp={() => { setGuestGateType(null); setPage('signup') }}
          onSignIn={() => { setGuestGateType(null); setPage('signin') }}
          onClose={() => setGuestGateType(null)}
        />
      )}
      {cookieConsent === null && (
        <CookieConsent
          onAccept={() => { localStorage.setItem(COOKIE_KEY, 'true');  setCookieConsent(true) }}
          onDecline={() => { localStorage.setItem(COOKIE_KEY, 'false'); setCookieConsent(false) }}
        />
      )}
      <ToastContainer />
    </div>
  )
}