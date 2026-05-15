import { useState } from 'react'
import { icons } from './constants'
import { LogoMark } from './LandingPage'

// ═══════════════════════════════════════════════════════════════════
type SettingsSection = 'profile' | 'account' | 'audio' | 'appearance' | 'notifications' | 'api' | 'danger'

interface SettingsPageProps {
  darkMode?: boolean
  onToggleDark?: () => void
  onSignOut?: () => void
  user?: { name: string; email: string }
}

export function SettingsPage({ darkMode = false, onToggleDark, onSignOut, user = { name: 'Alex Smith', email: 'alex@example.com' } }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('profile')
  const [saved, setSaved] = useState(false)

  const navItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Profile', icon: icons.user },
    { id: 'account', label: 'Account & Security', icon: icons.shield },
    { id: 'audio', label: 'Audio & Synthesis', icon: icons.volume },
    { id: 'appearance', label: 'Appearance', icon: icons.light },
    { id: 'notifications', label: 'Notifications', icon: icons.bell },
    { id: 'api', label: 'API & Engine', icon: icons.api },
    { id: 'danger', label: 'Danger Zone', icon: icons.trash },
  ]

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div className="topbar" style={{ borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={22} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>Settings</span>
        </div>
        <div style={{ flex: 1 }} />
        {saved && (
          <div className="msg msg--ok" style={{ padding: '5px 12px', width: 'auto', display: 'flex', alignItems: 'center', gap: 6, animation: 'modal-in 0.18s ease' }}>
            <span style={{ width: 14, height: 14 }}>{icons.check}</span> Changes saved
          </div>
        )}
      </div>

      <div className="settings-layout" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', flex: 1 }}>
        {/* Sidebar nav */}
        <div className="settings-nav" style={{
          borderRight: '1px solid var(--border)', padding: '16px 8px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
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
          <button className="btn btn--ghost" style={{ fontSize: 12.5, width: '100%', justifyContent: 'flex-start', color: 'var(--err)', gap: 7, padding: '7px 10px', marginTop: 8 }} onClick={onSignOut}>
            Sign out
          </button>
        </div>

        {/* Content */}
        <div className="settings-content" style={{ padding: '32px 40px', maxWidth: 640 }}>
          {section === 'profile' && <ProfileSettings user={user} onSave={handleSave} />}
          {section === 'account' && <AccountSettings onSave={handleSave} />}
          {section === 'audio' && <AudioSettings onSave={handleSave} />}
          {section === 'appearance' && <AppearanceSettings darkMode={darkMode} onToggleDark={onToggleDark} onSave={handleSave} />}
          {section === 'notifications' && <NotificationSettings onSave={handleSave} />}
          {section === 'api' && <ApiSettings onSave={handleSave} />}
          {section === 'danger' && <DangerSettings onSignOut={onSignOut} />}
        </div>
      </div>
    </div>
  )
}

// ── Settings sub-sections ────────────────────────────────────────────

function SettingsHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1)', letterSpacing: '-0.3px', marginBottom: 4 }}>{title}</h2>
      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{desc}</p>
    </div>
  )
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingBottom: 20, borderBottom: '1px solid var(--border-3)', marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{hint}</div>}
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
        transition: 'background 0.18s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        transition: 'left 0.18s',
      }} />
    </button>
  )
}

function ProfileSettings({ user, onSave }: { user: { name: string; email: string }; onSave: () => void }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [bio, setBio] = useState('')

  return (
    <div>
      <SettingsHeading title="Profile" desc="Your public identity within VoiceStudio." />

      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, padding: '16px', background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {name[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{email}</div>
          <button className="btn btn--ghost btn--sm" style={{ gap: 5, fontSize: 12 }}>{icons.edit} Change avatar</button>
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
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Bio <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <textarea className="full-input" value={bio} onChange={e => setBio(e.target.value)}
            rows={3} placeholder="Podcaster, narrator, creator…"
            style={{ resize: 'vertical', lineHeight: 1.6 }} />
        </div>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save profile</button>
    </div>
  )
}

function AccountSettings({ onSave }: { onSave: () => void }) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [twoFa, setTwoFa] = useState(false)
  const [sessions, setSessions] = useState(true)

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

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6, marginTop: 8 }}>{icons.check} Update security</button>
    </div>
  )
}

