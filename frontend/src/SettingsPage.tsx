import { useState, useEffect } from 'react'
import { clearAllAudio } from './audio'
import { api } from './api'
import { toast } from './toast'
import { icons } from './constants'
import { LogoMark } from './LandingPage'
import { useTTSEngine, type TTSEngine } from './hooks/useTTSEngine'
import { getAudioPrefs, saveAudioPrefs, getAppearancePrefs, saveAppearancePrefs } from './hooks/useAudioSettings'
import type { EngineCaps, Subscription, Plan } from './types'

// ═══════════════════════════════════════════════════════════════════
type SettingsSection =
  | 'profile'
  | 'account'
  | 'billing'
  | 'audio'
  | 'appearance'
  | 'notifications'
  | 'api'
  | 'danger'

interface SettingsPageProps {
  darkMode?: boolean
  onToggleDark?: () => void
  onSignOut?: () => void
  onDeleteAccount?: () => void
  onProfileSaved?: () => void
  user?: { name: string; email: string; email_verified_at?: string | null; plan_name?: Plan }
  engineCaps?: EngineCaps
  onGoPricing?: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

export function SettingsPage({
  darkMode = false,
  onToggleDark,
  onSignOut,
  onDeleteAccount,
  onProfileSaved,
  user = { name: '', email: '' },
  engineCaps = { xtts: false, f5: false },
  onGoPricing,
  sidebarCollapsed,
  onToggleSidebar,
}: SettingsPageProps) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  // null = "menu view" on mobile; on desktop always has a section selected
  const [section, setSection] = useState<SettingsSection | null>(
    () => (window.innerWidth < 768 ? null : 'profile')
  )
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const update = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      // switching to desktop — ensure a section is selected
      if (!mobile) setSection(s => s ?? 'profile')
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const navItems: { id: SettingsSection; label: string; hint: string; icon: React.ReactNode }[] = [
    { id: 'profile',       label: 'Profile',            hint: 'Name, email, bio',              icon: icons.user    },
    { id: 'account',       label: 'Account & Security', hint: 'Password, 2FA, sessions',       icon: icons.shield  },
    { id: 'billing',       label: 'Billing & Plan',     hint: 'Subscription, invoices',        icon: icons.star    },
    { id: 'audio',         label: 'Audio & Synthesis',  hint: 'Engine, speed, recording',      icon: icons.volume  },
    { id: 'appearance',    label: 'Appearance',          hint: 'Theme, layout density',         icon: icons.light   },
    { id: 'notifications', label: 'Notifications',       hint: 'Alerts and reminders',          icon: icons.bell    },
    { id: 'api',           label: 'API & Engine',        hint: 'Engine endpoint, timeout',      icon: icons.api     },
    { id: 'danger',        label: 'Danger Zone',         hint: 'Delete account, clear cache',   icon: icons.trash   },
  ]

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  const activeItem = navItems.find(n => n.id === section)

