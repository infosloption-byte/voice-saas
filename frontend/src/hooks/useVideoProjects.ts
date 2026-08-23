import { useState, useCallback } from 'react'
import { api, ApiError } from '../lib/api'

// ── Types (Phase 1 — see docs/ENHANCEMENT_TASKS.md task #6a) ─────────
// Not added to lib/types.ts yet on purpose: that file is Assembly's
// (audio) type surface and mixing in an unrelated feature's types felt
// like the wrong seam. If a shared "media" type layer emerges once
// Phase 3 (timeline UI) starts, worth revisiting.

export interface VideoProjectClip {
  id: string
  kind: 'source' | 'dubbed'
  parentClipId: string | null
  dubbingJobId: string | null
  originalFilename: string | null
  durationSeconds: number | null
  status: 'ready' | 'processing' | 'failed'
}

export interface TimelineEntry {
  clipId: string
  trimIn: number
  trimOut: number
  variant: 'source' | 'dubbed'
}

export interface VideoProject {
  id: string
  name: string
  status: 'draft' | 'rendering' | 'done' | 'failed'
  timeline: TimelineEntry[]
  clips: VideoProjectClip[]
  outputVideoPath: string | null
  durationSeconds: number | null
}

/** Params for "Dub this clip" (Phase 2) — same shape /dubbing/submit takes. */
export interface DubClipParams {
  targetLanguage: string
  sourceLanguage?: string
  voiceProfileId: string
  engine?: string
}

function mapClip(raw: Record<string, unknown>): VideoProjectClip {
  return {
    id: raw.id as string,
    kind: (raw.kind as VideoProjectClip['kind']) ?? 'source',
    parentClipId: (raw.parent_clip_id as string) ?? null,
    dubbingJobId: (raw.dubbing_job_id as string) ?? null,
    originalFilename: (raw.original_filename as string) ?? null,
    durationSeconds: (raw.duration_seconds as number) ?? null,
    status: (raw.status as VideoProjectClip['status']) ?? 'ready',
  }
}

function mapVideoProject(raw: Record<string, unknown>): VideoProject {
  return {
    id: raw.id as string,
    name: (raw.name as string) ?? 'Untitled video',
    status: (raw.status as VideoProject['status']) ?? 'draft',
    timeline: ((raw.timeline_json as TimelineEntry[]) ?? []),
    clips: ((raw.clips as Record<string, unknown>[]) ?? []).map(mapClip),
    outputVideoPath: (raw.output_video_path as string) ?? null,
    durationSeconds: (raw.duration_seconds as number) ?? null,
  }
}

interface UseVideoProjectsReturn {
  projects: VideoProject[]
  loading: boolean
  error: string | null
  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<VideoProject | null>
  createProject: (name?: string) => Promise<VideoProject | null>
  renameProject: (id: string, name: string) => Promise<void>
  saveTimeline: (id: string, timeline: TimelineEntry[]) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  uploadClip: (projectId: string, file: File) => Promise<VideoProjectClip | null>
  deleteClip: (projectId: string, clipId: string) => Promise<void>
  dubClip: (projectId: string, clipId: string, params: DubClipParams) => Promise<{ clip: VideoProjectClip; jobId: string } | null>
}

