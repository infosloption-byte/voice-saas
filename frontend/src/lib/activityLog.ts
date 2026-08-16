import { api, ApiError } from './api'

export type LogStatus = 'running' | 'done' | 'failed'

export interface LogEntry {
  id: string
  projectId?: string
  eventType?: string
  message: string
  detail?: string
  status: LogStatus
  startedAt: number
  endedAt?: number
}

// ── In-memory store (reflects backend truth) ───────────────────────
let _entries: LogEntry[] = []
const _listeners = new Set<(entries: LogEntry[]) => void>()

function _notify() {
  const copy = [..._entries]
  _listeners.forEach(l => l(copy))
}

function _upsert(entry: LogEntry) {
  const idx = _entries.findIndex(e => e.id === entry.id)
  if (idx >= 0) {
    _entries = _entries.map((e, i) => i === idx ? entry : e)
  } else {
    _entries = [entry, ..._entries].slice(0, 300)
  }
  _notify()
}

function _fromApi(d: Record<string, unknown>): LogEntry {
  return {
    id:        String(d.id),
    projectId: (d.project_id as string | null) ?? undefined,
    eventType: (d.event_type as string) ?? undefined,
    message:   d.message as string,
    detail:    (d.detail as string | null) ?? undefined,
    status:    d.status as LogStatus,
    startedAt: new Date(d.started_at as string).getTime(),
    endedAt:   d.ended_at ? new Date(d.ended_at as string).getTime() : undefined,
  }
}

// ── Public API ─────────────────────────────────────────────────────
export const activityLog = {
  subscribe(cb: (entries: LogEntry[]) => void): () => void {
    _listeners.add(cb)
    cb([..._entries])
    return () => _listeners.delete(cb)
  },

  /**
   * Start a new log entry. Returns handle with done/fail/update.
   * Persists to backend if authenticated; falls back to in-memory (guests).
   */
  async start(
    message: string,
    detail?: string,
    meta?: { projectId?: string; eventType?: string },
  ) {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const now = Date.now()
    const entry: LogEntry = {
      id: tempId, message, detail,
      projectId: meta?.projectId,
      eventType: meta?.eventType,
      status: 'running',
      startedAt: now,
    }
    _upsert(entry)

    let backendId: string | null = null
    try {
      const res = await api.post('/activity-logs', {
        project_id:  meta?.projectId ?? null,
        event_type:  meta?.eventType ?? 'task',
        message,
        detail:      detail ?? null,
        started_at:  new Date(now).toISOString(),
      }) as Record<string, unknown>
      backendId = String(res.id)
      // Replace temp entry with the server-issued id
      _entries = _entries.map(e => e.id === tempId ? { ..._fromApi(res) } : e)
      _notify()
    } catch (e) {
      // guest or network error — stay in-memory only
      if (import.meta.env.DEV) console.warn('[activityLog] store failed:', e)
    }

    const resolvedId = backendId ?? tempId

    async function patch(payload: Record<string, unknown>) {
      if (!backendId) return
      try { await api.put(`/activity-logs/${backendId}`, payload) } catch {}
    }

    return {
      done(detail?: string) {
        const endedAt = Date.now()
        _entries = _entries.map(e =>
          e.id === resolvedId ? { ...e, status: 'done' as const, detail, endedAt } : e,
        )
        _notify()
        patch({ status: 'done', detail: detail ?? null, ended_at: new Date(endedAt).toISOString() })
      },
      fail(detail?: string) {
        const endedAt = Date.now()
        _entries = _entries.map(e =>
          e.id === resolvedId ? { ...e, status: 'failed' as const, detail, endedAt } : e,
        )
        _notify()
        patch({ status: 'failed', detail: detail ?? null, ended_at: new Date(endedAt).toISOString() })
      },
      update(message: string, detail?: string) {
        _entries = _entries.map(e =>
          e.id === resolvedId ? { ...e, message, detail } : e,
        )
        _notify()
        patch({ message, detail: detail ?? null })
      },
    }
  },

  /**
   * Fetch a single server-created log (e.g. from a background job) and add
   * it to the local in-memory store so it shows immediately in the activity
   * panel. Returns a handle to push updates into the store as polling arrives.
   */
  async track(serverLogId: number) {
    try {
      const res = await api.get(`/activity-logs/${serverLogId}`) as Record<string, unknown>
      const entry = _fromApi(res)
      _upsert(entry)

      return {
        update(data: Record<string, unknown>) {
          _upsert(_fromApi(data))
        },
      }
    } catch {
      return null
    }
  },

  /** Pull the latest entries from the backend (replaces in-memory). */
  async fetch(projectId?: string): Promise<void> {
    try {
      const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      const data = await api.get(`/activity-logs${qs}`) as Record<string, unknown>[]
      _entries = data.map(_fromApi)
      _notify()
    } catch { /* unauthenticated or offline */ }
  },

  /** Delete entries from the backend (+ clear local mirror). Returns false on backend failure. */
  async clear(projectId?: string): Promise<boolean> {
    let ok = true
    try {
      const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      await api.delete(`/activity-logs${qs}`)
    } catch (e) {
      // Guests have no backend log — clearing locally is fine. Authed users
      // should see the failure, otherwise the poll resurrects the entries.
      if (e instanceof ApiError && e.status !== 401) ok = false
    }
    if (projectId) {
      _entries = _entries.filter(e => e.projectId !== projectId)
    } else {
      _entries = []
    }
    _notify()
    return ok
  },
}
