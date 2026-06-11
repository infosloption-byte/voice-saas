import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import { toast } from './toast'
import { icons } from './constants'
import type { User } from './types'

// ── Helpers ────────────────────────────────────────────────────────
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(s: string) {
  return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function elapsed(start: string, end?: string) {
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

const PLAN_BADGE: Record<string, string> = {
  pro:     'background:rgba(168,85,247,0.15);color:#a855f7',
  starter: 'background:rgba(59,130,246,0.15);color:#3b82f6',
  free:    'background:var(--bg-2);color:var(--text-3)',
}
const ROLE_BADGE: Record<string, string> = {
  super_admin: 'background:rgba(239,68,68,0.15);color:#ef4444',
  admin:       'background:rgba(245,158,11,0.15);color:#f59e0b',
  user:        'background:var(--bg-2);color:var(--text-3)',
}

function Badge({ text, style }: { text: string; style: string }) {
  const parts = style.split(';').reduce<Record<string,string>>((acc, p) => {
    const [k, v] = p.split(':')
    if (k && v) acc[k.trim()] = v.trim()
    return acc
  }, {})
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px',
      textTransform: 'uppercase', letterSpacing: '0.04em', ...parts,
    }}>{text}</span>
  )
}

// ── Dropdown (popup-style select, matches workspace menus) ─────────
function Dropdown({ value, options, onChange, disabled, minWidth = 130 }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
  minWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value) ?? options[0]
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, minWidth,
          padding: '7px 10px', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border-2)'}`,
          background: 'var(--bg-2)', color: 'var(--text-1)',
          fontSize: 12.5, fontFamily: 'var(--font)', cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1, transition: 'border-color 0.12s',
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current?.label}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
          style={{ width: 11, height: 11, opacity: 0.5, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6, minWidth: '100%',
            background: 'var(--surface)', border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
            zIndex: 200, overflow: 'hidden', padding: '4px 0',
            animation: 'modal-in 0.15s ease',
          }}>
            {options.map(o => {
              const active = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 12px', border: 'none', textAlign: 'left',
                    fontSize: 12.5, fontFamily: 'var(--font)', whiteSpace: 'nowrap',
                    background: active ? 'var(--accent-lt)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-1)',
                    fontWeight: active ? 600 : 400, cursor: 'pointer',
                    borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-2)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 18px', flex: '1 1 160px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color ?? 'var(--text-1)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Mini bar chart ─────────────────────────────────────────────────
function MiniChart({ data, color }: { data: { day: string; count: number }[]; color: string }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {data.map(d => (
        <div key={d.day} title={`${d.day}: ${d.count}`} style={{
          flex: 1, borderRadius: 2,
          background: d.count > 0 ? color : 'var(--bg-2)',
          height: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 4)}%`,
          minHeight: 2,
          transition: 'height 0.3s ease',
        }} />
      ))}
    </div>
  )
}

// ── Section header ─────────────────────────────────────────────────
function SectionHeader({ title, onRefresh, loading }: { title: string; onRefresh: () => void; loading: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{title}</h3>
      <button
        className="btn btn--ghost btn--sm"
        onClick={onRefresh}
        disabled={loading}
        style={{ fontSize: 11, padding: '3px 8px' }}
      >
        {loading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : '↻ Refresh'}
      </button>
    </div>
  )
}

// ── Dashboard overview ─────────────────────────────────────────────
function OverviewSection() {
  const [stats, setStats] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setStats(await api.get('/admin/stats') as Record<string, any>) }
    catch { toast.err('Failed to load stats') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading && !stats) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
  if (!stats) return null

  return (
    <div>
      <SectionHeader title="Platform Overview" onRefresh={load} loading={loading} />

      {/* KPI row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
        <KpiCard label="Total Users" value={stats.users.total} sub={`+${stats.users.today} today`} />
        <KpiCard label="Active Today (DAU)" value={stats.users.dau} color="var(--accent)" />
        <KpiCard label="Starter Subs" value={stats.subscriptions.starter} color="#3b82f6" />
        <KpiCard label="Pro Subs" value={stats.subscriptions.pro} color="#a855f7" />
        <KpiCard label="Synthesis Today" value={stats.activity.synthesis_today} />
        <KpiCard label="Jobs Failed Today" value={stats.activity.jobs_failed_today}
          color={stats.activity.jobs_failed_today > 0 ? 'var(--err)' : undefined} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>User Signups — last 30 days</div>
          <MiniChart data={stats.charts.user_growth} color="var(--accent)" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            <span>{stats.charts.user_growth[0]?.day?.slice(5)}</span>
            <span>{stats.charts.user_growth[stats.charts.user_growth.length - 1]?.day?.slice(5)}</span>
          </div>
        </div>
        <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>Synthesis Jobs — last 7 days</div>
          <MiniChart data={stats.charts.synth_trend} color="#10b981" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            <span>{stats.charts.synth_trend[0]?.day?.slice(5)}</span>
            <span>{stats.charts.synth_trend[stats.charts.synth_trend.length - 1]?.day?.slice(5)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── User management ────────────────────────────────────────────────
function UsersSection({ currentUser }: { currentUser: User }) {
  const [users, setUsers]     = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [roleChanging, setRoleChanging] = useState<number | null>(null)

  const isSuperAdmin = currentUser.role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (search) params.set('search', search)
      if (roleFilter) params.set('role', roleFilter)
      if (planFilter) params.set('plan', planFilter)
      const res = await api.get(`/admin/users?${params}`) as any
      setUsers(res.users)
      setTotal(res.total)
    } catch { toast.err('Failed to load users') }
    finally { setLoading(false) }
  }, [search, roleFilter, planFilter])

  useEffect(() => { load() }, [load])

  async function openDetail(userId: number) {
    setDetailLoading(true)
    try {
      const res = await api.get(`/admin/users/${userId}`) as any
      setSelectedUser(res)
    } catch { toast.err('Failed to load user details') }
    finally { setDetailLoading(false) }
  }

  async function changeRole(userId: number, role: string) {
    setRoleChanging(userId)
    try {
      await api.put(`/admin/users/${userId}/role`, { role })
      toast.ok(`Role updated to ${role}`)
      load()
      if (selectedUser?.user?.id === userId) openDetail(userId)
    } catch (e: any) {
      toast.err(e?.message ?? 'Failed to update role')
    } finally { setRoleChanging(null) }
  }

  async function deleteUser(userId: number, email: string) {
    if (!confirm(`Permanently delete user ${email}? This cannot be undone.`)) return
    try {
      await api.delete(`/admin/users/${userId}`)
      toast.ok(`User ${email} deleted`)
      load()
      if (selectedUser?.user?.id === userId) setSelectedUser(null)
    } catch { toast.err('Failed to delete user') }
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* User list */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <SectionHeader title={`Users (${total})`} onRefresh={load} loading={loading} />

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            className="full-input"
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 160, fontSize: 12.5, padding: '7px 11px', width: 'auto' }}
          />
          <Dropdown value={roleFilter} onChange={setRoleFilter} options={[
            { value: '',            label: 'All roles' },
            { value: 'user',        label: 'User' },
            { value: 'admin',       label: 'Admin' },
            { value: 'super_admin', label: 'Super Admin' },
          ]} />
          <Dropdown value={planFilter} onChange={setPlanFilter} options={[
            { value: '',        label: 'All plans' },
            { value: 'free',    label: 'Free' },
            { value: 'starter', label: 'Starter' },
            { value: 'pro',     label: 'Pro' },
          ]} />
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontWeight: 600 }}>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>User</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Plan</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Projects</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Joined</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}
                  onClick={() => openDetail(u.id)}
                  style={{
                    borderBottom: '1px solid var(--border-1)',
                    cursor: 'pointer',
                    background: selectedUser?.user?.id === u.id ? 'var(--accent-lt)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{u.name}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge text={u.role ?? 'user'} style={ROLE_BADGE[u.role ?? 'user'] ?? ROLE_BADGE.user} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge text={u.plan_name ?? 'free'} style={PLAN_BADGE[u.plan_name ?? 'free'] ?? PLAN_BADGE.free} />
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{u.projects_count}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text-3)' }}>{fmtDate(u.created_at)}</td>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Dropdown
                        value={u.role ?? 'user'}
                        onChange={role => changeRole(u.id, role)}
                        disabled={roleChanging === u.id || u.id === currentUser.id}
                        minWidth={96}
                        options={[
                          { value: 'user',  label: 'User' },
                          { value: 'admin', label: 'Admin' },
                          ...(isSuperAdmin ? [{ value: 'super_admin', label: 'Super Admin' }] : []),
                        ]}
                      />
                      {isSuperAdmin && u.id !== currentUser.id && (
                        <button
                          className="btn btn--sm"
                          onClick={() => deleteUser(u.id, u.email)}
                          style={{ fontSize: 10, padding: '3px 6px', color: 'var(--err)', borderColor: 'rgba(192,57,43,0.3)' }}
                        >Del</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User detail panel */}
      {(selectedUser || detailLoading) && (
        <div style={{
          width: 280, flexShrink: 0, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10, padding: 16,
          overflowY: 'auto', position: 'relative',
        }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelectedUser(null)}
            style={{ position: 'absolute', top: 10, right: 10 }}>{icons.close}</button>
          {detailLoading ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>Loading…</div>
          ) : selectedUser && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selectedUser.user.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>{selectedUser.user.email}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                <Badge text={selectedUser.user.role ?? 'user'} style={ROLE_BADGE[selectedUser.user.role ?? 'user'] ?? ROLE_BADGE.user} />
                <Badge text={selectedUser.user.plan_name ?? 'free'} style={PLAN_BADGE[selectedUser.user.plan_name ?? 'free'] ?? PLAN_BADGE.free} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Projects</div>{selectedUser.user.projects_count}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Profiles</div>{selectedUser.user.voice_profiles_count}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Synthesis</div>{selectedUser.user.synthesis_used}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Translation</div>{selectedUser.user.translation_used}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
                Joined: {fmtDate(selectedUser.user.created_at)}
              </div>
              {selectedUser.recent_activity?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Recent Activity</div>
                  {selectedUser.recent_activity.slice(0, 8).map((a: any) => (
                    <div key={a.id} style={{ fontSize: 10.5, padding: '4px 0', borderBottom: '1px solid var(--border-1)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ color: a.status === 'done' ? 'var(--ok)' : a.status === 'failed' ? 'var(--err)' : 'var(--accent)' }}>●</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{a.message}</span>
                      <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{a.ended_at ? elapsed(a.started_at, a.ended_at) : '—'}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Activity monitor ───────────────────────────────────────────────
function ActivitySection() {
  const [logs, setLogs]       = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [eventFilter, setEventFilter]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter) params.set('status', statusFilter)
      if (eventFilter)  params.set('event_type', eventFilter)
      const res = await api.get(`/admin/activity-logs?${params}`) as any[]
      setLogs(res)
    } catch { toast.err('Failed to load activity logs') }
    finally { setLoading(false) }
  }, [statusFilter, eventFilter])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <SectionHeader title="Activity Monitor" onRefresh={load} loading={loading} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Dropdown value={statusFilter} onChange={setStatusFilter} options={[
          { value: '',        label: 'All statuses' },
          { value: 'running', label: 'Running' },
          { value: 'done',    label: 'Done' },
          { value: 'failed',  label: 'Failed' },
        ]} />
        <Dropdown value={eventFilter} onChange={setEventFilter} options={[
          { value: '',            label: 'All events' },
          { value: 'synthesis',   label: 'Synthesis' },
          { value: 'translation', label: 'Translation' },
          { value: 'voice_clone', label: 'Voice Clone' },
          { value: 'export',      label: 'Export' },
        ]} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontWeight: 600 }}>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Time</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>User</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Event</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Message</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--border-1)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtTime(l.started_at)}</td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ fontWeight: 500 }}>{l.user?.name ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{l.user?.email}</div>
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-2)' }}>{l.event_type ?? '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-1)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.message}</td>
                <td style={{ padding: '7px 10px' }}>
                  {l.status === 'running' && <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}><span className="spinner" style={{ width: 10, height: 10 }} />Running</span>}
                  {l.status === 'done'    && <span style={{ color: 'var(--ok)' }}>✓ Done</span>}
                  {l.status === 'failed'  && <span style={{ color: 'var(--err)' }}>✗ Failed</span>}
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)' }}>
                  {l.ended_at ? elapsed(l.started_at, l.ended_at) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Subscriptions ──────────────────────────────────────────────────
function SubscriptionsSection() {
  const [subs, setSubs]       = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (planFilter)   params.set('plan', planFilter)
      const res = await api.get(`/admin/subscriptions?${params}`) as any
      setSubs(res.subscriptions)
    } catch { toast.err('Failed to load subscriptions') }
    finally { setLoading(false) }
  }, [statusFilter, planFilter])

  useEffect(() => { load() }, [load])

  async function cancelSub(id: number, email: string) {
    if (!confirm(`Cancel subscription for ${email}?`)) return
    try {
      await api.post(`/admin/subscriptions/${id}/cancel`, {})
      toast.ok('Subscription cancelled')
      load()
    } catch { toast.err('Failed to cancel subscription') }
  }

  return (
    <div>
      <SectionHeader title={`Subscriptions (${subs.length})`} onRefresh={load} loading={loading} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Dropdown value={statusFilter} onChange={setStatusFilter} options={[
          { value: '',          label: 'All statuses' },
          { value: 'active',    label: 'Active' },
          { value: 'cancelled', label: 'Cancelled' },
          { value: 'suspended', label: 'Suspended' },
        ]} />
        <Dropdown value={planFilter} onChange={setPlanFilter} options={[
          { value: '',        label: 'All plans' },
          { value: 'starter', label: 'Starter' },
          { value: 'pro',     label: 'Pro' },
        ]} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontWeight: 600 }}>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>User</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Plan</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Period End</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>PayPal ID</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subs.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border-1)' }}>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ fontWeight: 500 }}>{s.user_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{s.user_email}</div>
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <Badge text={s.plan} style={PLAN_BADGE[s.plan] ?? PLAN_BADGE.free} />
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ color: s.status === 'active' ? 'var(--ok)' : s.status === 'suspended' ? 'var(--warn)' : 'var(--text-3)' }}>
                    {s.status}
                  </span>
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)' }}>{s.current_period_end ? fmtDate(s.current_period_end) : '—'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)', fontSize: 10 }}>{s.paypal_subscription_id ?? '—'}</td>
                <td style={{ padding: '7px 10px' }}>
                  {s.status === 'active' && (
                    <button className="btn btn--ghost btn--sm"
                      onClick={() => cancelSub(s.id, s.user_email)}
                      style={{ fontSize: 10, color: 'var(--err)', borderColor: 'rgba(192,57,43,0.3)' }}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Audit log ──────────────────────────────────────────────────────
function AuditLogSection() {
  const [logs, setLogs]       = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin/audit-log') as any
      setLogs(res.logs)
    } catch { toast.err('Failed to load audit log') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <SectionHeader title="Admin Audit Log" onRefresh={load} loading={loading} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontWeight: 600 }}>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Time</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Actor</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Action</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Target</th>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Before → After</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--border-1)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtTime(l.created_at)}</td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ fontWeight: 500 }}>{l.actor_name ?? 'System'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{l.actor_email}</div>
                </td>
                <td style={{ padding: '7px 10px', fontWeight: 600, color: 'var(--accent)' }}>{l.action}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text-2)' }}>
                  {l.target_name && <div>{l.target_name}</div>}
                  {l.target_email && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{l.target_email}</div>}
                </td>
                <td style={{ padding: '7px 10px', color: 'var(--text-3)', fontSize: 11 }}>
                  {l.before_value && l.after_value ? `${l.before_value} → ${l.after_value}` : (l.before_value ?? l.after_value ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── AI Engine routing (moved from user Settings) ───────────────────
interface EngineConfig {
  id: number
  name: string
  url: string
  is_active: boolean
  status: 'unknown' | 'online' | 'offline'
  latency_ms: number | null
  last_tested_at: string | null
}

function EnginesSection() {
  const [engines, setEngines]     = useState<EngineConfig[]>([])
  const [loading, setLoading]     = useState(true)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [activatingId, setActivatingId] = useState<number | null>(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [addName, setAddName]     = useState('')
  const [addUrl, setAddUrl]       = useState('')
  const [adding, setAdding]       = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/admin/engines')
      .then(d => setEngines(d as EngineConfig[]))
      .catch(() => toast.err('Failed to load engine configs'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleTest = async (eng: EngineConfig) => {
    setTestingId(eng.id)
    try {
      const updated = await api.post(`/admin/engines/${eng.id}/test`, {}) as EngineConfig
      setEngines(prev => prev.map(e => e.id === eng.id ? updated : e))
    } catch { toast.err('Test failed') }
    finally { setTestingId(null) }
  }

  const handleActivate = async (eng: EngineConfig) => {
    if (eng.is_active) return
    setActivatingId(eng.id)
    try {
      await api.post(`/admin/engines/${eng.id}/activate`, {})
      toast.ok(`Switched to "${eng.name}"`)
      load()
    } catch { toast.err('Activation failed') }
    finally { setActivatingId(null) }
  }

  const handleDelete = async (eng: EngineConfig) => {
    if (!confirm(`Delete "${eng.name}"?`)) return
    try {
      await api.delete(`/admin/engines/${eng.id}`)
      setEngines(prev => prev.filter(e => e.id !== eng.id))
    } catch { toast.err('Delete failed') }
  }

  const handleAdd = async () => {
    if (!addName.trim() || !addUrl.trim()) return
    setAdding(true)
    try {
      const created = await api.post('/admin/engines', { name: addName.trim(), url: addUrl.trim() }) as EngineConfig
      setEngines(prev => [...prev, created])
      setAddName(''); setAddUrl(''); setShowAdd(false)
    } catch { toast.err('Failed to add engine') }
    finally { setAdding(false) }
  }

  const statusDot = (s: EngineConfig['status']) => ({
    unknown: { color: 'var(--text-3)', label: 'Not tested' },
    online:  { color: 'var(--ok)',     label: 'Online' },
    offline: { color: 'var(--err)',    label: 'Offline' },
  }[s])

  return (
    <div>
      <SectionHeader title="AI Engine Routing" onRefresh={load} loading={loading} />
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 18px', lineHeight: 1.6, maxWidth: 640 }}>
        Switch the active AI engine between your local server and RunPod (or any external host) without redeployment.
        Changes take effect within 30 seconds.
      </p>

      {loading && engines.length === 0 ? (
        <div style={{ padding: 30, color: 'var(--text-3)', fontSize: 13 }}>
          <span className="spinner" style={{ width: 13, height: 13, marginRight: 8 }} />Loading…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20, maxWidth: 720 }}>
          {engines.map(eng => {
            const dot = statusDot(eng.status)
            return (
              <div key={eng.id} style={{
                padding: '14px 16px', borderRadius: 'var(--radius)',
                border: `1px solid ${eng.is_active ? 'var(--accent)' : 'var(--border-2)'}`,
                background: eng.is_active ? 'var(--accent-lt)' : 'var(--surface-2)',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: eng.is_active ? 'var(--accent)' : 'var(--border-2)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{eng.name}</span>
                    {eng.is_active && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'rgba(124,58,237,0.12)', padding: '2px 7px', borderRadius: 10 }}>ACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eng.url}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot.color, display: 'inline-block' }} />
                    <span style={{ color: dot.color }}>{dot.label}</span>
                    {eng.latency_ms !== null && <span style={{ color: 'var(--text-3)' }}>· {eng.latency_ms}ms</span>}
                    {eng.last_tested_at && <span style={{ color: 'var(--text-3)' }}>· tested {new Date(eng.last_tested_at).toLocaleTimeString()}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => handleTest(eng)} disabled={testingId === eng.id}>
                    {testingId === eng.id ? <span className="spinner" /> : null} Test
                  </button>
                  {!eng.is_active && (
                    <button className="btn btn--primary btn--sm" onClick={() => handleActivate(eng)} disabled={!!activatingId}>
                      {activatingId === eng.id ? <span className="spinner" /> : null} Activate
                    </button>
                  )}
                  {!eng.is_active && (
                    <button className="btn btn--ghost btn--sm" style={{ color: 'var(--err)' }} onClick={() => handleDelete(eng)}>
                      {icons.trash}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAdd ? (
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-2)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Add engine</div>
          <input className="full-input" placeholder="Name (e.g. RunPod GPU)" value={addName} onChange={e => setAddName(e.target.value)} />
          <input className="full-input" placeholder="URL (e.g. https://abc123-8000.proxy.runpod.net)" value={addUrl} onChange={e => setAddUrl(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--primary btn--sm" onClick={handleAdd} disabled={adding || !addName.trim() || !addUrl.trim()}>
              {adding ? <span className="spinner" /> : null} Add
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => { setShowAdd(false); setAddName(''); setAddUrl('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn--ghost btn--sm" onClick={() => setShowAdd(true)}>+ Add engine</button>
      )}
    </div>
  )
}

// ── Main AdminPage ─────────────────────────────────────────────────
type AdminSection = 'overview' | 'users' | 'activity' | 'subscriptions' | 'engines' | 'audit'

const SECTIONS: { id: AdminSection; label: string; icon: string }[] = [
  { id: 'overview',       label: 'Overview',       icon: '◈' },
  { id: 'users',          label: 'Users',          icon: '⊞' },
  { id: 'activity',       label: 'Activity',       icon: '◉' },
  { id: 'subscriptions',  label: 'Subscriptions',  icon: '◎' },
  { id: 'engines',        label: 'AI Engines',     icon: '⚡' },
  { id: 'audit',          label: 'Audit Log',      icon: '◷' },
]

export function AdminPage({ user, onBack, standalone }: { user: User; onBack?: () => void; standalone?: boolean }) {
  const [section, setSection] = useState<AdminSection>('overview')

  if (!user.is_admin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🚫</div>
        <div style={{ fontWeight: 700 }}>Access denied</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>You don't have admin access.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - var(--topbar-h))' }}>
      {/* Sidebar */}
      <div style={{
        width: 180, flexShrink: 0, background: 'var(--bg-2)',
        borderRight: '1px solid var(--border)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ padding: '4px 10px 14px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Admin Panel</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {user.role === 'super_admin' ? '⭐ Super Admin' : '🛡 Admin'}
          </div>
        </div>

        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 6, border: 'none',
              cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: 13,
              background: section === s.id ? 'var(--accent-lt)' : 'transparent',
              color: section === s.id ? 'var(--accent)' : 'var(--text-2)',
              fontWeight: section === s.id ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{s.icon}</span>
            {s.label}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {!standalone && onBack && (
          <button className="btn btn--ghost btn--sm"
            onClick={onBack}
            style={{ fontSize: 11, justifyContent: 'flex-start', gap: 6 }}>
            {icons.back} Back to app
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {section === 'overview'      && <OverviewSection />}
        {section === 'users'         && <UsersSection currentUser={user} />}
        {section === 'activity'      && <ActivitySection />}
        {section === 'subscriptions' && <SubscriptionsSection />}
        {section === 'engines'       && <EnginesSection />}
        {section === 'audit'         && <AuditLogSection />}
      </div>
    </div>
  )
}
