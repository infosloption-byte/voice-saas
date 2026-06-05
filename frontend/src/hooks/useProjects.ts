import { useState, useCallback } from 'react'
import { api, mapProject } from '../api'
import { deleteAudioBlob, uid } from '../audio'
import type { Project, Script } from '../types'

interface UseProjectsReturn {
  projects: Project[]
  loading: boolean
  error: string | null
  loadProjects: () => Promise<void>
  addProject: (name: string, emoji: string, description: string) => Promise<Project>
  updateProject: (id: string, update: Partial<Project>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  addScript: (projectId: string, template?: { title?: string; content?: string }) => Promise<Script | null>
  updateScript: (projectId: string, scriptId: string, update: Partial<Script>) => Promise<void>
  deleteScript: (projectId: string, scriptId: string) => Promise<void>
  reorderScripts: (projectId: string, scripts: Script[]) => Promise<void>
  saveTimeline: (projectId: string, clips: import('../types').TimelineClip[]) => Promise<void>
  uploadAudio: (scriptId: string, blob: Blob) => Promise<void>
  saveLaneConfig: (projectId: string, config: { solo: Record<number, boolean>; mute: Record<number, boolean> }) => Promise<void>
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Projects ─────────────────────────────────────────────────────

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/projects') as Record<string, unknown>[]
      setProjects((data ?? []).map(mapProject))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load projects'
      setError(msg)
      console.error('[useProjects] loadProjects:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const addProject = useCallback(async (
    name: string,
    emoji: string,
    description: string
  ): Promise<Project> => {
    const id = uid()
    const project: Project = {
      id, name, emoji, description,
      createdAt: new Date().toISOString(),
      scripts: [],
    }

    // Optimistic update
    setProjects(prev => [project, ...prev])

    try {
      await api.post('/projects', { id, name, emoji, description })
      return project
    } catch (e) {
      // Rollback on failure
      setProjects(prev => prev.filter(p => p.id !== id))
      console.error('[useProjects] addProject:', e)
      throw e
    }
  }, [])

  const updateProject = useCallback(async (
    id: string,
    update: Partial<Project>
  ): Promise<void> => {
    // Capture previous for rollback
    let prev: Project | undefined
    setProjects(current => {
      prev = current.find(p => p.id === id)
      return current.map(p => p.id === id ? { ...p, ...update } : p)
    })

    try {
      await api.put(`/projects/${id}`, update)
    } catch (e) {
      // Rollback
      if (prev) setProjects(current => current.map(p => p.id === id ? prev! : p))
      console.error('[useProjects] updateProject:', e)
    }
  }, [])

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    let deletedProject: Project | undefined
    setProjects(current => {
      deletedProject = current.find(p => p.id === id)
      return current.filter(p => p.id !== id)
    })

    // Clean up audio blobs
    deletedProject?.scripts.forEach(s => {
      if (s.hasAudio) deleteAudioBlob(`audio_${s.id}`)
    })