  return (
    <div className="settings-page">
      {/* ── Topbar ── */}
      <div className="topbar settings-topbar">
        {/* Mobile + a section open → back button */}
        {isMobile && section !== null ? (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setSection(null)}
            style={{ gap: 4 }}
          >
            {icons.back}
            <span style={{ fontSize: 13 }}>Settings</span>
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LogoMark size={22} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.1px' }}>
              Voxora
            </span>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>·</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)' }}>Settings</span>
          </div>
        )}

        {isMobile && section !== null && (
          <span className="topbar__title" style={{ fontWeight: 600, fontSize: 15 }}>
            {activeItem?.label}
          </span>
        )}

        <div style={{ flex: 1 }} />
        {saved && (
          <div className="msg msg--ok" style={{ padding: '5px 12px', width: 'auto', display: 'flex', alignItems: 'center', gap: 6, animation: 'modal-in 0.18s ease' }}>
            <span style={{ width: 14, height: 14 }}>{icons.check}</span>
            <span className="settings-saved-label">Changes saved</span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="settings-layout">

        {/* ── Left nav (desktop always; mobile only when no section) ── */}
        {(!isMobile || section === null) && (
          <div className={`settings-nav ${isMobile ? 'settings-nav--mobile' : ''}`}>

            {isMobile && (
              /* Mobile: profile card at top of menu */
              <div className="settings-profile-card">
                <div className="settings-avatar">
                  {user.name[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user.email}</div>
                </div>
              </div>
            )}

            <div className={isMobile ? 'settings-menu-group' : ''}>
              {navItems.map(item => (
                <button
                  key={item.id}
                  className={`settings-nav-item ${!isMobile && section === item.id ? 'settings-nav-item--active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  <span className="settings-nav-item__icon">{item.icon}</span>
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__label">{item.label}</span>
                    {isMobile && (
                      <span className="settings-nav-item__hint">{item.hint}</span>
                    )}
                  </span>
                  {isMobile && (
                    <span className="settings-nav-item__chevron">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16"><path d="M8 4l6 6-6 6" /></svg>
                    </span>
                  )}
                </button>
              ))}
            </div>

            {isMobile && (
              <div className="settings-menu-group settings-menu-group--danger">
                <button
                  className="settings-nav-item settings-nav-item--signout"
                  onClick={onSignOut}
                >
                  <span className="settings-nav-item__icon">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 16, height: 16 }}>
                      <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" />
                      <path d="M13 14l4-4-4-4" /><line x1="17" y1="10" x2="7" y2="10" />
                    </svg>
                  </span>
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__label settings-nav-item__label--warn">Sign out</span>
                  </span>
                </button>
              </div>
            )}

            {!isMobile && (
              <>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn--ghost"
                  style={{ fontSize: 12.5, width: '100%', justifyContent: 'flex-start', color: 'var(--err)', gap: 7, padding: '7px 10px', marginTop: 8 }}
                  onClick={onSignOut}
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Content (desktop always; mobile only when a section is open) ── */}
        {(!isMobile || section !== null) && (
          <div className="settings-content">
            {section === 'profile'       && <ProfileSettings       user={user}      onSave={handleSave} onProfileSaved={onProfileSaved} />}
            {section === 'account'       && <AccountSettings                        onSave={handleSave} />}
            {section === 'billing'       && <BillingSettings currentPlan={user.plan_name ?? 'free'} onGoPricing={onGoPricing} />}
            {section === 'audio'         && <AudioSettings          engineCaps={engineCaps} onSave={handleSave} />}
            {section === 'appearance'    && <AppearanceSettings     darkMode={darkMode} onToggleDark={onToggleDark} onSave={handleSave} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar} />}
            {section === 'notifications' && <NotificationSettings                   onSave={handleSave} />}
            {section === 'api'           && <ApiSettings                            onSave={handleSave} />}
            {section === 'danger'        && <DangerSettings         onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared sub-components ────────────────────────────────────────────

function SettingsHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px', marginBottom: 4 }}>
        {title}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{desc}</p>
    </div>
  )
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ width: 40, height: 22, borderRadius: 11, background: checked ? 'var(--accent)' : 'var(--border-2)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.18s', flexShrink: 0 }}
    >
      <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.18)', transition: 'left 0.18s' }} />
    </button>
  )
}

// ── Profile ──────────────────────────────────────────────────────────

function ProfileSettings({ user, onSave, onProfileSaved }: { user: { name: string; email: string }; onSave: () => void; onProfileSaved?: () => void }) {
  const [name, setName]     = useState(user.name)
  const [email, setEmail]   = useState(user.email)
  const [bio, setBio]       = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    try {
      await api.put('/user', { name: name.trim(), email: email.trim(), bio: bio.trim() || undefined })
      onSave(); onProfileSaved?.(); toast.ok('Profile updated')
    } catch (e) { toast.err(e instanceof Error ? e.message : 'Failed to update profile') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <SettingsHeading title="Profile" desc="Your public identity within Voxora." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div className="settings-avatar settings-avatar--lg">{name[0]?.toUpperCase()}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{email}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        <div className="field"><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Full name</label><input className="full-input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label><input className="full-input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Bio <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <textarea className="full-input" value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="Podcaster, narrator, creator…" style={{ resize: 'vertical', lineHeight: 1.6 }} />
        </div>
      </div>
      <button className="btn btn--primary" onClick={handleSubmit} disabled={saving} style={{ gap: 6 }}>
        {saving ? <><span className="spinner" /> Saving…</> : <>{icons.check} Save profile</>}
      </button>
    </div>
  )
}

// ── Account & Security ───────────────────────────────────────────────

function AccountSettings({ onSave }: { onSave: () => void }) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw]         = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [twoFa, setTwoFa]         = useState(false)
  const [sessions, setSessions]   = useState(true)
  const [saving, setSaving]       = useState(false)

  async function handleChangePassword() {
    if (!currentPw || !newPw || !confirmPw) { toast.info('Fill in all password fields'); return }
    if (newPw !== confirmPw) { toast.err('New passwords do not match'); return }
    if (newPw.length < 8)    { toast.err('New password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await api.post('/user/password', { current_password: currentPw, password: newPw, password_confirmation: confirmPw })
      setCurrentPw(''); setNewPw(''); setConfirmPw(''); onSave(); toast.ok('Password updated')
    } catch (e) { toast.err(e instanceof Error ? e.message : 'Failed to change password') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <SettingsHeading title="Account & Security" desc="Manage your password and security settings." />
      <SettingsRow label="Two-factor authentication" hint="Add an extra layer of security to your account.">
        <Toggle checked={twoFa} onChange={setTwoFa} />
      </SettingsRow>
      <SettingsRow label="Active sessions" hint="Automatically sign out from inactive sessions.">
        <Toggle checked={sessions} onChange={setSessions} />
      </SettingsRow>
      <div style={{ marginTop: 4, marginBottom: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 14 }}>Change password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field"><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Current password</label><input className="full-input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" /></div>
          <div className="field"><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>New password</label><input className="full-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" /></div>
          <div className="field"><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Confirm new password</label><input className="full-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" /></div>
        </div>
      </div>
      <button className="btn btn--primary" onClick={handleChangePassword} disabled={saving} style={{ gap: 6, marginTop: 8 }}>
        {saving ? <><span className="spinner" /> Saving…</> : <>{icons.check} Update password</>}
      </button>
    </div>
  )
}

// ── Audio & Synthesis ────────────────────────────────────────────────

function AudioSettings({ engineCaps, onSave }: { engineCaps: EngineCaps; onSave: () => void }) {
  const [prefs, setPrefs] = useState(() => getAudioPrefs())
  const { defaultLang, defaultSpeed, noiseSuppression, autoGain, defaultGain } = prefs
  const setDefaultLang      = (v: string)  => setPrefs(p => ({ ...p, defaultLang: v }))
  const setDefaultSpeed     = (v: number)  => setPrefs(p => ({ ...p, defaultSpeed: v }))
  const setNoiseSuppression = (v: boolean) => setPrefs(p => ({ ...p, noiseSuppression: v }))
  const setAutoGain         = (v: boolean) => setPrefs(p => ({ ...p, autoGain: v }))
  const setDefaultGain      = (v: number)  => setPrefs(p => ({ ...p, defaultGain: v }))
  const { engine, setEngine } = useTTSEngine()

  const languages = [
    { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French'  }, { code: 'de', label: 'German'  },
    { code: 'ja', label: 'Japanese'}, { code: 'zh', label: 'Chinese' },
  ]

  const engineOptions: { id: TTSEngine; label: string; desc: string; color: string; bg: string; border: string; available: boolean }[] = [
    { id: 'xtts', label: 'XTTS v2', desc: '16 languages', color: 'var(--accent)', bg: 'var(--accent-lt)', border: 'var(--accent)', available: engineCaps.xtts },
    { id: 'f5',   label: 'F5-TTS',  desc: 'English-first', color: '#4278c9', bg: 'rgba(66,120,201,0.08)', border: '#4278c9', available: engineCaps.f5 },
    { id: 'chatterbox', label: 'Chatterbox', desc: 'MIT-licensed', color: '#e0703c', bg: 'rgba(224,112,60,0.08)', border: '#e0703c', available: engineCaps.chatterbox ?? false },
  ]

  return (
    <div>
      <SettingsHeading title="Audio & Synthesis" desc="Default settings for voice synthesis and recording." />
      <SettingsRow label="TTS engine" hint="Which voice synthesis engine to use when generating audio.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {engineOptions.map(opt => (
              <button key={opt.id} onClick={() => setEngine(opt.id)} title={opt.available ? opt.desc : `${opt.label} not installed`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: engine === opt.id ? `2px solid ${opt.border}` : '2px solid var(--border-2)', background: engine === opt.id ? opt.bg : 'var(--surface)', cursor: 'pointer', transition: 'all 0.12s', opacity: opt.available ? 1 : 0.6, position: 'relative' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: engine === opt.id ? opt.color : 'var(--text-1)' }}>{opt.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{opt.desc}</span>
                <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: opt.available ? 'var(--ok)' : 'var(--warn)', boxShadow: opt.available ? '0 0 0 2px var(--ok-lt)' : '0 0 0 2px var(--warn-lt)' }} />
              </button>
            ))}
          </div>
          {engine === 'f5' && !engineCaps.f5 && (
            <div style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.55, background: 'var(--warn-lt)', border: '1px solid rgba(160,117,48,0.25)', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
              F5-TTS is not installed. Run <code style={{ fontFamily: 'var(--mono)' }}>pip install f5-tts</code> or switch to XTTS v2.
            </div>
          )}
          {engine === 'chatterbox' && !(engineCaps.chatterbox ?? false) && (
            <div style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.55, background: 'var(--warn-lt)', border: '1px solid rgba(160,117,48,0.25)', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
              Chatterbox is not installed. Run <code style={{ fontFamily: 'var(--mono)' }}>pip install chatterbox-tts</code> or switch to XTTS v2 / F5-TTS.
            </div>
          )}
          {engine === 'xtts' && !engineCaps.xtts && (
            <div style={{ fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.55, background: 'var(--warn-lt)', border: '1px solid rgba(160,117,48,0.25)', borderRadius: 'var(--radius-sm)', padding: '6px 10px' }}>
              XTTS v2 is not available on this server. Check the engine logs.
            </div>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label="Default language" hint="Used when creating new scripts. XTTS v2 is multilingual; F5-TTS speaks its loaded model's language(s).">
        {(() => {
          const f5Langs = engineCaps?.f5_languages ?? []
          const cbLangs = engineCaps?.chatterbox_languages ?? []
          const langList =
            engine === 'f5' ? languages.filter(l => f5Langs.includes(l.code)) :
            engine === 'chatterbox' && cbLangs.length ? languages.filter(l => cbLangs.includes(l.code)) :
            languages
          const langDisabled = (engine === 'f5' || engine === 'chatterbox') && langList.length <= 1
          return (
          <select className="full-input" value={defaultLang} onChange={e => setDefaultLang(e.target.value)} disabled={langDisabled} style={{ width: 160, padding: '6px 10px', opacity: langDisabled ? 0.45 : 1 }}>
            {(langList.length ? langList : languages).map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          ) })()}
      </SettingsRow>
      <SettingsRow label="Default speech speed" hint={`${defaultSpeed.toFixed(1)}× — affects all new scripts`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0.5" max="2" step="0.05" value={defaultSpeed} onChange={e => setDefaultSpeed(Number(e.target.value))} style={{ width: 120, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{defaultSpeed.toFixed(1)}×</span>
        </div>
      </SettingsRow>
      <SettingsRow label="Browser noise suppression" hint="Reduces background noise during recording.">
        <Toggle checked={noiseSuppression} onChange={setNoiseSuppression} />
      </SettingsRow>
      <SettingsRow label="Auto gain control" hint="Normalises microphone input level automatically.">
        <Toggle checked={autoGain} onChange={setAutoGain} />
      </SettingsRow>
      <SettingsRow label="Default recording gain" hint={`Microphone amplification level — ${defaultGain.toFixed(2)}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0.1" max="2" step="0.05" value={defaultGain} onChange={e => setDefaultGain(Number(e.target.value))} style={{ width: 120, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{defaultGain.toFixed(2)}</span>
        </div>
      </SettingsRow>
      <button className="btn btn--primary" onClick={() => { saveAudioPrefs(prefs); onSave(); toast.ok('Audio settings saved') }} style={{ gap: 6 }}>{icons.check} Save audio settings</button>
    </div>
  )
}

// ── Appearance ───────────────────────────────────────────────────────

function AppearanceSettings({ darkMode, onToggleDark, onSave, sidebarCollapsed: sidebarCollapsedProp, onToggleSidebar }: { darkMode?: boolean; onToggleDark?: () => void; onSave: () => void; sidebarCollapsed?: boolean; onToggleSidebar?: () => void }) {
  const [prefs, setPrefs] = useState(() => getAppearancePrefs())

  // Keep density persisted
  const setDensity = (v: 'comfortable' | 'compact') => {
    const next = { ...prefs, density: v }
    setPrefs(next)
    saveAppearancePrefs(next)
  }

  // Sidebar toggle is live (calls App.tsx handler) + persisted
  const handleSidebarToggle = (v: boolean) => {
    const next = { ...prefs, sidebarCollapsed: v }
    setPrefs(next)
    saveAppearancePrefs(next)
    // sync the shell via the prop callback so the sidebar actually collapses
    if (v !== sidebarCollapsedProp) onToggleSidebar?.()
  }

  return (
    <div>
      <SettingsHeading title="Appearance" desc="Customise how Voxora looks and feels." />
      <SettingsRow label="Dark mode" hint="Switch between light and dark interface themes.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 15, height: 15, color: 'var(--text-3)' }}>{darkMode ? icons.dark : icons.light}</span>
          <Toggle checked={!!darkMode} onChange={() => onToggleDark?.()} />
        </div>
      </SettingsRow>
      <SettingsRow label="Layout density" hint="Controls spacing throughout the interface.">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <button key={d} onClick={() => setDensity(d)} className={prefs.density === d ? 'btn btn--primary btn--sm' : 'btn btn--ghost btn--sm'} style={{ fontSize: 12, textTransform: 'capitalize' }}>{d}</button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow label="Collapsed sidebar" hint="Hides text labels in the sidebar navigation.">
        <Toggle checked={sidebarCollapsedProp ?? prefs.sidebarCollapsed} onChange={handleSidebarToggle} />
      </SettingsRow>
      <div style={{ margin: '20px 0', padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-3)', marginBottom: 10 }}>Preview</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎙</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Sample project</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>4 scripts · 2 voice profiles</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--accent-lt)', color: 'var(--accent)', border: '1px solid var(--accent-mid)', fontWeight: 600 }}>Active</span>
          </div>
        </div>
      </div>
      <button className="btn btn--primary" onClick={() => { saveAppearancePrefs(prefs); onSave(); toast.ok('Appearance settings saved') }} style={{ gap: 6 }}>{icons.check} Save appearance</button>
    </div>
  )
}

// ── Notifications ────────────────────────────────────────────────────

const NOTIF_KEY = 'vs_notif_prefs'
function loadNotifPrefs() { try { return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '{}') } catch { return {} } }

function NotificationSettings({ onSave }: { onSave: () => void }) {
  const prefs = loadNotifPrefs()
  const [synth, setSynth]     = useState<boolean>(prefs.synth   ?? true)
  const [exports, setExports] = useState<boolean>(prefs.exports ?? true)
  const [errors, setErrors]   = useState<boolean>(prefs.errors  ?? true)
  const [updates, setUpdates] = useState<boolean>(prefs.updates ?? false)

  function handleSave() {
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ synth, exports, errors, updates }))
    onSave(); toast.ok('Notification preferences saved')
  }

  return (
    <div>
      <SettingsHeading title="Notifications" desc="Choose when Voxora should alert you." />
      <SettingsRow label="Synthesis complete" hint="Notify when a script has finished generating audio."><Toggle checked={synth} onChange={setSynth} /></SettingsRow>
      <SettingsRow label="Export complete" hint="Notify when a timeline export has finished."><Toggle checked={exports} onChange={setExports} /></SettingsRow>
      <SettingsRow label="Engine errors" hint="Alert if the local XTTS engine encounters a problem."><Toggle checked={errors} onChange={setErrors} /></SettingsRow>
      <SettingsRow label="Product updates" hint="Occasional announcements about new features."><Toggle checked={updates} onChange={setUpdates} /></SettingsRow>
      <button className="btn btn--primary" onClick={handleSave} style={{ gap: 6 }}>{icons.check} Save preferences</button>
    </div>
  )
}

// ── API & Engine ─────────────────────────────────────────────────────

const API_SETTINGS_KEY = 'vs_api_settings'
function loadApiSettings() { try { return JSON.parse(localStorage.getItem(API_SETTINGS_KEY) ?? '{}') } catch { return {} } }

function ApiSettings({ onSave }: { onSave: () => void }) {
  const saved = loadApiSettings()
  const [endpoint, setEndpoint] = useState<string>(saved.endpoint ?? import.meta.env.VITE_ENGINE_URL ?? 'http://localhost:8000')
  const [timeout, setTimeout_]  = useState<number>(saved.timeout ?? 30)

  function handleSave() {
    localStorage.setItem(API_SETTINGS_KEY, JSON.stringify({ endpoint, timeout }))
    onSave(); toast.ok('Connection settings saved')
  }

  return (
    <div>
      <SettingsHeading title="API & Engine" desc="Configure the connection to your local XTTS engine." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Engine endpoint</label>
          <input className="full-input" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://localhost:8000" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>The URL where your XTTS backend is running. Requires a page reload to take effect.</span>
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Request timeout (seconds)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min="5" max="120" step="5" value={timeout} onChange={e => setTimeout_(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 36 }}>{timeout}s</span>
          </div>
        </div>
      </div>
      <button className="btn btn--primary" onClick={handleSave} style={{ gap: 6 }}>{icons.check} Save connection</button>
    </div>
  )
}

// ── Usage bar (billing section) ──────────────────────────────────────

interface QuotaData { limit: number; used: number; remaining: number; period: string }

function UsageBar({ label, quota, loading }: { label: string; quota: QuotaData | null; loading: boolean }) {
  const pct = quota && quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0
  const barColor = pct >= 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--accent)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-1)' }}>{label}</span>
        {loading ? (
          <span className="spinner" style={{ width: 10, height: 10 }} />
        ) : quota ? (
          quota.limit === 0
            ? <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Unlimited</span>
            : <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                {quota.used} / {quota.limit} <span style={{ color: 'var(--text-3)', fontFamily: 'inherit' }}>per {quota.period}</span>
              </span>
        ) : null}
      </div>
      {!loading && quota && quota.limit > 0 && (
        <div style={{ height: 5, borderRadius: 99, background: 'var(--bg-3)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: barColor, transition: 'width 0.3s ease' }} />
        </div>
      )}
    </div>
  )
}

// ── Billing & Plan ───────────────────────────────────────────────────

const PLAN_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  free:    { label: 'Free',    color: 'var(--text-3)', bg: 'var(--bg-3)'             },
  starter: { label: 'Starter', color: 'var(--accent)', bg: 'var(--accent-lt)'        },
  pro:     { label: 'Pro',     color: '#4278c9',        bg: 'rgba(66,120,201,0.10)'  },
}