function AudioSettings({ onSave }: { onSave: () => void }) {
  const [defaultLang, setDefaultLang] = useState('en')
  const [defaultSpeed, setDefaultSpeed] = useState(1.0)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [autoGain, setAutoGain] = useState(true)
  const [defaultGain, setDefaultGain] = useState(0.85)

  const languages = [
    { code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' }, { code: 'de', label: 'German' },
    { code: 'ja', label: 'Japanese' }, { code: 'zh', label: 'Chinese' },
  ]

  return (
    <div>
      <SettingsHeading title="Audio & Synthesis" desc="Default settings for voice synthesis and recording." />

      <SettingsRow label="Default language" hint="Used when creating new scripts.">
        <select className="full-input" value={defaultLang} onChange={e => setDefaultLang(e.target.value)} style={{ width: 160, padding: '6px 10px' }}>
          {languages.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </SettingsRow>

      <SettingsRow label="Default speech speed" hint={`${defaultSpeed.toFixed(1)}× — affects all new scripts`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" min="0.5" max="2" step="0.05" value={defaultSpeed}
            onChange={e => setDefaultSpeed(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }} />
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
          <input type="range" min="0.1" max="2" step="0.05" value={defaultGain}
            onChange={e => setDefaultGain(Number(e.target.value))}
            style={{ width: 120, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{defaultGain.toFixed(2)}</span>
        </div>
      </SettingsRow>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save audio settings</button>
    </div>
  )
}

function AppearanceSettings({ darkMode, onToggleDark, onSave }: { darkMode?: boolean; onToggleDark?: () => void; onSave: () => void }) {
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div>
      <SettingsHeading title="Appearance" desc="Customise how VoiceStudio looks and feels." />

      <SettingsRow label="Dark mode" hint="Switch between light and dark interface themes.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 15, height: 15, color: 'var(--text-3)' }}>{darkMode ? icons.dark : icons.light}</span>
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
            >{d}</button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Collapsed sidebar" hint="Hides text labels in the sidebar navigation.">
        <Toggle checked={sidebarCollapsed} onChange={setSidebarCollapsed} />
      </SettingsRow>

      <div style={{ margin: '20px 0', padding: 16, background: 'var(--bg-2)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-3)', marginBottom: 10 }}>Preview</div>
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

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save appearance</button>
    </div>
  )
}

function NotificationSettings({ onSave }: { onSave: () => void }) {
  const [synth, setSynth] = useState(true)
  const [export_, setExport] = useState(true)
  const [errors, setErrors] = useState(true)
  const [updates, setUpdates] = useState(false)

  return (
    <div>
      <SettingsHeading title="Notifications" desc="Choose when VoiceStudio should alert you." />

      <SettingsRow label="Synthesis complete" hint="Notify when a script has finished generating audio.">
        <Toggle checked={synth} onChange={setSynth} />
      </SettingsRow>
      <SettingsRow label="Export complete" hint="Notify when a timeline export has finished.">
        <Toggle checked={export_} onChange={setExport} />
      </SettingsRow>
      <SettingsRow label="Engine errors" hint="Alert if the local XTTS engine encounters a problem.">
        <Toggle checked={errors} onChange={setErrors} />
      </SettingsRow>
      <SettingsRow label="Product updates" hint="Occasional announcements about new features.">
        <Toggle checked={updates} onChange={setUpdates} />
      </SettingsRow>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save preferences</button>
    </div>
  )
}

function ApiSettings({ onSave }: { onSave: () => void }) {
  const [endpoint, setEndpoint] = useState('http://localhost:8000')
  const [timeout, setTimeout_] = useState(30)
  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState('vs_live_xxxxxxxxxxxxxxxxxxxxx')

  return (
    <div>
      <SettingsHeading title="API & Engine" desc="Configure the connection to your local XTTS engine." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Engine endpoint</label>
          <input className="full-input" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://localhost:8000" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>The URL where your XTTS backend is running.</span>
        </div>

        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Request timeout (seconds)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min="5" max="120" step="5" value={timeout}
              onChange={e => setTimeout_(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 36 }}>{timeout}s</span>
          </div>
        </div>

        <div className="field">
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>API key <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <div style={{ position: 'relative' }}>
            <input className="full-input" type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, paddingRight: 38 }} />
            <button onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', width: 16, height: 16, padding: 0 }}>
              {showKey ? icons.eyeOff : icons.eye}
            </button>
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 20 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 2px var(--ok-lt)', animation: 'blink 2.5s infinite', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--ok)', fontWeight: 500 }}>Engine connected</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>XTTS v2.0.3</span>
      </div>

      <button className="btn btn--primary" onClick={onSave} style={{ gap: 6 }}>{icons.check} Save connection</button>
    </div>
  )
}

