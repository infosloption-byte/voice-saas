import { useState, useEffect, useRef } from 'react'
import { api } from './api'
import { toast } from './toast'
import { icons, EMOJIS } from './constants'
import { fmt, uid, useAudioRecorder } from './audio'
import { useTTSEngine } from './hooks/useTTSEngine'
import { getAudioPrefs } from './hooks/useAudioSettings'
import { useEscapeKey } from './hooks/useEscapeKey'
import { type GateType } from './hooks/useGuestSession'
import { DEFAULT_GUEST_LIMITS } from './hooks/useGuestLimits'
import { activityLog, type LogEntry } from './activityLog'
import type { Project, Script, VoiceProfile, VoiceProfileSaveResult, EngineCaps, GuestLimits, User } from './types'

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
  useEscapeKey(onClose)
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts" onClick={e => e.target === e.currentTarget && onClose()}>
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
  useEscapeKey(onClose)
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New Project" onClick={e => e.target === e.currentTarget && onClose()}>
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
export function DashboardPage({ user, projects, voiceProfiles, onOpenProject, onGoProjects, onGoProfiles, onNewProject }: {
  user: User | null
  projects: Project[]
  voiceProfiles: VoiceProfile[]
  onOpenProject: (id: string) => void
  onGoProjects: () => void
  onGoProfiles: () => void
  onNewProject: () => void
}) {
  const allScripts    = projects.flatMap(p => p.scripts)
  const audioScripts  = allScripts.filter(s => s.hasAudio)
  const totalScripts  = allScripts.length
  const totalAudio    = audioScripts.length
  const totalChars    = audioScripts.reduce((a, s) => a + s.content.length, 0)
  const totalDurSec   = audioScripts.reduce((a, s) => a + (s.duration ?? 0), 0)
  const completionPct = totalScripts > 0 ? Math.round((totalAudio / totalScripts) * 100) : 0

  const [synthQuota, setSynthQuota]  = useState<{ used: number; limit: number; remaining: number; period: string } | null>(null)
  const [transQuota, setTransQuota]  = useState<{ used: number; limit: number; remaining: number; period: string } | null>(null)

  useEffect(() => {
    if (!user) return
    api.get('/synthesis/quota').then(d => setSynthQuota(d as typeof synthQuota)).catch(() => {})
    api.get('/translation/quota').then(d => setTransQuota(d as typeof transQuota)).catch(() => {})
  }, [user])

  const fmtDur = (sec: number) => {
    if (sec < 60)  return `${Math.round(sec)}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  }
  const fmtChars = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const planLabel = user?.plan_name
    ? user.plan_name.charAt(0).toUpperCase() + user.plan_name.slice(1)
    : 'Free'
  const planColor = user?.plan_name === 'pro' ? 'var(--accent)' : user?.plan_name === 'starter' ? 'var(--ok)' : 'var(--text-3)'

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] ?? ''

  return (
    <div>
      {/* ── Welcome header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-1)' }}>
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Here's what's happening with your voice projects</span>
            <span style={{ background: 'var(--bg-3)', border: '1px solid var(--border-1)', borderRadius: 20, padding: '1px 10px', fontSize: 11, fontWeight: 600, color: planColor }}>{planLabel} Plan</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={onGoProfiles} style={{ gap: 6 }}>
            {icons.profiles}<span>Voice Profiles</span>
          </button>
          <button className="btn btn--primary btn--sm" onClick={onNewProject} style={{ gap: 6 }}>
            {icons.plus}<span>New Project</span>
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="dash-stats">
        {[
          { label: 'Projects',      icon: icons.projects,  value: projects.length,           sub: 'Total workspaces' },
          { label: 'Scripts',       icon: icons.scripts,   value: totalScripts,               sub: 'Across all projects' },
          { label: 'Audio',         icon: icons.play,      value: fmtDur(totalDurSec),        sub: 'Generated voiceovers' },
          { label: 'Voices',        icon: icons.profiles,  value: voiceProfiles.length,       sub: 'Saved voice profiles' },
        ].map(({ label, icon, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-card__label">{icon} {label}</div>
            <div className="stat-card__value">{value}</div>
            <div className="stat-card__sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Usage + quota row ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Synthesis completion */}
        <div style={{ flex: '1 1 200px', background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>Project Completion</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${completionPct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', minWidth: 36 }}>{completionPct}%</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{totalAudio} of {totalScripts} scripts have audio</div>
        </div>

        {/* Characters synthesised */}
        <div style={{ flex: '1 1 200px', background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '14px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>Characters Synthesised</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>{fmtChars(totalChars)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{fmtDur(totalDurSec)} of audio · {totalAudio} voiceover{totalAudio !== 1 ? 's' : ''}</div>
        </div>

        {/* Synthesis quota */}
        {synthQuota !== null && (
          <div style={{ flex: '1 1 200px', background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>Synthesis Quota</div>
            {synthQuota.limit === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }}>Unlimited</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (synthQuota.used / synthQuota.limit) * 100)}%`, height: '100%', background: synthQuota.remaining === 0 ? 'var(--err)' : 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: synthQuota.remaining === 0 ? 'var(--err)' : 'var(--accent)', minWidth: 40, textAlign: 'right' }}>{synthQuota.used}/{synthQuota.limit}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{synthQuota.remaining} remaining this {synthQuota.period}</div>
              </>
            )}
          </div>
        )}

        {/* Translation quota */}
        {transQuota !== null && (
          <div style={{ flex: '1 1 200px', background: 'var(--bg-2)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>Translation Quota</div>
            {transQuota.limit === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }}>Unlimited</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (transQuota.used / transQuota.limit) * 100)}%`, height: '100%', background: transQuota.remaining === 0 ? 'var(--err)' : 'var(--ok)', borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: transQuota.remaining === 0 ? 'var(--err)' : 'var(--ok)', minWidth: 40, textAlign: 'right' }}>{transQuota.used}/{transQuota.limit}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{transQuota.remaining} remaining this {transQuota.period}</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="dash-grid">
        {/* ── Recent projects ── */}
        <div>
          <div className="section-head">
            <div><h2>Recent Projects</h2></div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProjects}>View all</button>
          </div>
          {projects.length === 0
            ? (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                {icons.projects}<p>No projects yet</p>
                <button className="btn btn--primary btn--sm" onClick={onNewProject}>Create first project</button>
              </div>
            )
            : projects.slice(0, 5).map(p => {
              const pTotal = p.scripts.length
              const pAudio = p.scripts.filter(s => s.hasAudio).length
              const pDur   = p.scripts.reduce((a, s) => a + (s.duration ?? 0), 0)
              const pPct   = pTotal > 0 ? Math.round((pAudio / pTotal) * 100) : 0
              return (
                <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)} style={{ marginBottom: 10, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="project-card__icon">{p.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="project-card__name">{p.name}</div>
                      <div className="project-card__meta">
                        <span>{pTotal} script{pTotal !== 1 ? 's' : ''}</span>
                        <span>{pAudio} audio</span>
                        {pDur > 0 && <span>{fmtDur(pDur)}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: pPct === 100 ? 'var(--ok)' : 'var(--accent)', minWidth: 32, textAlign: 'right' }}>{pPct}%</span>
                  </div>
                  {pTotal > 0 && (
                    <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${pPct}%`, height: '100%', background: pPct === 100 ? 'var(--ok)' : 'var(--accent)', borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>

        {/* ── Voice Profiles ── */}
        <div>
          <div className="section-head">
            <div><h2>Voice Profiles</h2></div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProfiles}>Manage</button>
          </div>
          {voiceProfiles.length === 0
            ? (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                {icons.profiles}<p>No voice profiles yet</p>
                <button className="btn btn--primary btn--sm" onClick={onGoProfiles}>Record a voice</button>
              </div>
            )
            : voiceProfiles.slice(0, 5).map(vp => {
              const usedBy = projects.reduce((a, p) =>
                a + p.scripts.filter(s => s.profileId === vp.profile_id && s.hasAudio).length, 0)
              return (
                <div key={vp.profile_id} className="project-card" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{vp.name[0]?.toUpperCase() ?? '?'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{vp.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {vp.duration ? `${vp.duration.toFixed(1)}s sample` : 'Voice profile'}
                        {usedBy > 0 && ` · ${usedBy} voiceover${usedBy !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <span className="tag tag--ok">Ready</span>
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}

// ── Activity Log Panel ─────────────────────────────────────────────
export function ActivityLogPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const runningCount = entries.filter(e => e.status === 'running').length

  useEffect(() => activityLog.subscribe(setEntries), [])

  function fmtTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  function elapsed(e: LogEntry) {
    const ms = (e.endedAt ?? Date.now()) - e.startedAt
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
      background: 'var(--bg-2)', borderLeft: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', zIndex: 900,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
      animation: 'slide-in-right 0.2s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Activity
            {runningCount > 0 && (
              <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                {runningCount} running
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Background task log</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => activityLog.clear()} title="Clear log" style={{ padding: '4px 8px', fontSize: 11 }}>Clear</button>
        <button className="btn btn--ghost btn--sm" onClick={onClose} title="Close">{icons.close}</button>
      </div>

      {/* Entries */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: '40px 20px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 28, height: 28, marginBottom: 8, opacity: 0.4 }}>
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p style={{ margin: 0 }}>No activity yet</p>
            <p style={{ margin: '4px 0 0', fontSize: 11 }}>Tasks like synthesis, translation,<br />and voice cloning will appear here</p>
          </div>
        ) : entries.map(e => (
          <div key={e.id} style={{
            padding: '10px 16px', borderBottom: '1px solid var(--border-1)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            {/* Status icon */}
            <div style={{ marginTop: 1, flexShrink: 0 }}>
              {e.status === 'running' && (
                <span style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              )}
              {e.status === 'done' && (
                <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14, color: 'var(--ok)' }}>
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {e.status === 'failed' && (
                <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14, color: 'var(--err)' }}>
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 500, lineHeight: 1.4 }}>{e.message}</div>
              {e.detail && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{e.detail}</div>}
              <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3, display: 'flex', gap: 8 }}>
                <span>{fmtTime(e.startedAt)}</span>
                {e.status !== 'running' && <span>{elapsed(e)}</span>}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Projects ───────────────────────────────────────────────────────
function projectStats(p: Project) {
  const total = p.scripts.length
  const withAudio = p.scripts.filter(s => s.hasAudio).length
  const totalDur = p.scripts.reduce((acc, s) => acc + (s.duration ?? 0), 0)
  const assemblyClips = (p.timelineClips ?? []).length
  return { total, withAudio, totalDur, assemblyClips }
}

function fmtDur(secs: number): string {
  if (secs <= 0) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function ProjectsPage({ projects, onOpen, onDelete, onNew }: {
  projects: Project[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmProject = projects.find(p => p.id === confirmId)
  useEscapeKey(() => setConfirmId(null), confirmId !== null)

  return (
    <div>
      <div className="proj-page-head">
        <div>
          <h2 className="proj-page-head__title">All Projects</h2>
          <p className="proj-page-head__sub">Manage your voiceover workspaces</p>
        </div>
      </div>

      <div className="project-grid">
        {/* New project card */}
        <button className="project-card project-card--new" onClick={onNew}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{icons.plus}</div>
            <span className="project-card--new__label">New Project</span>
            <span className="project-card--new__hint">Create a blank workspace</span>
          </div>
        </button>

        {projects.map(p => {
          const { total, withAudio, totalDur, assemblyClips } = projectStats(p)
          const ready = withAudio > 0
          const empty = total === 0
          const pct = total > 0 ? Math.round((withAudio / total) * 100) : 0

          return (
            <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              {/* Hover delete action */}
              <div className="project-card__actions">
                <button
                  className="btn btn--icon btn--ghost btn--sm"
                  title="Delete project"
                  onClick={e => { e.stopPropagation(); setConfirmId(p.id) }}
                >
                  {icons.trash}
                </button>
              </div>

              {/* Header */}
              <div className="project-card__header">
                <div className="project-card__icon">{p.emoji}</div>
                <div className="project-card__header-text">
                  <div className="project-card__name">{p.name}</div>
                  <div className="project-card__date">
                    {new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>

              {/* Description */}
              {p.description ? (
                <p className="project-card__desc">{p.description}</p>
              ) : (
                <p className="project-card__desc project-card__desc--empty">No description</p>
              )}

              {/* Stats row */}
              <div className="project-card__stats">
                <div className="project-card__stat">
                  <span className="project-card__stat-val">{total}</span>
                  <span className="project-card__stat-lbl">Scripts</span>
                </div>
                <div className="project-card__stat-divider" />
                <div className="project-card__stat">
                  <span className="project-card__stat-val">{withAudio}</span>
                  <span className="project-card__stat-lbl">With Audio</span>
                </div>
                <div className="project-card__stat-divider" />
                <div className="project-card__stat">
                  <span className="project-card__stat-val">{fmtDur(totalDur)}</span>
                  <span className="project-card__stat-lbl">Total Duration</span>
                </div>
                {assemblyClips > 0 && <>
                  <div className="project-card__stat-divider" />
                  <div className="project-card__stat">
                    <span className="project-card__stat-val">{assemblyClips}</span>
                    <span className="project-card__stat-lbl">Timeline</span>
                  </div>
                </>}
              </div>

              {/* Progress bar */}
              {total > 0 && (
                <div className="project-card__progress">
                  <div className="project-card__progress-bar" style={{ width: `${pct}%` }} />
                </div>
              )}

              {/* Tags */}
              <div className="project-card__tags">
                {ready   && <span className="tag tag--ok">Has Audio</span>}
                {empty   && <span className="tag tag--warn">Empty</span>}
                {assemblyClips > 0 && <span className="tag tag--info">Assembly</span>}
                {!ready && !empty && <span className="tag">In Progress</span>}
              </div>
            </div>
          )
        })}
      </div>

      {confirmId && confirmProject && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete project" onClick={() => setConfirmId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Delete project?</div>
            <div className="modal__body">
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
                <strong>{confirmProject.emoji} {confirmProject.name}</strong> and all{' '}
                {confirmProject.scripts.length} script{confirmProject.scripts.length !== 1 ? 's' : ''} will be
                permanently deleted. This cannot be undone.
              </p>
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmId(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => { onDelete(confirmId); setConfirmId(null) }}>
                {icons.trash} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Voice Profiles ─────────────────────────────────────────────────
export function ProfilesPage({ profiles, onRefresh, engineCaps: _engineCaps,
  isGuest, guestProfilesCount, guestPreviewsUsed, guestLimits = DEFAULT_GUEST_LIMITS,
  onGuestSave, onGuestDelete, onGuestGate, onIncrementPreview, getGuestVoiceBlob,
}: {
  profiles: VoiceProfile[]
  onRefresh: () => void
  engineCaps?: EngineCaps
  isGuest?: boolean
  guestProfilesCount?: number
  guestPreviewsUsed?: number
  guestLimits?: GuestLimits
  onGuestSave?: (name: string, blob: Blob, durationSecs: number) => Promise<boolean>
  onGuestDelete?: (profileId: string) => void
  onGuestGate?: (type: GateType) => void
  onIncrementPreview?: () => void
  getGuestVoiceBlob?: (profileId: string) => Promise<Blob | null>
}) {
  const recorder = useAudioRecorder()

  // Read current engine preference so preview uses the same engine as synthesis
  const { engine } = useTTSEngine()

  const [profileName, setProfileName] = useState('my-voice')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgWarn, setMsgWarn] = useState('')
  const [noiseSuppression, setNoiseSuppression] = useState(() => getAudioPrefs().noiseSuppression)
  const [gainVal, setGainVal] = useState(() => getAudioPrefs().defaultGain)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('Hello, this is a preview of my voice profile.')
  const [previewing, setPreviewing] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  useEscapeKey(() => setDeleteConfirmId(null), deleteConfirmId !== null)

  async function handleStart() {
    setMsg(''); setMsgWarn('')
    try {
      await recorder.start(noiseSuppression, gainVal)
    } catch (e: unknown) {
      const err = e as Error
      setMsg(`Error: Could not access microphone. ${err.message ?? ''}`)
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
        `⚠ Recording is only ${secs}s. Both engines need 6-30 s of clear speech ` +
        `for accurate voice cloning. Please re-record.`
      )
    } else if (secs > 35) {
      setMsgWarn(
        `⚠ Recording is ${secs}s — very long references can reduce quality. ` +
        `10-20 s of clean speech is ideal.`
      )
    }

    // ── Guest save path (IndexedDB only, no engine call) ──────────
    if (isGuest && onGuestSave) {
      const pCount = guestProfilesCount ?? 0
      if (pCount >= guestLimits.profile_limit) {
        onGuestGate?.('profile_limit')
        setSaving(false)
        return
      }
      const ok = await onGuestSave(profileName.trim() || 'my-voice', blob, secs)
      if (ok) {
        setMsg(`✓ Profile "${profileName}" saved locally`)
        onRefresh()
      } else {
        onGuestGate?.('profile_limit')
      }
      setSaving(false)
      return
    }

    // ── Registered user save path ──────────────────────────────────
    const fd = new FormData()
    const mime = blob.type.includes('wav') ? 'audio/wav' : 'audio/webm'
    const ext  = blob.type.includes('wav') ? 'wav' : 'webm'
    fd.append('file', new Blob([blob], { type: mime }), `voice.${ext}`)
    fd.append('profile_id', profileName.trim() || 'my-voice')
    fd.append('name', profileName.trim() || 'my-voice')
    fd.append('status', 'ready')

    try {
      const raw = await api.post('/voice-profiles', fd)
      const data = raw as VoiceProfileSaveResult
      if (data?.warning) setMsgWarn(`⚠ ${data.warning}`)
      setMsg(`✓ Profile "${data.profile_id ?? profileName}" saved${data.duration_seconds ? ` — ${data.duration_seconds}s` : ''}`)
      onRefresh()
    } catch (e: unknown) {
      const err = e as Error
      setMsg(`Error: ${err.message ?? 'Save failed. Is the AI engine running?'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(profile_id: string) {
    if (isGuest && onGuestDelete) {
      onGuestDelete(profile_id)
      onRefresh()
      return
    }
    try {
      await api.delete(`/voice-profiles/${profile_id}`)
      onRefresh()
    } catch (e: unknown) {
      const err = e as Error
      toast.err('Delete failed: ' + (err?.message ?? 'Unknown error'))
    }
  }

  async function handlePreview(profile_id: string) {
    if (!previewText.trim()) { toast.info('Enter some preview text first.'); return }

    // Guest preview limit check
    if (isGuest) {
      const used = guestPreviewsUsed ?? 0
      if (used >= guestLimits.preview_limit) {
        onGuestGate?.('preview_limit')
        return
      }
    }

    setPreviewing(true); setPreviewId(profile_id)
    try {
      let audioBlob: Blob
      if (isGuest) {
        const voiceBlob = await getGuestVoiceBlob?.(profile_id)
        if (!voiceBlob) {
          toast.err('Voice audio not found. Please re-record this profile.')
          return
        }
        const fd = new FormData()
        fd.append('text', previewText)
        fd.append('file', voiceBlob, 'voice.wav')
        fd.append('tts_engine', engine)
        fd.append('purpose', 'preview')
        audioBlob = await api.enginePost('/clone-voice', fd) as Blob
      } else {
        const engineKey = profiles.find(vp => vp.profile_id === profile_id)?.engine_key ?? profile_id
        const fd = new FormData()
        fd.append('text', previewText)
        fd.append('profile_id', engineKey)
        fd.append('language', 'en')
        fd.append('tts_engine', engine)
        audioBlob = await api.engineSynthesize(fd)
      }
      const previewUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(previewUrl)
      audio.addEventListener('ended', () => URL.revokeObjectURL(previewUrl), { once: true })
      audio.play()
      if (isGuest) onIncrementPreview?.()
    } catch (e: unknown) {
      console.error('Preview failed:', e)
      toast.err('Preview failed. Is the AI engine running?')
    } finally {
      setPreviewing(false); setPreviewId(null)
    }
  }

  // Engine label shown next to the preview input
  const engineLabel = engine === 'f5' ? 'F5-TTS' : 'XTTS v2'
  const engineColor = engine === 'f5' ? '#4278c9' : 'var(--accent)'
  const engineBg    = engine === 'f5' ? 'rgba(66,120,201,0.10)' : 'var(--accent-lt)'
  const engineBorder = engine === 'f5' ? 'rgba(66,120,201,0.25)' : 'var(--accent-mid)'

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
              {/* Preview text input + active engine badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input
                  className="text-input"
                  style={{ flex: 1 }}
                  value={previewText}
                  onChange={e => setPreviewText(e.target.value)}
                  placeholder="Preview text…"
                />
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
                  textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
                  background: engineBg, color: engineColor,
                  border: `1px solid ${engineBorder}`, flexShrink: 0,
                }} title={`Previewing with ${engineLabel}`}>
                  {engineLabel}
                </span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Preview uses your currently selected engine. Switch it in{' '}
                <strong>Settings → Audio & Synthesis</strong> or the workspace footer.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profiles.length === 0
              ? <div className="empty-state">{icons.profiles}<p>Record your first voice profile</p></div>
              : profiles.map(vp => (
                <div key={vp.profile_id} className="profile-card">
                  <div className="profile-avatar">{(vp.profile_id?.[0] ?? '?').toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div className="profile-card__name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {vp.profile_id}
                      {isGuest && (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--warn-lt)', color: 'var(--warn)', border: '1px solid rgba(160,117,48,0.3)', fontWeight: 600 }}>
                          Local only
                        </span>
                      )}
                    </div>
                    <div className="profile-card__meta">
                      Voice profile · Ready{vp.duration ? ` · ${vp.duration.toFixed(1)}s` : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => handlePreview(vp.profile_id)}
                    disabled={previewing}
                    title={`Preview with ${engineLabel}`}
                  >
                    {previewing && previewId === vp.profile_id ? <span className="spinner" /> : icons.speaker}
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => setDeleteConfirmId(vp.profile_id)}
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

      {deleteConfirmId && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete voice profile" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Delete voice profile?</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              This voice profile will be permanently deleted. This cannot be undone.
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => {
                handleDelete(deleteConfirmId)
                setDeleteConfirmId(null)
              }}>{icons.trash} Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}