interface PayPalTransaction {
  id: string; status: string
  amount_with_breakdown?: { gross_amount?: { value: string; currency_code: string } }
  time: string
}

function BillingSettings({ currentPlan, onGoPricing }: { currentPlan: Plan; onGoPricing?: () => void }) {
  const [sub, setSub]               = useState<Subscription | null>(null)
  const [loading, setLoading]       = useState(true)
  const [txns, setTxns]             = useState<PayPalTransaction[]>([])
  const [txnLoading, setTxnLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [exporting, setExporting]   = useState(false)
  const [synthQuota, setSynthQuota]   = useState<QuotaData | null>(null)
  const [transQuota, setTransQuota]   = useState<QuotaData | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/synthesis/quota').then(d => setSynthQuota(d as QuotaData)).catch(() => {}),
      api.get('/translation/quota').then(d => setTransQuota(d as QuotaData)).catch(() => {}),
    ]).finally(() => setQuotaLoading(false))
  }, [])

  useEffect(() => {
    api.get('/subscription')
      .then(d => {
        const s = d as Subscription; setSub(s)
        if (s?.paypal_subscription_id) {
          setTxnLoading(true)
          api.get('/subscription/transactions').then(r => {
            const data = r as { transactions?: PayPalTransaction[] }
            setTxns(data.transactions ?? [])
          }).catch(() => {}).finally(() => setTxnLoading(false))
        }
      }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleCancel() {
    if (!sub?.paypal_subscription_id) return
    setCancelling(true)
    try {
      await api.post('/subscription/cancel', {})
      setSub(s => s ? { ...s, status: 'cancelled' } : s); setConfirmCancel(false)
      toast.ok('Subscription cancelled — active until end of billing period')
    } catch (e) { toast.err(e instanceof Error ? e.message : 'Failed to cancel subscription') }
    finally { setCancelling(false) }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/user/export`, { credentials: 'include', headers: { Accept: 'application/json' } })
      if (!response.ok) {
        // Surface the server's message (e.g. the Pro-only gate) when present
        let message = 'Export failed. Please try again.'
        try { const body = await response.json(); if (body?.message) message = body.message } catch { /* ignore */ }
        throw new Error(message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'my-voicestudio-data.json'; a.click()
      URL.revokeObjectURL(url); toast.ok('Data export downloaded')
    } catch (e) { toast.err(e instanceof Error ? e.message : 'Export failed. Please try again.') }
    finally { setExporting(false) }
  }

  const planInfo = PLAN_LABELS[currentPlan] ?? PLAN_LABELS.free
  const isPaid   = currentPlan !== 'free'

  return (
    <div>
      <SettingsHeading title="Billing & Plan" desc="Manage your subscription and download your data." />
      <div style={{ padding: 20, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-3)', marginBottom: 6 }}>Current plan</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700, padding: '3px 12px', borderRadius: 99, background: planInfo.bg, color: planInfo.color }}>{planInfo.label}</span>
              {sub?.status === 'active' && sub.current_period_end && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Renews {new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              )}
              {sub?.status === 'cancelled' && (
                <span style={{ fontSize: 12, color: 'var(--warn)' }}>Cancelled — active until {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'end of period'}</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {(!isPaid || sub?.status === 'cancelled') && <button className="btn btn--primary btn--sm" onClick={onGoPricing}>{sub?.status === 'cancelled' ? 'Resubscribe' : 'Upgrade plan'}</button>}
            {isPaid && sub?.status === 'active' && !confirmCancel && <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)' }} onClick={() => setConfirmCancel(true)}>Cancel subscription</button>}
          </div>
        </div>
        {confirmCancel && (
          <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-3)', borderRadius: 'var(--radius)', border: '1px solid var(--warn)' }}>
            <p style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 12 }}>Are you sure? Your plan stays active until the end of the current billing period.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--sm" style={{ background: 'var(--warn)', color: '#fff' }} onClick={handleCancel} disabled={cancelling}>{cancelling ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}Yes, cancel</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmCancel(false)}>Keep subscription</button>
            </div>
          </div>
        )}
      </div>

      {loading && <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 16 }}><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />Loading billing info…</div>}

      {!loading && sub && isPaid && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Plan', value: planInfo.label },
            { label: 'Status', value: sub.status ? sub.status[0].toUpperCase() + sub.status.slice(1) : '—' },
            { label: 'Next billing', value: sub.status === 'active' && sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—' },
            { label: 'Subscription ID', value: sub.paypal_subscription_id ? sub.paypal_subscription_id.slice(0, 14) + '…' : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '12px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && isPaid && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 10 }}>Billing history</div>
          {txnLoading ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}><span className="spinner" style={{ width: 12, height: 12, marginRight: 6 }} />Loading transactions…</div>
          : txns.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>No transactions yet.</div>
          : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: 'var(--bg-2)' }}>{['Date', 'Amount', 'Status'].map(h => <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>)}</tr></thead>
                <tbody>{txns.map((t, i) => {
                  const gross = t.amount_with_breakdown?.gross_amount
                  return (
                    <tr key={t.id ?? i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', color: 'var(--text-1)' }}>{new Date(t.time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-1)', fontWeight: 600 }}>{gross ? `${gross.currency_code} ${parseFloat(gross.value).toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: t.status === 'COMPLETED' ? 'rgba(34,197,94,0.12)' : 'var(--bg-3)', color: t.status === 'COMPLETED' ? '#16a34a' : 'var(--text-3)' }}>{t.status}</span></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Usage dashboard */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 12 }}>Usage</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <UsageBar label="Synthesis" quota={synthQuota} loading={quotaLoading} />
          <UsageBar label="Translation" quota={transQuota} loading={quotaLoading} />
        </div>
      </div>

      <SettingsRow label="View all plans" hint="Compare features across Free, Starter, and Pro.">
        <button className="btn btn--ghost btn--sm" onClick={onGoPricing} style={{ gap: 6 }}>{icons.externalLink} View pricing</button>
      </SettingsRow>
      <SettingsRow label="Export your data" hint={currentPlan === 'pro' ? 'Download all your projects, scripts, and voice profile metadata as JSON.' : 'Data export (GDPR) is a Pro feature.'}>
        {currentPlan === 'pro' ? (
          <button className="btn btn--ghost btn--sm" onClick={handleExport} disabled={exporting} style={{ gap: 6 }}>
            {exporting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : icons.download} Export data
          </button>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={onGoPricing} style={{ gap: 6 }}>
            {icons.externalLink} Upgrade to Pro
          </button>
        )}
      </SettingsRow>
    </div>
  )
}

