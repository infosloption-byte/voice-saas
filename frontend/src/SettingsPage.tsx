import { useState, useEffect } from 'react'
import { clearAllAudio } from './audio'
import { api } from './api'
import { toast } from './toast'
import { icons } from './constants'
import { LogoMark } from './LandingPage'
import { useTTSEngine, type TTSEngine } from './hooks/useTTSEngine'
import type { EngineCaps } from './types'

// ═══════════════════════════════════════════════════════════════════
type SettingsSection =
  | 'profile'
  | 'account'
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
  user?: { name: string; email: string }
  engineCaps?: EngineCaps
}

export function SettingsPage({
  darkMode = false,
  onToggleDark,
  onSignOut,
  onDeleteAccount,
  onProfileSaved,
  user = { name: '', email: '' },
  engineCaps = { xtts: false, f5: false },
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('profile')
  const [saved, setSaved] = useState(false)

  const navItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',       label: 'Profile',            icon: icons.user    },
    { id: 'account',       label: 'Account & Security', icon: icons.shield  },
    { id: 'audio',         label: 'Audio & Synthesis',  icon: icons.volume  },
    { id: 'appearance',    label: 'Appearance',          icon: icons.light   },
    { id: 'notifications', label: 'Notifications',       icon: icons.bell    },
    { id: 'api',           label: 'API & Engine',        icon: icons.api     },
    { id: 'danger',        label: 'Danger Zone',         icon: icons.trash   },
  ]

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div
        className="topbar"
        style={{ borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 10 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={22} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>Settings</span>
        </div>
        <div style={{ flex: 1 }} />
        {saved && (
          <div
            className="msg msg--ok"
            style={{
              padding: '5px 12px',
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              animation: 'modal-in 0.18s ease',
            }}
          >
            <span style={{ width: 14, height: 14 }}>{icons.check}</span> Changes saved
          </div>
        )}
      </div>

      <div
        className="settings-layout"
        style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1 }}
      >
        {/* Sidebar nav */}
        <div
          className="settings-nav"
          style={{
            borderRight: '1px solid var(--border)',
            padding: '16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item settings-nav-item ${section === item.id ? 'nav-item--active' : ''}`}
              onClick={() => setSection(item.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ width: 15, height: 15, flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <button
            className="btn btn--ghost"
            style={{
              fontSize: 12.5,
              width: '100%',
              justifyContent: 'flex-start',
              color: 'var(--err)',
              gap: 7,
              padding: '7px 10px',
              marginTop: 8,
            }}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>

        {/* Content */}
        <div className="settings-content" style={{ padding: '32px 40px', maxWidth: 640 }}>
          {section === 'profile'       && <ProfileSettings       user={user}     onSave={handleSave} onProfileSaved={onProfileSaved} />}
          {section === 'account'       && <AccountSettings                       onSave={handleSave} />}
          {section === 'audio'         && (
            <AudioSettings
              engineCaps={engineCaps}
              onSave={handleSave}
            />
          )}
          {section === 'appearance'    && (
            <AppearanceSettings
              darkMode={darkMode}
              onToggleDark={onToggleDark}
              onSave={handleSave}
            />
          )}
          {section === 'notifications' && <NotificationSettings                  onSave={handleSave} />}
          {section === 'api'           && <ApiSettings                           onSave={handleSave} />}
          {section === 'danger'        && <DangerSettings        onSignOut={onSignOut} onDeleteAccount={onDeleteAccount} />}
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ────────────────────────────────────────────

function SettingsHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 18, fontWeight: 600, color: 'var(--text-1)',
        letterSpacing: '-0.3px', marginBottom: 4,
      }}>
        {title}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{desc}</p>
    </div>
  )
}

function SettingsRow({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, paddingBottom: 20, borderBottom: '1px solid var(--border-3)', marginBottom: 20,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{hint}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11,
        background: checked ? 'var(--accent)' : 'var(--border-2)',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.18s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        transition: 'left 0.18s',
      }} />
    </button>
  )
}

// ── Profile ──────────────────────────────────────────────────────────