    try {
      await api.delete(`/projects/${id}`)
    } catch (e) {
      // Rollback project list (audio blobs can't be recovered)
      if (deletedProject) setProjects(prev => [deletedProject!, ...prev])
      console.error('[useProjects] deleteProject:', e)
    }
  }, [])

  // ── Scripts ───────────────────────────────────────────────────────

  const addScript = useCallback(async (projectId: string, template?: { title?: string; content?: string }): Promise<Script | null> => {
    const script: Script = {
      id: uid(),
      title: template?.title ?? 'Untitled Script',
      content: template?.content ?? '',
      hasAudio: false,
      profileId: null,
      language: 'en',
      duration: null,
      speed: 1.0,
      tone: 'natural',
    }

    let orderIndex = 0
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      orderIndex = p.scripts.length
      return { ...p, scripts: [...p.scripts, script] }
    }))

    try {
      await api.post(`/projects/${projectId}/scripts`, {
        id: script.id,
        title: script.title,
        content: script.content,
        has_audio: false,
        profile_id: null,
        language: script.language,
        duration: null,
        speed: script.speed,
        order_index: orderIndex,
      })
      return script
    } catch (e) {
      // Rollback
      setProjects(prev => prev.map(p =>
        p.id === projectId
          ? { ...p, scripts: p.scripts.filter(s => s.id !== script.id) }
          : p
      ))
      console.error('[useProjects] addScript:', e)
      return null
    }
  }, [])

  const updateScript = useCallback(async (
    projectId: string,
    scriptId: string,
    update: Partial<Script>
  ): Promise<void> => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, scripts: p.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s) }
        : p
    ))

    const payload: Record<string, unknown> = {
      project_id: projectId,
      script_id: scriptId,
    }
    if ('title'         in update) payload.title          = update.title
    if ('content'       in update) payload.content        = update.content
    if ('hasAudio'      in update) payload.has_audio      = update.hasAudio
    if ('profileId'     in update) payload.profile_id     = update.profileId
    if ('language'      in update) payload.language       = update.language
    if ('duration'      in update) payload.duration       = update.duration
    if ('speed'         in update) payload.speed          = update.speed
    if ('tone'          in update) payload.tone           = update.tone
    if ('speakerMap'    in update) payload.speaker_map    = update.speakerMap
    if ('waveformPeaks' in update) payload.waveform_peaks = update.waveformPeaks
    if ('audioUrl'      in update) payload.audio_url      = update.audioUrl

    try {
      await api.post('/scripts/update', payload)
    } catch (e) {
      console.error('[useProjects] updateScript:', e)
    }
  }, [])

  const deleteScript = useCallback(async (
    projectId: string,
    scriptId: string
  ): Promise<void> => {
    deleteAudioBlob(`audio_${scriptId}`)
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, scripts: p.scripts.filter(s => s.id !== scriptId) }
        : p
    ))

    try {
      await api.delete(`/projects/${projectId}/scripts/${scriptId}`)
    } catch (e) {
      console.error('[useProjects] deleteScript:', e)
    }
  }, [])

  const reorderScripts = useCallback(async (
    projectId: string,
    scripts: Script[]
  ): Promise<void> => {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, scripts } : p
    ))

    try {
      await api.post(`/projects/${projectId}/scripts/reorder`, {
        scripts: scripts.map((s, i) => ({ id: s.id, order_index: i })),
      })
    } catch (e) {
      console.error('[useProjects] reorderScripts:', e)
    }
  }, [])

  const saveTimeline = useCallback(async (
    projectId: string,
    clips: import('../types').TimelineClip[]
  ): Promise<void> => {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, timelineClips: clips } : p
    ))
    try {
      await api.put(`/projects/${projectId}`, { timeline_clips: clips })
    } catch (e) {
      console.error('[useProjects] saveTimeline:', e)
    }
  }, [])

  const uploadAudio = useCallback(async (scriptId: string, blob: Blob): Promise<void> => {
    const fd = new FormData()
    fd.append('file', blob, `${scriptId}.wav`)
    try {
      await api.post(`/scripts/${scriptId}/audio`, fd)
      setProjects(prev => prev.map(p => ({
        ...p,
        scripts: p.scripts.map(s => s.id === scriptId ? { ...s, audioUrl: `/scripts/${scriptId}/audio` } : s),
      })))
    } catch (e) {
      console.warn('[useProjects] uploadAudio failed (IndexedDB still holds the blob):', e)
    }
  }, [])

  const saveLaneConfig = useCallback(async (
    projectId: string,
    config: { solo: Record<number, boolean>; mute: Record<number, boolean> }
  ): Promise<void> => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, laneConfig: config } : p))
    try {
      await api.put(`/projects/${projectId}`, { lane_config: config })
    } catch (e) {
      console.error('[useProjects] saveLaneConfig:', e)
    }
  }, [])

  return {
    projects, loading, error,
    loadProjects,
    addProject, updateProject, deleteProject,
    addScript, updateScript, deleteScript, reorderScripts,
    saveTimeline,
    uploadAudio,
    saveLaneConfig,
  }
}