export function useVideoProjects(): UseVideoProjectsReturn {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/video-projects') as Record<string, unknown>[]
      setProjects((data ?? []).map(mapVideoProject))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load video projects'
      setError(msg)
      console.error('[useVideoProjects] loadProjects:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadProject = useCallback(async (id: string): Promise<VideoProject | null> => {
    try {
      const data = await api.get(`/video-projects/${id}`) as Record<string, unknown>
      const project = mapVideoProject(data)
      setProjects(prev => {
        const exists = prev.some(p => p.id === id)
        return exists ? prev.map(p => p.id === id ? project : p) : [project, ...prev]
      })
      return project
    } catch (e) {
      console.error('[useVideoProjects] loadProject:', e)
      return null
    }
  }, [])

  const createProject = useCallback(async (name?: string): Promise<VideoProject | null> => {
    try {
      const data = await api.post('/video-projects', { name }) as Record<string, unknown>
      const project = mapVideoProject(data)
      setProjects(prev => [project, ...prev])
      return project
    } catch (e) {
      console.error('[useVideoProjects] createProject:', e)
      throw e
    }
  }, [])

  const renameProject = useCallback(async (id: string, name: string): Promise<void> => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p))
    try {
      await api.put(`/video-projects/${id}`, { name })
    } catch (e) {
      console.error('[useVideoProjects] renameProject:', e)
    }
  }, [])

  const saveTimeline = useCallback(async (id: string, timeline: TimelineEntry[]): Promise<void> => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, timeline } : p))
    try {
      await api.put(`/video-projects/${id}`, { timeline_json: timeline })
    } catch (e) {
      console.error('[useVideoProjects] saveTimeline:', e)
    }
  }, [])

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    let removed: VideoProject | undefined
    setProjects(prev => {
      removed = prev.find(p => p.id === id)
      return prev.filter(p => p.id !== id)
    })
    try {
      await api.delete(`/video-projects/${id}`)
    } catch (e) {
      if (removed) setProjects(prev => [removed!, ...prev])
      console.error('[useVideoProjects] deleteProject:', e)
    }
  }, [])

  const uploadClip = useCallback(async (projectId: string, file: File): Promise<VideoProjectClip | null> => {
    const fd = new FormData()
    fd.append('video', file)
    try {
      const data = await api.post(`/video-projects/${projectId}/clips`, fd) as Record<string, unknown>
      const clip = mapClip(data)
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, clips: [...p.clips, clip] } : p))
      return clip
    } catch (e) {
      if (e instanceof ApiError) console.error('[useVideoProjects] uploadClip:', e.status, e.message)
      else console.error('[useVideoProjects] uploadClip:', e)
      throw e
    }
  }, [])

  const deleteClip = useCallback(async (projectId: string, clipId: string): Promise<void> => {
    let removed: VideoProjectClip | undefined
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      removed = p.clips.find(c => c.id === clipId)
      return { ...p, clips: p.clips.filter(c => c.id !== clipId) }
    }))
    try {
      await api.delete(`/video-projects/${projectId}/clips/${clipId}`)
    } catch (e) {
      if (removed) {
        const r = removed
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, clips: [...p.clips, r] } : p))
      }
      console.error('[useVideoProjects] deleteClip:', e)
      throw e
    }
  }, [])

  /**
   * Phase 2 — "Dub this clip". Kicks off the existing dubbing pipeline
   * on a source bin clip and drops a 'processing' placeholder variant
   * into the bin immediately. The placeholder's real status/duration/
   * storage_path only refresh on the *next* loadProject()/GET call
   * (the backend syncs it there) — so after the user finishes the
   * existing review-timeline flow (segments → finalize) for the
   * returned jobId, call loadProject(projectId) again to pick up the
   * finished result.
   */
  const dubClip = useCallback(async (
    projectId: string,
    clipId: string,
    params: DubClipParams
  ): Promise<{ clip: VideoProjectClip; jobId: string } | null> => {
    try {
      const data = await api.post(`/video-projects/${projectId}/clips/${clipId}/dub`, {
        target_language: params.targetLanguage,
        source_language: params.sourceLanguage,
        voice_profile_id: params.voiceProfileId,
        engine: params.engine,
      }) as Record<string, unknown>

      const clip = mapClip(data.clip as Record<string, unknown>)
      const jobId = data.job_id as string

      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, clips: [...p.clips, clip] } : p))

      return { clip, jobId }
    } catch (e) {
      if (e instanceof ApiError) console.error('[useVideoProjects] dubClip:', e.status, e.message)
      else console.error('[useVideoProjects] dubClip:', e)
      throw e
    }
  }, [])

  return {
    projects, loading, error,
    loadProjects, loadProject, createProject, renameProject,
    saveTimeline, deleteProject, uploadClip, deleteClip, dubClip,
  }
}