function DangerSettings({ onSignOut }: { onSignOut?: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState('')

  return (
    <div>
      <SettingsHeading title="Danger Zone" desc="Irreversible actions — proceed with caution." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Sign out */}
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Sign out of all devices</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Revoke all active sessions across every device.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }} onClick={onSignOut}>
              Sign out all
            </button>
          </div>
        </div>

        {/* Clear audio */}
        <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>Clear all cached audio</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Removes all stored audio blobs from IndexedDB. Scripts are unaffected.</div>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ color: 'var(--warn)', borderColor: 'rgba(160,117,48,0.35)', flexShrink: 0 }}>
              Clear cache
            </button>
          </div>
        </div>

        {/* Delete account */}
        <div style={{ padding: 16, border: '1px solid rgba(192,57,43,0.25)', borderRadius: 'var(--radius-lg)', background: 'var(--err-lt)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--err)', marginBottom: 4 }}>Delete account</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>
            This will permanently delete your account, all projects, scripts, voice profiles, and audio. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input className="full-input" value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)}
              placeholder='Type "delete" to confirm'
              style={{ flex: 1, borderColor: 'rgba(192,57,43,0.35)' }} />
            <button className="btn btn--danger btn--sm" disabled={confirmDelete !== 'delete'} style={{ flexShrink: 0 }}>
              {icons.trash} Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DEMO — wires all pages together (remove in production)
// ═══════════════════════════════════════════════════════════════════
type DemoPage = 'landing' | 'signin' | 'signup' | 'settings'

export default function Demo() {
  const [page, setPage] = useState<DemoPage>('landing')
  const [darkMode, setDarkMode] = useState(false)

  return (
    <>
      {/* Page switcher (dev only) */}
      <div style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
        display: 'flex', gap: 6, background: 'var(--surface)', padding: '6px 8px',
        borderRadius: 'var(--radius)', border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {(['landing', 'signin', 'signup', 'settings'] as DemoPage[]).map(p => (
          <button key={p} className={`btn btn--sm ${page === p ? 'btn--primary' : 'btn--ghost'}`}
            style={{ fontSize: 11, textTransform: 'capitalize' }} onClick={() => setPage(p)}>{p}</button>
        ))}
      </div>

      {page === 'landing' && (
        <LandingPage onSignIn={() => setPage('signin')} onSignUp={() => setPage('signup')} />
      )}
      {page === 'signin' && (
        <SignInPage onSignIn={() => setPage('settings')} onSignUp={() => setPage('signup')} onBack={() => setPage('landing')} />
      )}
      {page === 'signup' && (
        <SignUpPage onSignUp={() => setPage('settings')} onSignIn={() => setPage('signin')} onBack={() => setPage('landing')} />
      )}
      {page === 'settings' && (
        <SettingsPage darkMode={darkMode} onToggleDark={() => setDarkMode(v => !v)} onSignOut={() => setPage('landing')} />
      )}
    </>
  )
}