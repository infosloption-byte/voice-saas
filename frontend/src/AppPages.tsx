import { useState } from 'react'
import { api } from './api'
import { icons, EMOJIS } from './constants'
import { fmt, uid, useAudioRecorder } from './audio'
import type { Project, Script, VoiceProfile } from './types'

// ── Wave visualiser ────────────────────────────────────────────────
export function WaveVisualiser({ active }: { active: boolean }) {
  return (
    <div className="wave-vis" aria-hidden>
      {Array.from({ length: 28 }).map((_, i) => (
        <span key={i} className={`bar ${active ? 'bar--live' : ''}`} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ── Mic button ─────────────────────────────────────────────────────
export function MicBtn({ recording, onClick, disabled, label }: {
  recording: boolean; onClick: () => void; disabled?: boolean; label: string
}) {
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

// ── Shortcuts modal ────────────────────────────────────────────────
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: 'Space',              desc: 'Play / Pause' },
    { keys: 'Home',               desc: 'Rewind to start' },
    { keys: '← →',               desc: 'Nudge playhead ±1s' },
    { keys: 'Del / Backspace',    desc: 'Remove selected clip' },
    { keys: 'Ctrl+Z',             desc: 'Undo (text & timeline)' },
    { keys: 'Ctrl+Y / Ctrl+Shift+Z', desc: 'Redo (text & timeline)' },
    { keys: 'Ctrl+S',             desc: 'Save script' },
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

// ── New project modal ──────────────────────────────────────────────
export function NewProjectModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (name: string, emoji: string, desc: string) => void
}) {
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

// ── Dashboard ──────────────────────────────────────────────────────
export function DashboardPage({ projects, voiceProfiles, onOpenProject, onGoProjects, onGoProfiles }: {
  projects: Project[]
  voiceProfiles: VoiceProfile[]
  onOpenProject: (id: string) => void
  onGoProjects: () => void
  onGoProfiles: () => void
}) {
  const totalScripts = projects.reduce((a, p) => a + p.scripts.length, 0)
  const totalVoiceovers = projects.reduce((a, p) => a + p.scripts.filter(s => s.hasAudio).length, 0)
  return (
    <div>
      <div className="dash-stats">
        {[
          { label: 'Projects',   icon: icons.projects,  value: projects.length,      sub: 'Workspaces' },
          { label: 'Scripts',    icon: icons.scripts,   value: totalScripts,          sub: 'Across all projects' },
          { label: 'Voiceovers', icon: icons.play,      value: totalVoiceovers,       sub: 'Generated audio' },
          { label: 'Profiles',   icon: icons.profiles,  value: voiceProfiles.length,  sub: 'Voice models' },
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
export function ProjectsPage({ projects, onOpen, onDelete, onNew }: {
  projects: Project[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
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

// ── Voice Profiles ─────────────────────────────────────────────────
export function ProfilesPage({ profiles, onRefresh }: { profiles: VoiceProfile[]; onRefresh: () => void }) {
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
    } else if (secs > 35) {
      setMsgWarn(
        `⚠ Recording is ${secs}s — very long references can confuse XTTS. ` +
        `10-20 s of clean speech is ideal.`
      )
    }

    const fd = new FormData()
    const mime = blob.type.includes('wav') ? 'audio/wav' : 'audio/webm'
    const ext  = blob.type.includes('wav') ? 'wav' : 'webm'
    fd.append('file', new Blob([blob], { type: mime }), `voice.${ext}`)
    fd.append('profile_id', profileName.trim() || 'my-voice')
    fd.append('name', profileName.trim() || 'my-voice')
    fd.append('status', 'ready')

    try {
      const data = await api.post('/voice-profiles', fd)
      if (data?.warning) setMsgWarn(`⚠ ${data.warning}`)
      setMsg(`✓ Profile "${data.profile_id ?? profileName}" saved${data.duration_seconds ? ` — ${data.duration_seconds}s` : ''}`)
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
              <p className="record-script__text">"Have you ever stood on a hilltop and watched the sunset? The colours shift from gold to deep red. There is nothing quite like it. I think everyone should see it at least once."</p>
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