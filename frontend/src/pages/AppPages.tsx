import React, { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { toast } from '../lib/toast'
import { icons, EMOJIS } from '../lib/constants'
import { fmt, uid, useAudioRecorder } from '../lib/audio'
import { useTTSEngine } from '../hooks/useTTSEngine'
import { EngineSwitcher } from '../components/EngineSwitcher'
import { getAudioPrefs } from '../hooks/useAudioSettings'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { type GateType } from '../hooks/useGuestSession'
import { DEFAULT_GUEST_LIMITS } from '../hooks/useGuestLimits'
import { activityLog, type LogEntry } from '../lib/activityLog'
import type { Project, Script, VoiceProfile, VoiceProfileSaveResult, EngineCaps, GuestLimits, User } from '../lib/types'

// Rotating scripts for voice-profile recording. Reading a different
// sentence for each take — rather than the same one four times — gives
// the clone a wider spread of phonemes/intonation to learn from, and
// keeps the reader from settling into a flat, memorized-sounding cadence
// on repeats 2-4. Index by current take count (wraps if MAX_CLIPS ever
// exceeds this list).
const RECORD_PROMPTS = [
  'Have you ever stood on a hilltop and watched the sunset? The colours shift from gold to deep red. There is nothing quite like it. I think everyone should see it at least once.',
  'The old market was already busy by seven in the morning. Vendors called out prices, carts rattled over the cobblestones, and the smell of fresh bread drifted from the corner bakery.',
  'Could you pass me that folder on the shelf? Thanks. I need to check a few numbers before the meeting starts, otherwise we will be guessing all afternoon.',
  'It rained for three days straight, so we stayed inside and played cards by the window, watching the storm roll slowly across the valley below.',
]

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
        <div className="dash-panel">
          <div className="section-head">
            <div>
              <h2>Recent Projects</h2>
              <p>Your latest voiceover workspaces</p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProjects}>View all →</button>
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
              const status = pTotal === 0 ? 'empty' : pPct === 100 ? 'complete' : 'progress'
              return (
                <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)} style={{ marginBottom: 10, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="project-card__icon">{p.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="project-card__name">{p.name}</div>
                      <div className="project-card__meta" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>{pTotal} script{pTotal !== 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span>{pAudio} voiceover{pAudio !== 1 ? 's' : ''}</span>
                        {pDur > 0 && <><span>·</span><span>{fmtDur(pDur)} audio</span></>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      {status === 'complete' && <span className="tag tag--ok">Complete</span>}
                      {status === 'progress' && <span className="tag tag--info">{pPct}% done</span>}
                      {status === 'empty'    && <span className="tag tag--warn">Empty</span>}
                      <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                        {new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  {pTotal > 0 && (
                    <div style={{ height: 3, background: 'var(--bg-3)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                      <div style={{ width: `${pPct}%`, height: '100%', background: pPct === 100 ? 'var(--ok)' : 'var(--accent)', borderRadius: 2, transition: 'width 0.4s' }} />
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>

        {/* ── Voice Profiles ── */}
        <div className="dash-panel">
          <div className="section-head">
            <div>
              <h2>Voice Profiles</h2>
              <p>Cloned voices ready for synthesis</p>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={onGoProfiles}>Manage →</button>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="profile-avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{vp.name[0]?.toUpperCase() ?? '?'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{vp.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 10 }}>
                        {vp.duration && <span>{vp.duration.toFixed(1)}s voice sample</span>}
                        {usedBy > 0 && <span>· used in {usedBy} voiceover{usedBy !== 1 ? 's' : ''}</span>}
                        {!vp.duration && usedBy === 0 && <span>Not used yet</span>}
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
const EVENT_LABELS: Record<string, string> = {
  synthesis:   'Synthesis',
  translation: 'Translation',
  voice_clone: 'Voice Clone',
  export:      'Export',
  delete:      'Deleted',
  task:        'Task',
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  synthesis: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
      <path d="M3 8h2l2-5 2 10 2-5h2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  translation: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
      <path d="M2 4h6M5 2v2M3 4c0 2 1.5 4 4 4" strokeLinecap="round" />
      <path d="M8 12l2-5 2 5M9.5 10.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  voice_clone: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
      <path d="M8 2a3 3 0 0 1 3 3v3a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M4 9v1a4 4 0 0 0 8 0V9" strokeLinecap="round" />
    </svg>
  ),
  export: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 13, height: 13 }}>
      <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h10" strokeLinecap="round" />
    </svg>
  ),
}

function LogEntryCard({ e, showProject, projectName }: {
  e: LogEntry
  showProject: boolean
  projectName: string | null
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (e.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [e.status])

  function elapsed() {
    const ms = (e.endedAt ?? now) - e.startedAt
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`
  }

  function fmtTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Parse structured detail: "key:value|key:value"
  const meta: Record<string, string> = {}
  if (e.detail) {
    if (e.detail.includes('|') || e.detail.includes(':')) {
      e.detail.split('|').forEach(part => {
        const [k, ...rest] = part.split(':')
        if (rest.length) meta[k.trim()] = rest.join(':').trim()
      })
    }
  }
  const hasStructuredMeta = Object.keys(meta).length > 0
  const plainDetail = hasStructuredMeta ? null : e.detail

  const eventIcon = EVENT_ICONS[e.eventType ?? ''] ?? null
  const eventLabel = e.eventType && e.eventType !== 'task' ? (EVENT_LABELS[e.eventType] ?? e.eventType) : null

  const statusColor = e.status === 'done' ? 'var(--ok)' : e.status === 'failed' ? 'var(--err)' : 'var(--accent)'

  return (
    <div style={{
      margin: '6px 10px',
      borderRadius: 8,
      border: `1px solid ${e.status === 'running' ? 'color-mix(in srgb, var(--accent) 30%, var(--border))' : 'var(--border-1)'}`,
      background: e.status === 'running'
        ? 'color-mix(in srgb, var(--accent) 5%, var(--surface))'
        : 'var(--bg)',
      overflow: 'hidden',
    }}>
      {/* Card header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 11px 7px' }}>
        {/* Status dot / spinner */}
        <div style={{ marginTop: 2, flexShrink: 0 }}>
          {e.status === 'running' && (
            <span style={{
              width: 12, height: 12, border: '2px solid var(--accent)',
              borderTopColor: 'transparent', borderRadius: '50%',
              display: 'inline-block', animation: 'spin 0.7s linear infinite',
            }} />
          )}
          {e.status === 'done' && (
            <svg viewBox="0 0 14 14" fill="none" style={{ width: 14, height: 14, color: 'var(--ok)' }}>
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4.5 7l2 2 3-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {e.status === 'failed' && (
            <svg viewBox="0 0 14 14" fill="none" style={{ width: 14, height: 14, color: 'var(--err)' }}>
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {/* Title + type badge */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.3 }}>
              {e.message}
            </span>
            {eventLabel && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                color: statusColor,
                background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
                borderRadius: 4, padding: '1px 5px',
              }}>
                {eventIcon}{eventLabel.toUpperCase()}
              </span>
            )}
          </div>
          {plainDetail && (
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>{plainDetail}</div>
          )}
        </div>

        {/* Time */}
        <div style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, textAlign: 'right', marginTop: 1 }}>
          {fmtTime(e.startedAt)}
        </div>
      </div>

      {/* Meta chips row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4,
        padding: '0 11px 8px',
        borderTop: (hasStructuredMeta || e.status !== 'running') ? '1px solid var(--border-1)' : undefined,
        paddingTop: (hasStructuredMeta || e.status !== 'running') ? 6 : 0,
      }}>
        {/* Elapsed time chip */}
        <span style={{
          fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)',
          borderRadius: 4, padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 3,
        }}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ width: 9, height: 9 }}>
            <circle cx="6" cy="6" r="5" />
            <path d="M6 3.5V6l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {elapsed()}
        </span>

        {/* Status chip */}
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: statusColor,
          background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
          borderRadius: 4, padding: '2px 6px',
        }}>
          {e.status === 'running' ? 'Running' : e.status === 'done' ? 'Completed' : 'Failed'}
        </span>

        {/* Structured meta chips */}
        {meta['model'] && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 6px' }}>
            {meta['model']}
          </span>
        )}
        {meta['words'] && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 6px' }}>
            {meta['words']} words
          </span>
        )}
        {meta['voice'] && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 6px' }}>
            🎤 {meta['voice']}
          </span>
        )}
        {meta['chars'] && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 6px' }}>
            {meta['chars']} chars
          </span>
        )}
        {meta['langs'] && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 4, padding: '2px 6px' }}>
            {meta['langs']}
          </span>
        )}

        {/* Project chip (when showing all projects) */}
        {showProject && projectName && (
          <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-lt)', borderRadius: 4, padding: '2px 6px', fontWeight: 500, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectName}
          </span>
        )}
      </div>
    </div>
  )
}

export function ActivityLogPanel({ open, onClose, projects, lockedProjectId }: {
  open: boolean
  onClose: () => void
  projects: Project[]
  lockedProjectId?: string | null
}) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [tabId, setTabId]     = useState<string | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const filterId = lockedProjectId ?? tabId
  const lockedProject = lockedProjectId ? projects.find(p => p.id === lockedProjectId) : null

  useEscapeKey(onClose, open)

  useEffect(() => activityLog.subscribe(setEntries), [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    activityLog.fetch(filterId === 'all' ? undefined : filterId)
      .finally(() => setLoading(false))
  }, [open, filterId])

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      activityLog.fetch(filterId === 'all' ? undefined : filterId)
    }, 15_000)
    return () => clearInterval(id)
  }, [open, filterId])

  async function handleClear() {
    const ok = await activityLog.clear(filterId === 'all' ? undefined : filterId)
    if (!ok) toast.err('Failed to clear activity log — try again')
  }

  const visible = filterId === 'all'
    ? entries
    : entries.filter(e => e.projectId === filterId)

  const running  = visible.filter(e => e.status === 'running')
  const finished = visible.filter(e => e.status !== 'running')

  function projectName(id?: string) {
    if (!id) return null
    return projects.find(p => p.id === id)?.name ?? null
  }

  function fmtDate(ts: number) {
    const d = new Date(ts)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Today'
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  // Group finished entries by date
  type Group = { label: string; entries: LogEntry[] }
  const finishedGroups = finished.reduce<Group[]>((acc, e) => {
    const label = fmtDate(e.startedAt)
    const last = acc[acc.length - 1]
    if (last && last.label === label) last.entries.push(e)
    else acc.push({ label, entries: [e] })
    return acc
  }, [])

  const sectionLabel = { fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.07em', padding: '10px 12px 4px' }

  return (
    <div className={`log-drawer${open ? ' log-drawer--open' : ''}`}>
      {/* Header */}
      <div style={{ padding: '13px 14px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          {/* Icon */}
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 15, height: 15, color: 'var(--text-3)', flexShrink: 0 }}>
            <rect x="2" y="2" width="14" height="14" rx="2.5" />
            <path d="M5.5 6h7M5.5 9h7M5.5 12h4" strokeLinecap="round" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
              Background tasks
              {running.length > 0 && (
                <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 9.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.8)', animation: 'pulse 1.2s infinite', display: 'inline-block' }} />
                  {running.length}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 1 }}>
              {lockedProject
                ? <>{lockedProject.emoji} <strong style={{ color: 'var(--text-2)' }}>{lockedProject.name}</strong></>
                : 'Synthesis · Translation · Voice Clone'}
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose} title="Close" style={{ padding: '4px 6px' }}>{icons.close}</button>
        </div>

        {/* Project filter tabs */}
        {!lockedProjectId && projects.length > 0 && (
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 10 }}>
            <button
              className={`btn btn--sm ${tabId === 'all' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setTabId('all')}
              style={{ fontSize: 10.5, flexShrink: 0, padding: '3px 8px' }}
            >All</button>
            {projects.slice(0, 6).map(p => (
              <button
                key={p.id}
                className={`btn btn--sm ${tabId === p.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setTabId(p.id)}
                title={p.name}
                style={{ fontSize: 10.5, flexShrink: 0, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 8px' }}
              >{p.emoji} {p.name}</button>
            ))}
          </div>
        )}
        {lockedProjectId && <div style={{ paddingBottom: 10 }} />}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {loading && entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)', fontSize: 12 }}>
            <span className="spinner" style={{ width: 18, height: 18, marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12.5, padding: '44px 20px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ width: 28, height: 28, opacity: 0.3, display: 'block', margin: '0 auto 10px' }}>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
            </svg>
            <div style={{ fontWeight: 500, color: 'var(--text-2)' }}>No tasks yet</div>
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>Synthesis, translation and voice<br />clone tasks appear here</div>
          </div>
        ) : (
          <>
            {/* ── Running section ── */}
            {running.length > 0 && (
              <div>
                <div style={sectionLabel}>Running</div>
                {running.map(e => (
                  <LogEntryCard
                    key={e.id} e={e}
                    showProject={filterId === 'all'}
                    projectName={projectName(e.projectId)}
                  />
                ))}
              </div>
            )}

            {/* ── Finished section ── */}
            {finishedGroups.length > 0 && (
              <div>
                <div style={{ ...sectionLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>Finished</span>
                </div>
                {finishedGroups.map(g => (
                  <div key={g.label}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', padding: '6px 12px 2px', opacity: 0.7 }}>{g.label}</div>
                    {g.entries.map(e => (
                      <LogEntryCard
                        key={e.id} e={e}
                        showProject={filterId === 'all'}
                        projectName={projectName(e.projectId)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
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
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'progress'>('recent')
  const confirmProject = projects.find(p => p.id === confirmId)
  useEscapeKey(() => setConfirmId(null), confirmId !== null)

  const totalScripts = projects.reduce((a, p) => a + p.scripts.length, 0)
  const totalAudio   = projects.reduce((a, p) => a + p.scripts.filter(s => s.hasAudio).length, 0)
  const totalDurSec  = projects.reduce((a, p) => a + p.scripts.reduce((x, s) => x + (s.duration ?? 0), 0), 0)

  const visible = projects
    .filter(p => !search.trim() || (p.name + ' ' + p.description).toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'progress') {
        const pa = a.scripts.length ? a.scripts.filter(s => s.hasAudio).length / a.scripts.length : -1
        const pb = b.scripts.length ? b.scripts.filter(s => s.hasAudio).length / b.scripts.length : -1
        return pb - pa
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

  return (
    <div>
      <div className="proj-page-head">
        <div>
          <h2 className="proj-page-head__title">All Projects</h2>
          <p className="proj-page-head__sub">
            {projects.length} project{projects.length !== 1 ? 's' : ''} · {totalScripts} script{totalScripts !== 1 ? 's' : ''} · {totalAudio} voiceover{totalAudio !== 1 ? 's' : ''}{totalDurSec > 0 ? ` · ${fmtDur(totalDurSec)} of audio` : ''}
          </p>
        </div>
      </div>

      {/* Search + sort toolbar */}
      {projects.length > 1 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
              style={{ width: 14, height: 14, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }}>
              <circle cx="9" cy="9" r="6" /><line x1="13.5" y1="13.5" x2="17" y2="17" strokeLinecap="round" />
            </svg>
            <input
              className="full-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              style={{ paddingLeft: 32, fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([['recent', 'Recent'], ['name', 'Name'], ['progress', 'Progress']] as const).map(([key, label]) => (
              <button
                key={key}
                className={`btn btn--sm ${sortBy === key ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setSortBy(key)}
                style={{ fontSize: 12 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {search.trim() && visible.length === 0 && (
        <div className="empty-state" style={{ padding: '30px 0' }}>
          <p>No projects match “{search.trim()}”</p>
        </div>
      )}

      <div className="project-grid">
        {/* New project card */}
        <button className="project-card project-card--new" onClick={onNew}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{icons.plus}</div>
            <span className="project-card--new__label">New Project</span>
            <span className="project-card--new__hint">Create a blank workspace</span>
          </div>
        </button>

        {visible.map(p => {
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
                <strong>{confirmProject.emoji} {confirmProject.name}</strong> will be permanently deleted,
                along with everything that belongs to it. This cannot be undone.
              </p>
              {(() => {
                const audioCount = confirmProject.scripts.filter(s => s.hasAudio).length
                const clipCount  = (confirmProject.timelineClips ?? []).filter(c => !c.isGap).length
                const items = [
                  `${confirmProject.scripts.length} script${confirmProject.scripts.length !== 1 ? 's' : ''}`,
                  audioCount > 0 ? `${audioCount} generated audio clip${audioCount !== 1 ? 's' : ''}` : null,
                  clipCount  > 0 ? `${clipCount} assembly timeline clip${clipCount !== 1 ? 's' : ''}` : null,
                ].filter(Boolean) as string[]
                return (
                  <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
                    {items.map(it => <li key={it}>{it}</li>)}
                  </ul>
                )
              })()}
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
export function ProfilesPage({ profiles, onRefresh, engineCaps,
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
  const { engine, setEngine } = useTTSEngine()

  // Must match VoiceProfileStore::MAX_CLIPS (Laravel) and MAX_PROFILE_CLIPS
  // (ai-engine) — the number of reference clips a profile can hold.
  const MAX_CLIPS = 4

  const [profileName, setProfileName] = useState('my-voice')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgWarn, setMsgWarn] = useState('')
  const [noiseSuppression, setNoiseSuppression] = useState(() => getAudioPrefs().noiseSuppression)
  const [gainVal, setGainVal] = useState(() => getAudioPrefs().defaultGain)
  // Recorded takes waiting to be saved as one multi-clip profile. Guests
  // still save a single clip immediately on stop (their local IndexedDB
  // path doesn't support multi-clip yet); registered users record 1-4
  // takes, review them, then save all of them together.
  const [takes, setTakes] = useState<{ blob: Blob; secs: number; url: string }[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('Hello, this is a preview of my voice profile.')
  const [previewing, setPreviewing] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [consented, setConsented] = useState(false)
  useEscapeKey(() => setDeleteConfirmId(null), deleteConfirmId !== null)

  async function handleStart() {
    setMsg(''); setMsgWarn('')
    if (!consented) {
      setMsg('Error: Please confirm you have the right to clone this voice before recording.')
      return
    }
    if (takes.length >= MAX_CLIPS) {
      setMsg(`Error: Maximum ${MAX_CLIPS} takes per profile. Delete one below to record another.`)
      return
    }
    try {
      await recorder.start(noiseSuppression, gainVal)
    } catch (e: unknown) {
      const err = e as Error
      setMsg(`Error: Could not access microphone. ${err.message ?? ''}`)
    }
  }

  async function handleStop() {
    setMsg(''); setMsgWarn('')
    const blob = await recorder.stop()

    if (!blob || blob.size === 0) {
      setMsg('Error: No audio captured. Please try again.')
      return
    }

    const secs = recorder.seconds
    if (secs < 4) {
      setMsgWarn(`⚠ That take is only ${secs}s — aim for at least 4-6s of clear speech per take.`)
    } else if (secs > 35) {
      setMsgWarn(`⚠ That take is ${secs}s — for multi-take profiles, shorter 10-20s takes combine better than one very long one.`)
    }

    // ── Guest path: single clip only, saved immediately (unchanged) ──
    // Guest profiles live in IndexedDB, not the Laravel multi-clip
    // pipeline, so multi-take isn't available until they create an account.
    if (isGuest && onGuestSave) {
      setSaving(true)
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

    // ── Registered user: queue the take, don't save yet ──────────────
    setTakes(prev => [...prev, { blob, secs, url: URL.createObjectURL(blob) }])
  }

  function removeTake(index: number) {
    setTakes(prev => {
      const removed = prev[index]
      if (removed) URL.revokeObjectURL(removed.url)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function handleSaveProfile() {
    setMsg(''); setMsgWarn('')
    if (!consented) {
      setMsg('Error: Please confirm you have the right to clone this voice before saving.')
      return
    }
    if (takes.length === 0) {
      setMsg('Error: Record at least one take before saving.')
      return
    }

    const totalSecs = takes.reduce((sum, t) => sum + t.secs, 0)
    if (totalSecs < 6) {
      setMsgWarn(`⚠ Total reference audio is only ${totalSecs}s across ${takes.length} take${takes.length !== 1 ? 's' : ''} — aim for 10-30s total for accurate cloning.`)
    }

    setSaving(true)
    const fd = new FormData()
    takes.forEach((t, i) => {
      const mime = t.blob.type.includes('wav') ? 'audio/wav' : 'audio/webm'
      const ext  = t.blob.type.includes('wav') ? 'wav' : 'webm'
      // Repeated 'file' entries — matches the ai-engine's list[UploadFile]
      // binding and the Laravel controller's array normalization.
      fd.append('file[]', new Blob([t.blob], { type: mime }), `voice_${i}.${ext}`)
    })
    fd.append('profile_id', profileName.trim() || 'my-voice')
    fd.append('name', profileName.trim() || 'my-voice')
    fd.append('status', 'ready')

    try {
      const raw = await api.post('/voice-profiles', fd)
      const data = raw as VoiceProfileSaveResult
      if (data?.warning) setMsgWarn(`⚠ ${data.warning}`)
      const clipsSaved = data.clips_saved ?? takes.length
      setMsg(`✓ Profile "${data.profile_id ?? profileName}" saved — ${clipsSaved} clip${clipsSaved !== 1 ? 's' : ''}${data.duration_seconds ? `, ${data.duration_seconds}s total` : ''}`)
      takes.forEach(t => URL.revokeObjectURL(t.url))
      setTakes([])
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
  const engineLabel = engine === 'f5' ? 'F5-TTS' : engine === 'chatterbox' ? 'Chatterbox' : 'XTTS v2'

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
              <div className="record-script__label">
                Read this aloud{!isGuest && ` — take ${Math.min(takes.length + 1, MAX_CLIPS)} of ${MAX_CLIPS}`}
              </div>
              <p className="record-script__text">"{RECORD_PROMPTS[takes.length % RECORD_PROMPTS.length]}"</p>
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
            <label className="consent-gate">
              <input
                type="checkbox"
                checked={consented}
                onChange={e => setConsented(e.target.checked)}
                disabled={recorder.recording}
              />
              <span>
                I confirm this is <strong>my own voice</strong>, or I have explicit
                permission from the person whose voice this is. I will not use Voxora to
                impersonate any public figure, celebrity, or other real person without their
                consent.
              </span>
            </label>
            <MicBtn
              recording={recorder.recording}
              onClick={recorder.recording ? handleStop : handleStart}
              disabled={saving || (!consented && !recorder.recording) || (!isGuest && !recorder.recording && takes.length >= MAX_CLIPS)}
              label={
                saving ? 'Saving…'
                : recorder.recording ? 'Stop Recording'
                : (!isGuest && takes.length > 0) ? `Record Take ${takes.length + 1} of ${MAX_CLIPS}`
                : 'Start Recording'
              }
            />

            {/* Multi-take review list — registered users only. Guests save
                a single clip immediately on stop, so there's never a queue
                to show them. */}
            {!isGuest && takes.length > 0 && (
              <div className="takes-list">
                <div className="takes-list__label">
                  {takes.length} take{takes.length !== 1 ? 's' : ''} recorded
                  {takes.length < MAX_CLIPS && ` — record up to ${MAX_CLIPS - takes.length} more for a stronger clone`}
                </div>
                {takes.map((t, i) => (
                  <div key={t.url} className="takes-list__item">
                    <span className="takes-list__index">{i + 1}</span>
                    <audio src={t.url} controls style={{ height: 32, flex: 1 }} />
                    <span className="takes-list__secs">{fmt(t.secs)}</span>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => removeTake(i)}
                      disabled={saving || recorder.recording}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleSaveProfile}
                  disabled={saving || recorder.recording || !consented}
                  style={{ marginTop: 10, width: '100%' }}
                >
                  {saving ? 'Saving…' : `Save Profile (${takes.length} clip${takes.length !== 1 ? 's' : ''})`}
                </button>
              </div>
            )}

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
                <EngineSwitcher engine={engine} setEngine={setEngine} engineCaps={engineCaps ?? { xtts: false, f5: false }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Preview uses your currently selected engine — click it above to switch.
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