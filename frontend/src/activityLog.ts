export type LogStatus = 'running' | 'done' | 'failed'

export interface LogEntry {
  id: string
  message: string
  status: LogStatus
  detail?: string
  startedAt: number
  endedAt?: number
}

let _entries: LogEntry[] = []
let _seq = 0
const _listeners = new Set<(entries: LogEntry[]) => void>()

function _notify() {
  const copy = [..._entries]
  _listeners.forEach(l => l(copy))
}

export const activityLog = {
  subscribe(cb: (entries: LogEntry[]) => void): () => void {
    _listeners.add(cb)
    cb([..._entries])
    return () => _listeners.delete(cb)
  },

  start(message: string, detail?: string) {
    const id = String(_seq++)
    const entry: LogEntry = { id, message, status: 'running', detail, startedAt: Date.now() }
    _entries = [entry, ..._entries].slice(0, 100)
    _notify()
    return {
      done(detail?: string) {
        _entries = _entries.map(e => e.id === id ? { ...e, status: 'done' as const, detail, endedAt: Date.now() } : e)
        _notify()
      },
      fail(detail?: string) {
        _entries = _entries.map(e => e.id === id ? { ...e, status: 'failed' as const, detail, endedAt: Date.now() } : e)
        _notify()
      },
      update(message: string, detail?: string) {
        _entries = _entries.map(e => e.id === id ? { ...e, message, detail } : e)
        _notify()
      },
    }
  },

  clear() {
    _entries = []
    _notify()
  },
}
