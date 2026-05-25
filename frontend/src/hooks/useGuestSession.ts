import { useState, useEffect } from 'react'

export const GUEST_SYNTH_LIMIT    = 1
export const GUEST_WORD_LIMIT     = 100
export const GUEST_PREVIEW_LIMIT  = 2
export const GUEST_SCRIPT_LIMIT   = 3
export const GUEST_PROFILE_LIMIT  = 2
export const GUEST_SESSION_DAYS   = 7

export type GateType =
  | 'synth_limit' | 'word_limit' | 'download'
  | 'preview_limit' | 'assembly_export'
  | 'script_limit' | 'profile_limit'

export interface GuestUsage {
  synthesesUsed: number
  previewsUsed: number
}

export interface GuestSession {
  guestId: string
  createdAt: string
  expiresAt: string
  usage: GuestUsage
}

const SESSION_KEY = 'vs_guest_session'

function makeSession(): GuestSession {
  const now = new Date()
  const exp = new Date(now.getTime() + GUEST_SESSION_DAYS * 86_400_000)
  return {
    guestId:   'guest_' + Math.random().toString(36).slice(2, 10),
    createdAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    usage:     { synthesesUsed: 0, previewsUsed: 0 },
  }
}

function isExpired(s: GuestSession): boolean {
  return new Date(s.expiresAt) <= new Date()
}

export function useGuestSession() {
  const [session, setSession] = useState<GuestSession | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const s = JSON.parse(raw) as GuestSession
        if (isExpired(s)) {
          purgeGuestStorage(s.guestId)
          localStorage.removeItem(SESSION_KEY)
        } else {
          setSession(s)
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
  }, [])

  function persist(s: GuestSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    setSession(s)
  }

  function initSession(): GuestSession {
    const s = makeSession()
    persist(s)
    return s
  }

  function updateUsage(field: keyof GuestUsage, delta = 1) {
    setSession(prev => {
      if (!prev) return prev
      const next = { ...prev, usage: { ...prev.usage, [field]: prev.usage[field] + delta } }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      return next
    })
  }

  function clearSession() {
    if (session) purgeGuestStorage(session.guestId)
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  const msLeft        = session ? Math.max(0, new Date(session.expiresAt).getTime() - Date.now()) : 0
  const daysRemaining  = Math.ceil(msLeft / 86_400_000)
  const hoursRemaining = Math.ceil(msLeft / 3_600_000)

  return { session, initSession, updateUsage, clearSession, daysRemaining, hoursRemaining }
}

export function purgeGuestStorage(guestId: string) {
  localStorage.removeItem(`vs_guest_project_${guestId}`)
  localStorage.removeItem(`vs_guest_profiles_${guestId}`)
}