function ProfileSettings({ user, onSave, onProfileSaved }: {
  user: { name: string; email: string }
  onSave: () => void
  onProfileSaved?: () => void
}) {
  const [name, setName]     = useState(user.name)
  const [email, setEmail]   = useState(user.email)
  const [bio, setBio]       = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    setSaving(true)
    try {
      await api.put('/user', { name: name.trim(), email: email.trim(), bio: bio.trim() || undefined })
      onSave()
      onProfileSaved?.()
      toast.ok('Profile updated')
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SettingsHeading title="Profile" desc="Your public identity within VoiceStudio." />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28,
        padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {name[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{email}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Full name</label>
          <input className="full-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Email address</label>
          <input className="full-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
            Bio <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span>
          </label>
          <textarea
            className="full-input" value={bio} onChange={e => setBio(e.target.value)}
            rows={3} placeholder="Podcaster, narrator, creator…"
            style={{ resize: 'vertical', lineHeight: 1.6 }}
          />
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
    if (!currentPw || !newPw || !confirmPw) {
      toast.info('Fill in all password fields')
      return
    }
    if (newPw !== confirmPw) {
      toast.err('New passwords do not match')
      return
    }
    if (newPw.length < 8) {
      toast.err('New password must be at least 8 characters')
      return
    }
    setSaving(true)
    try {
      await api.post('/user/password', {
        current_password: currentPw,
        password:         newPw,
        password_confirmation: confirmPw,
      })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      onSave()
      toast.ok('Password updated')
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to change password')
    } finally {
      setSaving(false)
    }
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
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 14 }}>
          Change password
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Current password</label>
            <input className="full-input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>New password</label>
            <input className="full-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Confirm new password</label>
            <input className="full-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
          </div>
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
  const [defaultLang, setDefaultLang]           = useState('en')
  const [defaultSpeed, setDefaultSpeed]         = useState(1.0)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [autoGain, setAutoGain]                 = useState(true)
  const [defaultGain, setDefaultGain]           = useState(0.85)

  // TTS engine — persisted to localStorage, shared with WorkspacePage
  const { engine, setEngine } = useTTSEngine()

  const languages = [
    { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French'  }, { code: 'de', label: 'German'  },
    { code: 'ja', label: 'Japanese'}, { code: 'zh', label: 'Chinese' },
  ]

  const engineOptions: {
    id: TTSEngine; label: string; desc: string
    color: string; bg: string; border: string; available: boolean
  }[] = [
    {
      id: 'xtts', label: 'XTTS v2', desc: '16 languages',
      color: 'var(--accent)', bg: 'var(--accent-lt)', border: 'var(--accent)',
      available: engineCaps.xtts,
    },
    {
      id: 'f5', label: 'F5-TTS', desc: 'English-first',
      color: '#4278c9', bg: 'rgba(66,120,201,0.08)', border: '#4278c9',
      available: engineCaps.f5,
    },
  ]

  return (
    <div>
      <SettingsHeading
        title="Audio & Synthesis"
        desc="Default settings for voice synthesis and recording."
      />

      <SettingsRow
        label="TTS engine"
        hint="Which voice synthesis engine to use when generating audio."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {engineOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setEngine(opt.id)}
                title={opt.available ? opt.desc : `${opt.label} is not installed on this server`}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 2, padding: '7px 14px', borderRadius: 'var(--radius-sm)',
                  border: engine === opt.id
                    ? `2px solid ${opt.border}`
                    : '2px solid var(--border-2)',
                  background: engine === opt.id ? opt.bg : 'var(--surface)',
                  cursor: 'pointer', transition: 'all 0.12s',
                  opacity: opt.available ? 1 : 0.6,
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: engine === opt.id ? opt.color : 'var(--text-1)',
                }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{opt.desc}</span>
                {/* Availability dot */}
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 6, height: 6, borderRadius: '50%',
                  background: opt.available ? 'var(--ok)' : 'var(--warn)',
                  boxShadow: opt.available
                    ? '0 0 0 2px var(--ok-lt)'
                    : '0 0 0 2px var(--warn-lt)',
                }} title={opt.available ? 'Ready' : 'Not installed'} />
              </button>
            ))}
          </div>

          {/* Inline warning when selected engine is not available */}
          {engine === 'f5' && !engineCaps.f5 && (
            <div style={{
              fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.55,
              background: 'var(--warn-lt)', border: '1px solid rgba(160,117,48,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '6px 10px',
            }}>
              F5-TTS is not installed on this server.
              Run <code style={{ fontFamily: 'var(--mono)' }}>pip install f5-tts</code> and
              restart the engine, or switch to XTTS v2.
            </div>
          )}
          {engine === 'xtts' && !engineCaps.xtts && (
            <div style={{
              fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.55,
              background: 'var(--warn-lt)', border: '1px solid rgba(160,117,48,0.25)',
              borderRadius: 'var(--radius-sm)', padding: '6px 10px',
            }}>
              XTTS v2 is not available on this server. Check the engine logs.
            </div>
          )}
        </div>
      </SettingsRow>

      <SettingsRow label="Default language" hint="Used when creating new scripts. XTTS v2 only — F5-TTS is English-first.">
        <select
          className="full-input"
          value={defaultLang}
          onChange={e => setDefaultLang(e.target.value)}
          disabled={engine === 'f5'}
          style={{ width: 160, padding: '6px 10px', opacity: engine === 'f5' ? 0.45 : 1 }}
        >
          {languages.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow
        label="Default speech speed"
        hint={`${defaultSpeed.toFixed(1)}× — affects all new scripts`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range" min="0.5" max="2" step="0.05" value={defaultSpeed}
            onChange={e => setDefaultSpeed(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>
            {defaultSpeed.toFixed(1)}×
          </span>
        </div>
      </SettingsRow>

      <SettingsRow label="Browser noise suppression" hint="Reduces background noise during recording.">
        <Toggle checked={noiseSuppression} onChange={setNoiseSuppression} />
      </SettingsRow>

      <SettingsRow label="Auto gain control" hint="Normalises microphone input level automatically.">
        <Toggle checked={autoGain} onChange={setAutoGain} />
      </SettingsRow>

      <SettingsRow
        label="Default recording gain"
        hint={`Microphone amplification level — ${defaultGain.toFixed(2)}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range" min="0.1" max="2" step="0.05" value={defaultGain}
            onChange={e => setDefaultGain(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>
            {defaultGain.toFixed(2)}
          </span>
        </div>
      </SettingsRow>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>
        {icons.check} Save audio settings
      </button>
    </div>
  )
}

// ── Appearance ───────────────────────────────────────────────────────

function AppearanceSettings({ darkMode, onToggleDark, onSave }: {
  darkMode?: boolean; onToggleDark?: () => void; onSave: () => void
}) {
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div>
      <SettingsHeading title="Appearance" desc="Customise how VoiceStudio looks and feels." />

      <SettingsRow label="Dark mode" hint="Switch between light and dark interface themes.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 15, height: 15, color: 'var(--text-3)' }}>
            {darkMode ? icons.dark : icons.light}
          </span>
          <Toggle checked={!!darkMode} onChange={() => onToggleDark?.()} />
        </div>
      </SettingsRow>

      <SettingsRow label="Layout density" hint="Controls spacing throughout the interface.">
        <div style={{ display: 'flex', gap: 6 }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <button
              key={d}
              onClick={() => setDensity(d)}
              className={density === d ? 'btn btn--primary btn--sm' : 'btn btn--ghost btn--sm'}
              style={{ fontSize: 12, textTransform: 'capitalize' }}
            >
              {d}
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Collapsed sidebar" hint="Hides text labels in the sidebar navigation.">
        <Toggle checked={sidebarCollapsed} onChange={setSidebarCollapsed} />
      </SettingsRow>

      <div style={{
        margin: '20px 0', padding: 16, background: 'var(--bg-2)',
        borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-3)', marginBottom: 10 }}>
          Preview
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎙</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Sample project</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>4 scripts · 2 voice profiles</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--accent-lt)', color: 'var(--accent)', border: '1px solid var(--accent-mid)', fontWeight: 600 }}>Active</span>
          </div>
        </div>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>
        {icons.check} Save appearance
      </button>
    </div>
  )
}

// ── Notifications ────────────────────────────────────────────────────

const NOTIF_KEY = 'vs_notif_prefs'
function loadNotifPrefs() {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '{}') } catch { return {} }
}

function NotificationSettings({ onSave }: { onSave: () => void }) {
  const prefs = loadNotifPrefs()
  const [synth, setSynth]     = useState<boolean>(prefs.synth    ?? true)
  const [exports, setExports] = useState<boolean>(prefs.exports  ?? true)
  const [errors, setErrors]   = useState<boolean>(prefs.errors   ?? true)
  const [updates, setUpdates] = useState<boolean>(prefs.updates  ?? false)

  function handleSave() {
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ synth, exports, errors, updates }))
    onSave()
    toast.ok('Notification preferences saved')
  }

  return (
    <div>
      <SettingsHeading title="Notifications" desc="Choose when VoiceStudio should alert you." />
      <SettingsRow label="Synthesis complete" hint="Notify when a script has finished generating audio.">
        <Toggle checked={synth} onChange={setSynth} />
      </SettingsRow>
      <SettingsRow label="Export complete" hint="Notify when a timeline export has finished.">
        <Toggle checked={exports} onChange={setExports} />
      </SettingsRow>
      <SettingsRow label="Engine errors" hint="Alert if the local XTTS engine encounters a problem.">
        <Toggle checked={errors} onChange={setErrors} />
      </SettingsRow>
      <SettingsRow label="Product updates" hint="Occasional announcements about new features.">
        <Toggle checked={updates} onChange={setUpdates} />
      </SettingsRow>
      <button className="btn btn--primary" onClick={handleSave} style={{ gap: 6 }}>
        {icons.check} Save preferences
      </button>
    </div>
  )
}

// ── API & Engine ─────────────────────────────────────────────────────

const API_SETTINGS_KEY = 'vs_api_settings'
function loadApiSettings() {
  try { return JSON.parse(localStorage.getItem(API_SETTINGS_KEY) ?? '{}') } catch { return {} }
}

function ApiSettings({ onSave }: { onSave: () => void }) {
  const saved = loadApiSettings()
  const [endpoint, setEndpoint] = useState<string>(
    saved.endpoint ?? import.meta.env.VITE_ENGINE_URL ?? 'http://localhost:8000'
  )
  const [timeout, setTimeout_] = useState<number>(saved.timeout ?? 30)

  function handleSave() {
    localStorage.setItem(API_SETTINGS_KEY, JSON.stringify({ endpoint, timeout }))
    onSave()
    toast.ok('Connection settings saved')
  }

  return (
    <div>
      <SettingsHeading title="API & Engine" desc="Configure the connection to your local XTTS engine." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Engine endpoint</label>
          <input
            className="full-input" value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            placeholder="http://localhost:8000"
            style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
            The URL where your XTTS backend is running. Requires a page reload to take effect.
          </span>
        </div>

        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Request timeout (seconds)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min="5" max="120" step="5" value={timeout}
              onChange={e => setTimeout_(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 36 }}>
              {timeout}s
            </span>
          </div>
        </div>
      </div>

      <button className="btn btn--primary" onClick={handleSave} style={{ gap: 6 }}>
        {icons.check} Save connection
      </button>
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
    try {
      await clearAllAudio()
      toast.ok('Audio cache cleared')
    } catch {
      toast.err('Failed to clear cache')
    } finally {
      setClearing(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      await api.delete('/user')
      toast.ok('Account deleted')
      onDeleteAccount?.()
    } catch (e) {
      toast.err(e instanceof Error ? e.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <SettingsHeading title="Danger Zone" desc="Irreversible actions — proceed with caution." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Sign out of all devices</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Revoke all active sessions across every device.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }} onClick={onSignOut}>Sign out all</button>
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Clear all cached audio</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Removes all stored audio blobs from IndexedDB. Scripts are unaffected.</div>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }}
              onClick={handleClearCache}
              disabled={clearing}
            >
              {clearing ? <span className="spinner" /> : null} Clear cache
            </button>
          </div>
        </div>

        <div style={{ padding: 16, border: '1px solid rgba(192,57,43,0.25)', borderRadius: 'var(--radius-lg)', background: 'var(--err-lt)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--err)', marginBottom: 4 }}>Delete account</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>
            This will permanently delete your account, all projects, scripts, voice profiles, and audio. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              className="full-input" value={confirmDelete}
              onChange={e => setConfirmDelete(e.target.value)}
              placeholder='Type "delete" to confirm'
              style={{ flex: 1, borderColor: 'rgba(192,57,43,0.35)' }}
            />
            <button
              className="btn btn--danger btn--sm"
              disabled={confirmDelete !== 'delete' || deleting}
              style={{ flexShrink: 0 }}
              onClick={handleDeleteAccount}
            >
              {deleting ? <span className="spinner" /> : icons.trash} Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}