import { useState, useEffect } from 'react'
import { uid, saveAudioBlob, loadAudioRawBlob, deleteAudioBlob } from '../audio'
import type { VoiceProfile } from '../types'
import type { GuestSession } from './useGuestSession'
import { GUEST_PROFILE_LIMIT } from './useGuestSession'

const metaKey  = (guestId: string) => `vs_guest_profiles_${guestId}`
const blobKey  = (profileId: string)  => `guest_voice_${profileId}`

export interface GuestVoiceProfileMeta {
  id: string
  profile_id: string
  name: string
  duration: number | null
  createdAt: string
}

export function useGuestVoiceProfiles(session: GuestSession | null) {
  const [profiles, setProfiles] = useState<GuestVoiceProfileMeta[]>([])

  useEffect(() => {
    if (!session) { setProfiles([]); return }
    try {
      const raw = localStorage.getItem(metaKey(session.guestId))
      setProfiles(raw ? JSON.parse(raw) : [])
    } catch { setProfiles([]) }
  }, [session?.guestId])

  function persistMeta(list: GuestVoiceProfileMeta[]) {
    if (!session) return
    localStorage.setItem(metaKey(session.guestId), JSON.stringify(list))
    setProfiles(list)
  }

  async function saveProfile(
    name: string,
    blob: Blob,
    durationSecs: number,
  ): Promise<boolean> {
    if (profiles.length >= GUEST_PROFILE_LIMIT) return false
    const slug = name.trim().replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'my-voice'
    await saveAudioBlob(blobKey(slug), blob)
    const entry: GuestVoiceProfileMeta = {
      id:         uid(),
      profile_id: slug,
      name:       slug,
      duration:   Math.round(durationSecs * 10) / 10,
      createdAt:  new Date().toISOString(),
    }
    persistMeta([...profiles, entry])
    return true
  }

  async function deleteProfile(profileId: string) {
    await deleteAudioBlob(blobKey(profileId))
    persistMeta(profiles.filter(p => p.profile_id !== profileId))
  }

  function getAudioBlob(profileId: string): Promise<Blob | null> {
    return loadAudioRawBlob(blobKey(profileId))
  }

  function clearProfiles() {
    profiles.forEach(p => deleteAudioBlob(blobKey(p.profile_id)))
    if (session) localStorage.removeItem(metaKey(session.guestId))
    setProfiles([])
  }

  // VoiceProfile-compatible list for components that expect VoiceProfile[]
  const asVoiceProfiles: VoiceProfile[] = profiles.map((p, i) => ({
    id:         i + 1,
    profile_id: p.profile_id,
    name:       p.name,
    status:     'ready',
    duration:   p.duration,
  }))

  return { profiles, asVoiceProfiles, saveProfile, deleteProfile, getAudioBlob, clearProfiles }
}
