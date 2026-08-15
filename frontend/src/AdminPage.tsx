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

// ── Titled bar chart card (used by Reports) ────────────────────────
function ChartCard({ title, data, color, format }: {
  title: string
  data: { label: string; value: number }[]
  color: string
  format?: (v: number) => string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  const fmt = format ?? ((v: number) => v.toLocaleString())
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 18px', flex: '1 1 340px', minWidth: 280,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>{fmt(total)} total</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 72 }}>
        {data.map((d, i) => (
          <div key={i} title={`${d.label}: ${fmt(d.value)}`} style={{
            flex: 1, borderRadius: 2,
            background: d.value > 0 ? color : 'var(--bg-2)',
            height: `${Math.max((d.value / max) * 100, d.value > 0 ? 6 : 3)}%`,
            minHeight: 2, transition: 'height 0.3s ease',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text-3)' }}>
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
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

  const groupLabel = (text: string) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '18px 0 8px' }}>{text}</div>
  )
  const split = stats.activity.engine_split ?? {}
  const splitTotal = (Object.values(split) as number[]).reduce((a, b) => a + b, 0)
  const eng = stats.system?.active_engine

  return (
    <div>
      <SectionHeader title="Platform Overview" onRefresh={load} loading={loading} />

      {groupLabel('Users & Engagement')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <KpiCard label="Total Users" value={stats.users.total} sub={`+${stats.users.today} today · +${stats.users.week} this week`} />
        <KpiCard label="DAU / WAU / MAU" value={`${stats.users.dau} / ${stats.users.wau} / ${stats.users.mau}`} color="var(--accent)" />
        <KpiCard label="Stickiness" value={`${stats.users.stickiness}%`} sub="DAU ÷ MAU" />
        <KpiCard label="Verified Emails" value={stats.users.verified}
          sub={stats.users.unverified > 0 ? `${stats.users.unverified} unverified` : 'all verified'} />
        {stats.users.retention != null && (
          <KpiCard label="Retention" value={`${stats.users.retention}%`} sub="signed up 1-5 weeks ago, active this week" />
        )}
      </div>

      {groupLabel('Revenue')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <KpiCard label="MRR" value={`$${stats.revenue.mrr}`} color="#10b981" sub={`${stats.revenue.paid_users} paid users`} />
        <KpiCard label="Conversion" value={`${stats.revenue.conversion_rate}%`} sub="free → paid" />
        <KpiCard label="Starter Subs" value={stats.subscriptions.starter} color="#3b82f6" />
        <KpiCard label="Creator Subs" value={stats.subscriptions.creator} color="#f59e0b" />
        <KpiCard label="Pro Subs" value={stats.subscriptions.pro} color="#a855f7" />
        <KpiCard label="New Subs (month)" value={stats.revenue.new_subs_month} />
        <KpiCard label="Churn (month)" value={stats.revenue.churn_month}
          color={stats.revenue.churn_month > 0 ? 'var(--err)' : undefined} />
      </div>

      {groupLabel('Activity (24h)')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <KpiCard label="Synthesis Today" value={stats.activity.synthesis_today} sub={`${stats.activity.translation_today} translations`} />
        <KpiCard label="Words Synthesized" value={stats.activity.words_today.toLocaleString()} sub={`${stats.activity.words_week.toLocaleString()} this week`} />
        <KpiCard label="Failure Rate" value={`${stats.activity.failure_rate}%`}
          sub={`${stats.activity.jobs_failed_today} of ${stats.activity.jobs_today} jobs`}
          color={stats.activity.failure_rate > 5 ? 'var(--err)' : undefined} />
        <KpiCard label="Job Duration" value={`${stats.activity.avg_duration_s}s avg`} sub={`p95: ${stats.activity.p95_duration_s}s`} />
        {splitTotal > 0 && (
          <KpiCard label="Engine Split (7d)"
            value={Object.entries(split).map(([m, c]) => `${m} ${Math.round((c as number) / splitTotal * 100)}%`).join(' · ')}
            sub={`${splitTotal} jobs`} />
        )}
        <KpiCard label="Voice Clones (7d)" value={stats.activity.clones_week} />
        {Object.keys(stats.activity.lang_pairs ?? {}).length > 0 && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 18px', flex: '1 1 200px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>Top Language Pairs (30d)</div>
            {Object.entries(stats.activity.lang_pairs).slice(0, 3).map(([pair, count]) => (
              <div key={pair} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{pair}</span>
                <span style={{ color: 'var(--text-3)' }}>{count as number}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {groupLabel('System Health')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        <KpiCard label="Queue Pending" value={stats.system.queue_pending}
          color={stats.system.queue_pending > 10 ? 'var(--warn)' : undefined} />
        <KpiCard label="Queue Failed" value={stats.system.queue_failed}
          color={stats.system.queue_failed > 0 ? 'var(--err)' : undefined} />
        {stats.system.disk_used_pct != null && (
          <KpiCard label="Disk Used" value={`${stats.system.disk_used_pct}%`}
            color={stats.system.disk_used_pct > 85 ? 'var(--err)' : stats.system.disk_used_pct > 70 ? 'var(--warn)' : undefined} />
        )}
        {stats.system.db_size_mb != null && (
          <KpiCard label="Database Size" value={stats.system.db_size_mb >= 1024
            ? `${(stats.system.db_size_mb / 1024).toFixed(1)} GB` : `${stats.system.db_size_mb} MB`} />
        )}
        <KpiCard label="Last Backup"
          value={stats.system.last_backup ? fmtTime(stats.system.last_backup) : 'None found'}
          color={!stats.system.last_backup || (Date.now() - new Date(stats.system.last_backup).getTime()) > 25 * 3600_000 ? 'var(--err)' : 'var(--ok)'} />
        {eng && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '14px 18px', flex: '2 1 240px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 500 }}>Active AI Engine</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: eng.status === 'online' ? 'var(--ok)' : eng.status === 'offline' ? 'var(--err)' : 'var(--text-3)' }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{eng.name}</span>
              {eng.latency_ms != null && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{eng.latency_ms}ms</span>}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: 'var(--mono)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eng.url}</div>
          </div>
        )}
      </div>

      {/* Charts row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 20 }}>
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
        <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>Failed Jobs — last 14 days</div>
          <MiniChart data={stats.charts.fail_trend} color="var(--err)" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            <span>{stats.charts.fail_trend[0]?.day?.slice(5)}</span>
            <span>{stats.charts.fail_trend[stats.charts.fail_trend.length - 1]?.day?.slice(5)}</span>
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

  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  async function openDetail(userId: number) {
    setDetailLoading(true)
    setNoteDraft(null)
    try {
      const res = await api.get(`/admin/users/${userId}`) as any
      setSelectedUser(res)
    } catch { toast.err('Failed to load user details') }
    finally { setDetailLoading(false) }
  }

  async function sendReset(u: any) {
    if (!confirm(`Email a password reset link to ${u.email}?`)) return
    setActionBusy(`reset-${u.id}`)
    try {
      await api.post(`/admin/users/${u.id}/send-reset`, {})
      toast.ok(`Reset link sent to ${u.email}`)
    } catch (e: any) { toast.err(e?.message ?? 'Failed to send reset link') }
    finally { setActionBusy(null) }
  }

  async function resendVerification(u: any) {
    setActionBusy(`verify-${u.id}`)
    try {
      await api.post(`/admin/users/${u.id}/resend-verification`, {})
      toast.ok(`Verification email sent to ${u.email}`)
    } catch (e: any) { toast.err(e?.message ?? 'Failed to send verification email') }
    finally { setActionBusy(null) }
  }

  async function saveNote(userId: number) {
    setActionBusy(`note-${userId}`)
    try {
      await api.put(`/admin/users/${userId}/note`, { note: noteDraft })
      toast.ok('Note saved')
      setNoteDraft(null)
      openDetail(userId)
    } catch (e: any) { toast.err(e?.message ?? 'Failed to save note') }
    finally { setActionBusy(null) }
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

  const [actionBusy, setActionBusy] = useState<string | null>(null)

  async function deleteUser(userId: number, email: string) {
    if (!confirm(`Permanently delete user ${email}? This cannot be undone.`)) return
    setActionBusy(`del-${userId}`)
    try {
      await api.delete(`/admin/users/${userId}`)
      toast.ok(`User ${email} deleted`)
      load()
      if (selectedUser?.user?.id === userId) setSelectedUser(null)
    } catch { toast.err('Failed to delete user') }
    finally { setActionBusy(null) }
  }

  async function toggleSuspend(u: any) {
    const isSuspended = !!u.suspended_at
    if (!isSuspended && !confirm(`Suspend ${u.email}? They will be immediately blocked.`)) return
    setActionBusy(`sus-${u.id}`)
    try {
      const endpoint = isSuspended ? `/admin/users/${u.id}/unsuspend` : `/admin/users/${u.id}/suspend`
      await api.post(endpoint, {})
      toast.ok(isSuspended ? `${u.email} unsuspended` : `${u.email} suspended`)
      load()
      if (selectedUser?.user?.id === u.id) openDetail(u.id)
    } catch (e: any) { toast.err(e?.message ?? 'Action failed') }
    finally { setActionBusy(null) }
  }

  async function impersonate(u: any) {
    if (!confirm(`Impersonate ${u.email}? You will be signed in as this user. Go to the main app to browse as them.`)) return
    setActionBusy(`imp-${u.id}`)
    try {
      await api.post(`/admin/users/${u.id}/impersonate`, {})
      toast.ok(`Now impersonating ${u.email} — open usevoxora.online to browse as them`)
    } catch (e: any) { toast.err(e?.message ?? 'Impersonation failed') }
    finally { setActionBusy(null) }
  }

  async function setPlanOverride(userId: number, plan_override: string | null) {
    setActionBusy(`plan-${userId}`)
    try {
      await api.put(`/admin/users/${userId}/plan`, { plan_override })
      toast.ok(plan_override ? `Plan override set to ${plan_override}` : 'Plan override cleared')
      load()
      if (selectedUser?.user?.id === userId) openDetail(userId)
    } catch (e: any) { toast.err(e?.message ?? 'Failed') }
    finally { setActionBusy(null) }
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
              {users.map(u => {
                const isSelf = u.id === currentUser.id
                const suspended = !!u.suspended_at
                return (
                  <tr key={u.id}
                    onClick={() => openDetail(u.id)}
                    style={{
                      borderBottom: '1px solid var(--border-1)',
                      cursor: 'pointer',
                      opacity: suspended ? 0.6 : 1,
                      background: selectedUser?.user?.id === u.id ? 'var(--accent-lt)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{u.name}</span>
                        {suspended && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--err)', background: 'rgba(192,57,43,0.1)', padding: '1px 5px', borderRadius: 4 }}>SUSPENDED</span>}
                        {u.plan_override && <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 5px', borderRadius: 4 }}>OVERRIDE</span>}
                      </div>
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
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Dropdown
                          value={u.role ?? 'user'}
                          onChange={role => changeRole(u.id, role)}
                          disabled={roleChanging === u.id || isSelf}
                          minWidth={96}
                          options={[
                            { value: 'user',  label: 'User' },
                            { value: 'admin', label: 'Admin' },
                            ...(isSuperAdmin ? [{ value: 'super_admin', label: 'Super Admin' }] : []),
                          ]}
                        />
                        {!isSelf && (
                          <button className="btn btn--ghost btn--sm"
                            disabled={!!actionBusy}
                            onClick={() => toggleSuspend(u)}
                            style={{ fontSize: 10, color: suspended ? 'var(--ok)' : 'var(--warn)' }}>
                            {actionBusy === `sus-${u.id}` ? <span className="spinner" style={{ width: 10, height: 10 }} /> : suspended ? 'Unsuspend' : 'Suspend'}
                          </button>
                        )}
                        {!isSelf && !u.is_admin && (
                          <button className="btn btn--ghost btn--sm"
                            disabled={!!actionBusy}
                            onClick={() => impersonate(u)}
                            style={{ fontSize: 10 }}>
                            {actionBusy === `imp-${u.id}` ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Impersonate'}
                          </button>
                        )}
                        {isSuperAdmin && !isSelf && (
                          <button className="btn btn--sm"
                            disabled={!!actionBusy}
                            onClick={() => deleteUser(u.id, u.email)}
                            style={{ fontSize: 10, padding: '3px 6px', color: 'var(--err)', borderColor: 'rgba(192,57,43,0.3)' }}>
                            {actionBusy === `del-${u.id}` ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Del'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* User detail panel */}
      {(selectedUser || detailLoading) && (
        <div style={{
          width: 300, flexShrink: 0, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10, padding: 16,
          overflowY: 'auto', position: 'relative',
        }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelectedUser(null)}
            style={{ position: 'absolute', top: 10, right: 10 }}>{icons.close}</button>
          {detailLoading ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>Loading…</div>
          ) : selectedUser && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{selectedUser.user.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>{selectedUser.user.email}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge text={selectedUser.user.role ?? 'user'} style={ROLE_BADGE[selectedUser.user.role ?? 'user'] ?? ROLE_BADGE.user} />
                <Badge text={selectedUser.user.plan_name ?? 'free'} style={PLAN_BADGE[selectedUser.user.plan_name ?? 'free'] ?? PLAN_BADGE.free} />
                {selectedUser.user.suspended_at && <Badge text="SUSPENDED" style="background:rgba(192,57,43,0.12);color:var(--err)" />}
                {selectedUser.user.plan_override && <Badge text={`OVERRIDE:${selectedUser.user.plan_override}`} style="background:rgba(245,158,11,0.12);color:#f59e0b" />}
              </div>

              {/* Plan override control */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Plan Override</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Dropdown
                    value={selectedUser.user.plan_override ?? ''}
                    onChange={v => setPlanOverride(selectedUser.user.id, v || null)}
                    disabled={actionBusy?.startsWith('plan')}
                    minWidth={110}
                    options={[
                      { value: '',        label: 'None (PayPal)' },
                      { value: 'starter', label: 'Force Starter' },
                      { value: 'pro',     label: 'Force Pro' },
                    ]}
                  />
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Projects</div>{selectedUser.user.projects_count}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Profiles</div>{selectedUser.user.voice_profiles_count}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Synthesis</div>{selectedUser.user.synthesis_used}</div>
                <div><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Translation</div>{selectedUser.user.translation_used}</div>
                <div style={{ gridColumn: '1/-1' }}><div style={{ fontWeight: 600, color: 'var(--text-2)' }}>Joined</div>{fmtDate(selectedUser.user.created_at)}</div>
              </div>

              {/* Quick actions */}
              {selectedUser.user.id !== currentUser.id && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  <button className="btn btn--ghost btn--sm" disabled={!!actionBusy}
                    style={{ fontSize: 11, color: selectedUser.user.suspended_at ? 'var(--ok)' : 'var(--warn)' }}
                    onClick={() => toggleSuspend(selectedUser.user)}>
                    {selectedUser.user.suspended_at ? 'Unsuspend' : 'Suspend'}
                  </button>
                  {!selectedUser.user.is_admin && (
                    <button className="btn btn--ghost btn--sm" disabled={!!actionBusy}
                      style={{ fontSize: 11 }} onClick={() => impersonate(selectedUser.user)}>
                      Impersonate
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" disabled={!!actionBusy}
                    style={{ fontSize: 11 }} onClick={() => sendReset(selectedUser.user)}>
                    Send password reset
                  </button>
                  {!selectedUser.user.email_verified_at && (
                    <button className="btn btn--ghost btn--sm" disabled={!!actionBusy}
                      style={{ fontSize: 11 }} onClick={() => resendVerification(selectedUser.user)}>
                      Resend verification
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button className="btn btn--sm" disabled={!!actionBusy}
                      style={{ fontSize: 11, color: 'var(--err)', borderColor: 'rgba(192,57,43,0.3)' }}
                      onClick={() => deleteUser(selectedUser.user.id, selectedUser.user.email)}>
                      Delete user
                    </button>
                  )}
                </div>
              )}

              {/* Admin note */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Admin Note</div>
                <textarea className="full-input" rows={3} maxLength={5000}
                  value={noteDraft ?? selectedUser.user.admin_note ?? ''}
                  onChange={e => setNoteDraft(e.target.value)}
                  placeholder="Internal note about this user — visible to admins only"
                  style={{ resize: 'vertical', fontSize: 11.5, lineHeight: 1.5 }} />
                {noteDraft !== null && noteDraft !== (selectedUser.user.admin_note ?? '') && (
                  <button className="btn btn--primary btn--sm" disabled={!!actionBusy}
                    style={{ fontSize: 11, marginTop: 6 }}
                    onClick={() => saveNote(selectedUser.user.id)}>
                    Save note
                  </button>
                )}
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
  const [actionFilter, setActionFilter] = useState('')
  const [actorFilter, setActorFilter]   = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (actionFilter) params.set('action', actionFilter)
      if (actorFilter)  params.set('actor', actorFilter)
      if (fromDate)     params.set('from', fromDate)
      if (toDate)       params.set('to', toDate)
      const res = await api.get(`/admin/audit-log?${params}`) as any
      setLogs(res.logs)
    } catch { toast.err('Failed to load audit log') }
    finally { setLoading(false) }
  }, [actionFilter, actorFilter, fromDate, toDate])

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  return (
    <div>
      <SectionHeader title="Admin Audit Log" onRefresh={load} loading={loading} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="full-input" placeholder="Filter by action…" value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          style={{ flex: 1, minWidth: 140, fontSize: 12, padding: '6px 10px', width: 'auto' }} />
        <input className="full-input" placeholder="Filter by actor…" value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          style={{ flex: 1, minWidth: 140, fontSize: 12, padding: '6px 10px', width: 'auto' }} />
        <input className="full-input" type="date" value={fromDate} title="From date"
          onChange={e => setFromDate(e.target.value)}
          style={{ fontSize: 12, padding: '6px 10px', width: 'auto' }} />
        <input className="full-input" type="date" value={toDate} title="To date"
          onChange={e => setToDate(e.target.value)}
          style={{ fontSize: 12, padding: '6px 10px', width: 'auto' }} />
      </div>
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

// ── Reports ────────────────────────────────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL as string).replace(/\/$/, '')
const csvUrl = (path: string) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}format=csv`

function CsvButton({ path }: { path: string }) {
  return (
    <button className="btn btn--ghost btn--sm" style={{ fontSize: 11 }}
      onClick={() => window.open(csvUrl(path), '_blank')}>
      ⬇ Export CSV
    </button>
  )
}

function ReportTable({ columns, rows = [] }: { columns: { key: string; label: string; render?: (v: any, row: any) => React.ReactNode }[]; rows?: any[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontWeight: 600 }}>
            {columns.map(c => <th key={c.key} style={{ padding: '6px 10px', textAlign: 'left' }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: '18px 10px', color: 'var(--text-3)' }}>No data.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-1)' }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '7px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  {c.render ? c.render(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ReportTab = 'trends' | 'top-users' | 'quota' | 'revenue' | 'funnel' | 'engines' | 'failures' | 'abuse' | 'moderation'

function ReportsSection() {
  const [tab, setTab]         = useState<ReportTab>('top-users')
  const [data, setData]       = useState<any>(null)
  const [dataTab, setDataTab] = useState<ReportTab | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange]     = useState('30')

  const ENDPOINTS: Record<ReportTab, string> = {
    trends:      `/admin/reports/trends?days=${range}`,
    'top-users': `/admin/reports/top-users?days=${range}`,
    quota:       '/admin/reports/quota-pressure?threshold=80',
    revenue:     `/admin/reports/revenue?months=${range === '7' ? 6 : range === '30' ? 12 : 24}`,
    funnel:      '/admin/reports/funnel',
    engines:     `/admin/reports/engines?days=${Math.min(Number(range), 90)}`,
    failures:    `/admin/reports/failures?days=${Math.min(Number(range), 90)}`,
    abuse:       '/admin/reports/abuse',
    moderation:  '/admin/reports/moderation',
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await api.get(ENDPOINTS[tab])
      setData(payload)
      setDataTab(tab)
    }
    catch { toast.err('Failed to load report') }
    finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range])

  useEffect(() => { setData(null); setDataTab(null); load() }, [load])

  const TABS: { id: ReportTab; label: string; csv?: string }[] = [
    { id: 'trends',    label: 'Trends',             csv: ENDPOINTS.trends },
    { id: 'top-users', label: 'Top Users',          csv: ENDPOINTS['top-users'] },
    { id: 'quota',     label: 'Quota Pressure',     csv: ENDPOINTS.quota },
    { id: 'revenue',   label: 'Revenue',            csv: ENDPOINTS.revenue },
    { id: 'funnel',    label: 'Funnel' },
    { id: 'engines',   label: 'Engine Performance', csv: ENDPOINTS.engines },
    { id: 'failures',  label: 'Failures',           csv: ENDPOINTS.failures },
    { id: 'abuse',     label: 'Abuse Flags',        csv: ENDPOINTS.abuse },
    { id: 'moderation',label: 'Moderation',         csv: ENDPOINTS.moderation },
  ]
  const active = TABS.find(t => t.id === tab)!

  return (
    <div>
      <SectionHeader title="Reports" onRefresh={load} loading={loading} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${tab === t.id ? 'var(--accent)' : 'var(--border-2)'}`,
              background: tab === t.id ? 'var(--accent-lt)' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text-2)',
              fontWeight: tab === t.id ? 600 : 400,
            }}>
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {(tab === 'trends' || tab === 'top-users' || tab === 'revenue' || tab === 'engines' || tab === 'failures') && (
          <Dropdown value={range} onChange={setRange} minWidth={110} options={[
            { value: '7',  label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]} />
        )}
        {active.csv && <CsvButton path={active.csv} />}
        <button className="btn btn--ghost btn--sm" style={{ fontSize: 11 }}
          onClick={() => window.open(csvUrl('/admin/reports/export/users'), '_blank')}>
          ⬇ All users CSV
        </button>
      </div>

      {loading && !data ? (
        <div style={{ padding: 30, color: 'var(--text-3)' }}>Loading…</div>
      ) : (!data || dataTab !== tab) ? null : (
        <>
          {tab === 'trends' && (() => {
            const rows: any[] = data.rows ?? []
            const series = (key: string) => rows.map(r => ({ label: (r.day ?? '').slice(5), value: (r[key] as number) ?? 0 }))
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <ChartCard title={`Signups / day (${range}d)`} data={series('signups')}    color="var(--accent)" />
                <ChartCard title="Active users / day"        data={series('active_users')} color="#10b981" />
                <ChartCard title="Jobs / day"                data={series('jobs')}         color="#6366f1" />
                <ChartCard title="Failed jobs / day"         data={series('failed')}       color="var(--err, #ef4444)" />
                <ChartCard title="Words synthesized / day"   data={series('words')}        color="#f59e0b" />
                <ChartCard title="Translations / day"        data={series('translations')} color="#06b6d4" />
              </div>
            )
          })()}

          {tab === 'top-users' && (
            <ReportTable rows={data.rows} columns={[
              { key: 'name',   label: 'User', render: (_, r) => (<><div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name}</div><div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.email}</div></>) },
              { key: 'plan',   label: 'Plan', render: v => <Badge text={v} style={PLAN_BADGE[v] ?? PLAN_BADGE.free} /> },
              { key: 'jobs',   label: 'Synthesis Jobs (30d)' },
              { key: 'words',  label: 'Words', render: v => ((v as number) ?? 0).toLocaleString() },
              { key: 'failed', label: 'Failed', render: v => <span style={{ color: v > 0 ? 'var(--err)' : 'var(--text-3)' }}>{v}</span> },
            ]} />
          )}

          {tab === 'quota' && (
            <ReportTable rows={data.rows} columns={[
              { key: 'name',    label: 'User', render: (_, r) => (<><div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name}</div><div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.email}</div></>) },
              { key: 'plan',    label: 'Plan', render: v => <Badge text={v} style={PLAN_BADGE[v] ?? PLAN_BADGE.free} /> },
              { key: 'used',    label: 'Used', render: (v, r) => `${v} / ${r.limit} (${r.period})` },
              { key: 'percent', label: 'Quota Used', render: v => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(v, 100)}%`, height: '100%', borderRadius: 3,
                      background: v >= 100 ? 'var(--err)' : v >= 90 ? 'var(--warn)' : 'var(--accent)' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: v >= 100 ? 'var(--err)' : 'var(--text-1)' }}>{v}%</span>
                </div>
              ) },
            ]} />
          )}

          {tab === 'revenue' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                <ChartCard title="MRR by month (est.)"
                  data={(data.rows ?? []).map((r: any) => ({ label: r.month.slice(2), value: r.mrr }))}
                  color="#10b981" format={v => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                <ChartCard title="New subscriptions by month"
                  data={(data.rows ?? []).map((r: any) => ({ label: r.month.slice(2), value: r.new_starter + r.new_pro }))}
                  color="var(--accent)" />
              </div>
              <ReportTable rows={data.rows} columns={[
              { key: 'month',       label: 'Month' },
              { key: 'new_starter', label: 'New Starter' },
              { key: 'new_pro',     label: 'New Pro' },
              { key: 'cancelled',   label: 'Cancelled', render: v => <span style={{ color: v > 0 ? 'var(--err)' : 'var(--text-3)' }}>{v}</span> },
              { key: 'mrr',         label: 'MRR (est.)', render: v => <span style={{ fontWeight: 600, color: '#10b981' }}>${v}</span> },
              ]} />
            </>
          )}

          {tab === 'funnel' && (
            <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(data.steps ?? []).map((s: any) => (
                <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 120, fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>{s.step}</span>
                  <div style={{ flex: 1, height: 22, borderRadius: 5, background: 'var(--bg-2)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${s.percent}%`, height: '100%', minWidth: s.count > 0 ? 4 : 0,
                      background: 'var(--accent)', opacity: 0.85, borderRadius: 5,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <span style={{ width: 90, fontSize: 12, color: 'var(--text-1)', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
                    {s.count} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({s.percent}%)</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'engines' && (() => {
            const byDay: Record<string, { jobs: number; failed: number }> = {}
            for (const r of (data.rows ?? []) as any[]) {
              byDay[r.day] ??= { jobs: 0, failed: 0 }
              byDay[r.day].jobs += r.jobs
              byDay[r.day].failed += r.failed
            }
            const days = Object.keys(byDay).sort()
            return (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <ChartCard title="Synthesis jobs / day (14d)"
                    data={days.map(d => ({ label: d.slice(5), value: byDay[d].jobs }))} color="#6366f1" />
                  <ChartCard title="Failed jobs / day (14d)"
                    data={days.map(d => ({ label: d.slice(5), value: byDay[d].failed }))} color="var(--err, #ef4444)" />
                </div>
                <ReportTable rows={data.rows} columns={[
              { key: 'day',          label: 'Day' },
              { key: 'model',        label: 'Model', render: v => <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-1)' }}>{v}</span> },
              { key: 'jobs',         label: 'Jobs' },
              { key: 'failure_rate', label: 'Failure %', render: v => <span style={{ color: v > 5 ? 'var(--err)' : 'var(--text-2)' }}>{v}%</span> },
              { key: 'avg_secs',     label: 'Avg Duration', render: v => `${v}s` },
                ]} />
              </>
            )
          })()}

          {tab === 'failures' && (
            <ReportTable rows={data.rows} columns={[
              { key: 'started_at', label: 'Time', render: v => `${fmtDate(v)} ${fmtTime(v)}` },
              { key: 'name',       label: 'User', render: (_, r) => (<><div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name ?? '(deleted)'}</div><div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.email ?? '—'}</div></>) },
              { key: 'event_type', label: 'Type' },
              { key: 'message',    label: 'Message', render: v => <span style={{ whiteSpace: 'normal' }}>{v}</span> },
              { key: 'detail',     label: 'Detail', render: v => <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', whiteSpace: 'normal', wordBreak: 'break-all' }}>{v ?? '—'}</span> },
            ]} />
          )}

          {tab === 'abuse' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 0, marginBottom: 12 }}>
                Flags: ≥100 jobs in 24h · ≥50% failure rate (with ≥20 jobs) · ≥100k words in 7 days.
              </p>
              <ReportTable rows={data.rows} columns={[
                { key: 'name',     label: 'User', render: (_, r) => (<><div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name}</div><div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.email}</div></>) },
                { key: 'plan',     label: 'Plan', render: v => <Badge text={v} style={PLAN_BADGE[v] ?? PLAN_BADGE.free} /> },
                { key: 'reasons',  label: 'Flags', render: v => <span style={{ color: 'var(--warn)', fontWeight: 600, whiteSpace: 'normal' }}>{v}</span> },
                { key: 'jobs_24h', label: 'Jobs 24h' },
                { key: 'fail_pct', label: 'Fail %', render: v => `${v}%` },
                { key: 'words_7d', label: 'Words 7d', render: v => ((v as number) ?? 0).toLocaleString() },
                { key: 'suspended', label: 'Status', render: v => v
                  ? <Badge text="SUSPENDED" style="background:rgba(192,57,43,0.12);color:var(--err)" />
                  : <span style={{ color: 'var(--text-3)' }}>active</span> },
              ]} />
            </>
          )}

          {tab === 'moderation' && (
            (data.keywords ?? []).length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                No flagged keywords configured. Add comma-separated keywords under
                Settings → Moderation to enable this report.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 0, marginBottom: 12 }}>
                  Scanning for: {(data.keywords as string[]).join(', ')}
                </p>
                <ReportTable rows={data.rows} columns={[
                  { key: 'updated_at', label: 'Updated', render: v => fmtDate(v) },
                  { key: 'name',     label: 'User', render: (_, r) => (<><div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{r.name}</div><div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.email}</div></>) },
                  { key: 'title',    label: 'Script' },
                  { key: 'keywords', label: 'Matched', render: v => <span style={{ color: 'var(--err)', fontWeight: 600 }}>{v}</span> },
                  { key: 'excerpt',  label: 'Excerpt', render: v => <span style={{ whiteSpace: 'normal', fontSize: 11, color: 'var(--text-3)' }}>{v}</span> },
                ]} />
              </>
            )
          )}
        </>
      )}
    </div>
  )
}