// ── Danger Zone ──────────────────────────────────────────────────────

function DangerSettings({ onSignOut, onDeleteAccount }: { onSignOut?: () => void; onDeleteAccount?: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState('')
  const [clearing, setClearing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleClearCache() {
    setClearing(true)
    try { await clearAllAudio(); toast.ok('Audio cache cleared') }
    catch { toast.err('Failed to clear cache') }
    finally { setClearing(false) }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try { await api.delete('/user'); toast.ok('Account deleted'); onDeleteAccount?.() }
    catch (e) { toast.err(e instanceof Error ? e.message : 'Failed to delete account') }
    finally { setDeleting(false) }
  }

  return (
    <div>
      <SettingsHeading title="Danger Zone" desc="Irreversible actions — proceed with caution." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Sign out of all devices</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Revoke all active sessions across every device.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }} onClick={onSignOut}>Sign out all</button>
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Clear all cached audio</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Removes all stored audio blobs from IndexedDB.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }} onClick={handleClearCache} disabled={clearing}>
              {clearing ? <span className="spinner" /> : null} Clear cache
            </button>
          </div>
        </div>
        <div style={{ padding: 16, border: '1px solid rgba(192,57,43,0.25)', borderRadius: 'var(--radius-lg)', background: 'var(--err-lt)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--err)', marginBottom: 4 }}>Delete account</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>This will permanently delete your account, all projects, scripts, voice profiles, and audio. This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input className="full-input" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)} placeholder='Type "delete" to confirm' style={{ flex: 1, borderColor: 'rgba(192,57,43,0.35)' }} />
            <button className="btn btn--danger btn--sm" disabled={confirmDelete !== 'delete' || deleting} style={{ flexShrink: 0 }} onClick={handleDeleteAccount}>
              {deleting ? <span className="spinner" /> : icons.trash} Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
