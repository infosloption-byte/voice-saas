import { useState, useEffect } from 'react'
import { api } from '../api'
import type { GuestLimits } from '../types'

export const DEFAULT_GUEST_LIMITS: GuestLimits = {
  synth_limit:    1,
  word_limit:     100,
  preview_limit:  2,
  script_limit:   3,
  profile_limit:  2,
  session_days:   7,
}

const CACHE_KEY = 'vs_guest_limits'

export function useGuestLimits(): GuestLimits {
  const [limits, setLimits] = useState<GuestLimits>(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      return raw ? { ...DEFAULT_GUEST_LIMITS, ...JSON.parse(raw) } : DEFAULT_GUEST_LIMITS
    } catch {
      return DEFAULT_GUEST_LIMITS
    }
  })

  useEffect(() => {
    api.get('/guest-limits')
      .then(data => {
        const l = { ...DEFAULT_GUEST_LIMITS, ...(data as Partial<GuestLimits>) }
        setLimits(l)
        localStorage.setItem(CACHE_KEY, JSON.stringify(l))
      })
      .catch(() => {})
  }, [])

  return limits
}