// ── Plan limits editor ─────────────────────────────────────────────
function PlansSection() {
  const [plans, setPlans]     = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState<string | null>(null)
  const [edits, setEdits]     = useState<Record<string, Record<string, any>>>({})

  const FIELDS: { key: string; label: string; type: 'number' | 'bool' }[] = [
    { key: 'project_limit', label: 'Projects (0 = ∞)',       type: 'number' },
    { key: 'profile_limit', label: 'Voice profiles (0 = ∞)', type: 'number' },
    { key: 'word_limit',    label: 'Words / script (0 = ∞)', type: 'number' },
    { key: 'synth_limit',   label: 'Synth quota (0 = ∞)',    type: 'number' },
    { key: 'multi_voice',   label: 'Multi-voice',            type: 'bool' },
    { key: 'data_export',   label: 'Data export',            type: 'bool' },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await api.get('/plan-limits') as any
      const arr: any[] = Array.isArray(raw) ? raw : Object.values(raw)
      setPlans(Object.fromEntries(arr.map((p: any) => [p.plan, p])))
      setEdits({})
    }
    catch { toast.err('Failed to load plan limits') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function setField(plan: string, key: string, value: any) {
    setEdits(prev => ({ ...prev, [plan]: { ...prev[plan], [key]: value } }))
  }

  async function save(plan: string) {
    const changes = edits[plan]
    if (!changes || Object.keys(changes).length === 0) return
    setSaving(plan)
    try {
      await api.put(`/admin/plan-limits/${plan}`, changes)
      toast.ok(`'${plan}' limits saved`)
      load()
    } catch { toast.err('Failed to save limits') }
    finally { setSaving(null) }
  }

  if (loading && !plans) return <div style={{ padding: 40, color: 'var(--text-3)' }}>Loading…</div>
  if (!plans) return null

  const planNames = ['free', 'starter', 'pro'].filter(p => plans[p])

  return (
    <div>
      <SectionHeader title="Plan Limits" onRefresh={load} loading={loading} />
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 18px', maxWidth: 640, lineHeight: 1.6 }}>
        Edit the limits enforced for each plan. Changes apply within 30 seconds — no redeploy needed.
        Use 0 for unlimited.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {planNames.map(plan => {
          const merged = { ...plans[plan], ...(edits[plan] ?? {}) }
          const dirty = !!edits[plan] && Object.keys(edits[plan]).length > 0
          return (
            <div key={plan} style={{
              flex: '1 1 240px', maxWidth: 320, background: 'var(--surface)',
              border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10, padding: 18,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Badge text={plan} style={PLAN_BADGE[plan] ?? PLAN_BADGE.free} />
                {dirty && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>unsaved</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {FIELDS.map(f => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)' }}>{f.label}</span>
                    {f.type === 'number' ? (
                      <input
                        className="full-input"
                        type="number"
                        min={0}
                        value={merged[f.key] ?? 0}
                        onChange={e => setField(plan, f.key, Math.max(0, parseInt(e.target.value || '0', 10)))}
                        style={{ width: 84, padding: '5px 8px', fontSize: 12.5, textAlign: 'right' }}
                      />
                    ) : (
                      <button
                        onClick={() => setField(plan, f.key, !merged[f.key])}
                        style={{
                          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                          background: merged[f.key] ? 'var(--accent)' : 'var(--border-2)',
                          position: 'relative', transition: 'background 0.15s', flexShrink: 0,
                        }}>
                        <span style={{
                          position: 'absolute', top: 2, left: merged[f.key] ? 18 : 2,
                          width: 16, height: 16, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.15s',
                        }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="btn btn--primary btn--sm"
                disabled={!dirty || saving === plan}
                onClick={() => save(plan)}
                style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
              >
                {saving === plan ? <span className="spinner" /> : 'Save changes'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Broadcast email ────────────────────────────────────────────────
function BroadcastSection() {
  const [subject, setSubject]   = useState('')
  const [body, setBody]         = useState('')
  const [audience, setAudience] = useState('all')
  const [sending, setSending]   = useState(false)
  const [testing, setTesting]   = useState(false)

  async function send(test: boolean) {
    if (!subject.trim() || !body.trim()) { toast.err('Subject and message are required'); return }
    if (!test && !confirm(`Send this announcement to the "${audience}" audience? This cannot be undone.`)) return
    test ? setTesting(true) : setSending(true)
    try {
      const res = await api.post('/admin/broadcast', {
        subject: subject.trim(), body: body.trim(), audience, test,
      }) as { message: string }
      toast.ok(res.message)
      if (!test) { setSubject(''); setBody('') }
    } catch (e: any) { toast.err(e?.message ?? 'Failed to send broadcast') }
    finally { setSending(false); setTesting(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>Broadcast Announcement</h3>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 18px', maxWidth: 640, lineHeight: 1.6 }}>
        Send an email announcement to your users. Emails are queued and sent in the background.
        Always send yourself a test first.
      </p>

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Audience</label>
          <Dropdown value={audience} onChange={setAudience} minWidth={200} options={[
            { value: 'all',      label: 'All users' },
            { value: 'paid',     label: 'Paid subscribers only' },
            { value: 'free',     label: 'Free users only' },
            { value: 'verified', label: 'Verified emails only' },
          ]} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Subject</label>
          <input className="full-input" value={subject} maxLength={150}
            onChange={e => setSubject(e.target.value)} placeholder="What's new in Voxora…" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Message</label>
          <textarea className="full-input" value={body} maxLength={10000} rows={10}
            onChange={e => setBody(e.target.value)}
            placeholder={'Write your announcement…\n\nPlain text — blank lines become paragraphs.'}
            style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.6 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost btn--sm" disabled={testing || sending} onClick={() => send(true)}>
            {testing ? <span className="spinner" /> : null} Send test to me
          </button>
          <button className="btn btn--primary btn--sm" disabled={sending || testing} onClick={() => send(false)}>
            {sending ? <span className="spinner" /> : null} Send broadcast
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Operational settings (API keys, plan IDs, webhooks) ───────────
type SettingField = {
  key: string; label: string; help: string; secret: boolean
  is_set: boolean; value: string | null; has_fallback: boolean
}

function AppSettingsSection({ currentUser }: { currentUser: User }) {
  const [groups, setGroups]   = useState<Record<string, SettingField[]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [edits, setEdits]     = useState<Record<string, string>>({})
  const isSuper = currentUser.role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/admin/settings') as any
      setGroups(data.groups)
      setEdits({})
    }
    catch { toast.err('Failed to load settings') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    if (Object.keys(edits).length === 0) return
    setSaving(true)
    try {
      await api.put('/admin/settings', { settings: edits })
      toast.ok('Settings saved')
      load()
    }
    catch (e: any) { toast.err(e?.message ?? 'Failed to save settings') }
    finally { setSaving(false) }
  }

  if (loading && !groups) return <div style={{ padding: 30, color: 'var(--text-3)' }}>Loading…</div>
  if (!groups) return null

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHeader title="Settings" onRefresh={load} loading={loading} />
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -6, marginBottom: 18 }}>
        Operational keys stored encrypted in the database — rotate them here without redeploying.
        Bootstrap secrets (database, mail, storage) stay in .env on the server.
        {!isSuper && ' Only super admins can change these values.'}
      </p>

      {Object.entries(groups).map(([group, fields]) => (
        <div key={group} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 18px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>{group}</div>
          {fields.map(f => {
            const edited = f.key in edits
            return (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{f.label}</label>
                  {f.is_set
                    ? <Badge text="set" style="background:rgba(16,185,129,0.12);color:#10b981" />
                    : f.has_fallback
                      ? <Badge text="from .env" style="background:rgba(245,158,11,0.12);color:#f59e0b" />
                      : <Badge text="not set" style="background:var(--bg-2);color:var(--text-3)" />}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="full-input"
                    type={f.secret ? 'password' : 'text'}
                    disabled={!isSuper}
                    value={edited ? edits[f.key] : (f.value ?? '')}
                    placeholder={f.secret && f.is_set ? '•••••••• (enter new value to replace)' : f.label}
                    onChange={e => setEdits(prev => ({ ...prev, [f.key]: e.target.value }))}
                    autoComplete="off"
                  />
                  {isSuper && f.is_set && (
                    <button className="btn btn--ghost btn--sm" style={{ fontSize: 11, flexShrink: 0 }}
                      title="Clear this setting (falls back to .env if configured)"
                      onClick={() => setEdits(prev => ({ ...prev, [f.key]: '' }))}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{f.help}</div>
              </div>
            )
          })}
        </div>
      ))}

      {isSuper && (
        <button className="btn btn--primary btn--sm" disabled={saving || Object.keys(edits).length === 0} onClick={save}>
          {saving ? <span className="spinner" /> : null} Save changes
        </button>
      )}
    </div>
  )
}

// ── System check (live health probes) ─────────────────────────────
type HealthCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; value: string; hint: string | null }

const CHECK_STYLE: Record<string, { dot: string; bg: string; label: string }> = {
  pass: { dot: '#10b981', bg: 'rgba(16,185,129,0.07)',  label: 'PASS' },
  warn: { dot: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  label: 'WARN' },
  fail: { dot: '#ef4444', bg: 'rgba(239,68,68,0.07)',   label: 'FAIL' },
}

function SystemCheckSection() {
  const [data, setData]       = useState<{ checks: HealthCheck[]; summary: any; ran_at: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.get('/admin/system-check') as any) }
    catch { toast.err('Failed to run system checks') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function fire(path: string, key: string) {
    setBusy(key)
    try {
      const res = await api.post(path, {}) as any
      toast.ok(res.message ?? 'Done')
    } catch (e: any) { toast.err(e?.message ?? 'Failed') }
    finally { setBusy(null) }
  }

  const s = data?.summary
  const overall = !s ? null : s.fail > 0 ? 'fail' : s.warn > 0 ? 'warn' : 'pass'

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionHeader title="System Check" onRefresh={load} loading={loading} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {s && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
            borderRadius: 8, background: CHECK_STYLE[overall!].bg,
            border: `1px solid ${CHECK_STYLE[overall!].dot}33`, fontSize: 13, fontWeight: 700,
            color: CHECK_STYLE[overall!].dot,
          }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: CHECK_STYLE[overall!].dot, flexShrink: 0 }} />
            {overall === 'pass' ? 'All systems operational' : overall === 'warn' ? 'Operational with warnings' : 'Problems detected'}
            <span style={{ fontWeight: 400, color: 'var(--text-3)', fontSize: 11 }}>
              {s.pass} passed · {s.warn} warnings · {s.fail} failed
            </span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn--ghost btn--sm" style={{ fontSize: 11 }}
          disabled={busy !== null}
          onClick={() => fire('/admin/system-check/test-email', 'email')}>
          {busy === 'email' ? <span className="spinner" /> : '✉'} Send test email
        </button>
        <button className="btn btn--ghost btn--sm" style={{ fontSize: 11 }}
          disabled={busy !== null}
          onClick={() => fire('/admin/system-check/test-alert', 'alert')}>
          {busy === 'alert' ? <span className="spinner" /> : '🔔'} Send test alert
        </button>
      </div>

      {loading && !data ? (
        <div style={{ padding: 30, color: 'var(--text-3)' }}>Running live checks… (probes real services, can take a few seconds)</div>
      ) : !data ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.checks.map(c => {
            const st = CHECK_STYLE[c.status]
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px',
                borderRadius: 8, background: c.status === 'pass' ? 'var(--surface)' : st.bg,
                border: `1px solid ${c.status === 'pass' ? 'var(--border)' : st.dot + '40'}`,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{c.label}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{c.value}</span>
                  </div>
                  {c.hint && c.status !== 'pass' && (
                    <div style={{ fontSize: 11, color: st.dot, marginTop: 3, lineHeight: 1.5 }}>{c.hint}</div>
                  )}
                </div>
                <span style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', color: st.dot,
                  padding: '2px 7px', borderRadius: 99, background: st.bg,
                  border: `1px solid ${st.dot}40`, flexShrink: 0,
                }}>{st.label}</span>
              </div>
            )
          })}
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 6 }}>
            Last run: {new Date(data.ran_at).toLocaleString()} · every check is a live probe (real query, HTTP call or file write), not a config read.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main AdminPage ─────────────────────────────────────────────────
type AdminSection = 'overview' | 'users' | 'activity' | 'subscriptions' | 'engines' | 'reports' | 'plans' | 'broadcast' | 'settings' | 'system' | 'audit'

const SECTIONS: { id: AdminSection; label: string; icon: string }[] = [
  { id: 'overview',      label: 'Overview',       icon: '◈' },
  { id: 'users',         label: 'Users',          icon: '⊞' },
  { id: 'activity',      label: 'Activity',       icon: '◉' },
  { id: 'subscriptions', label: 'Subscriptions',  icon: '◎' },
  { id: 'reports',       label: 'Reports',        icon: '▦' },
  { id: 'plans',         label: 'Plan Limits',    icon: '◧' },
  { id: 'engines',       label: 'AI Engines',     icon: '⚡' },
  { id: 'broadcast',     label: 'Broadcast',      icon: '◳' },
  { id: 'settings',      label: 'Settings',       icon: '⚙' },
  { id: 'system',        label: 'System Check',   icon: '✚' },
  { id: 'audit',         label: 'Audit Log',      icon: '◷' },
]

export function AdminPage({ user, onBack, standalone }: { user: User; onBack?: () => void; standalone?: boolean }) {
  const [section, setSection] = useState<AdminSection>('overview')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin_sidebar') === 'collapsed')

  function toggleSidebar() {
    setCollapsed(c => {
      localStorage.setItem('admin_sidebar', c ? 'open' : 'collapsed')
      return !c
    })
  }

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
        width: collapsed ? 52 : 180, flexShrink: 0, background: 'var(--bg-2)',
        borderRight: '1px solid var(--border)', padding: '16px 8px',
        display: 'flex', flexDirection: 'column', gap: 2,
        transition: 'width 0.2s ease', overflow: 'hidden',
      }}>
        <div style={{
          padding: collapsed ? '4px 0 14px' : '4px 10px 14px',
          borderBottom: '1px solid var(--border)', marginBottom: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Admin Panel</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, whiteSpace: 'nowrap' }}>
                {user.role === 'super_admin' ? '⭐ Super Admin' : '🛡 Admin'}
              </div>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              border: '1px solid var(--border-2)', background: 'transparent',
              color: 'var(--text-3)', borderRadius: 6, cursor: 'pointer',
              width: 26, height: 26, fontSize: 12, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: collapsed ? '0 auto' : undefined,
            }}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            title={collapsed ? s.label : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '7px 0' : '7px 10px', borderRadius: 6, border: 'none',
              cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: 13,
              whiteSpace: 'nowrap',
              background: section === s.id ? 'var(--accent-lt)' : 'transparent',
              color: section === s.id ? 'var(--accent)' : 'var(--text-2)',
              fontWeight: section === s.id ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 14, width: 16, textAlign: 'center', flexShrink: 0 }}>{s.icon}</span>
            {!collapsed && s.label}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {!standalone && onBack && (
          <button className="btn btn--ghost btn--sm"
            onClick={onBack}
            title={collapsed ? 'Back to app' : undefined}
            style={{ fontSize: 11, justifyContent: collapsed ? 'center' : 'flex-start', gap: 6 }}>
            {icons.back} {!collapsed && 'Back to app'}
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {section === 'overview'      && <OverviewSection />}
        {section === 'users'         && <UsersSection currentUser={user} />}
        {section === 'activity'      && <ActivitySection />}
        {section === 'subscriptions' && <SubscriptionsSection />}
        {section === 'reports'       && <ReportsSection />}
        {section === 'plans'         && <PlansSection />}
        {section === 'engines'       && <EnginesSection />}
        {section === 'broadcast'     && <BroadcastSection />}
        {section === 'settings'      && <AppSettingsSection currentUser={user} />}
        {section === 'system'        && <SystemCheckSection />}
        {section === 'audit'         && <AuditLogSection />}
      </div>
    </div>
  )
}
