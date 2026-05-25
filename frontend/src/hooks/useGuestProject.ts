import { useState, useEffect } from 'react'
import { uid } from '../audio'
import type { Project, Script } from '../types'
import type { GuestSession } from './useGuestSession'
import { GUEST_SCRIPT_LIMIT } from './useGuestSession'

const key = (guestId: string) => `vs_guest_project_${guestId}`

export function useGuestProject(session: GuestSession | null) {
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    if (!session) { setProject(null); return }
    try {
      const raw = localStorage.getItem(key(session.guestId))
      setProject(raw ? JSON.parse(raw) : null)
    } catch {
      setProject(null)
    }
  }, [session?.guestId])

  function persist(p: Project) {
    if (!session) return
    localStorage.setItem(key(session.guestId), JSON.stringify(p))
    setProject(p)
  }

  function ensureProject(): Project {
    if (project) return project
    const p: Project = {
      id:          uid(),
      name:        'My Guest Project',
      emoji:       '🎬',
      description: '',
      createdAt:   new Date().toISOString(),
      scripts:     [],
    }
    persist(p)
    return p
  }

  // Returns the new script, or null if the limit is already hit
  function addScript(template?: { title?: string; content?: string }): Script | null {
    const p = ensureProject()
    if (p.scripts.length >= GUEST_SCRIPT_LIMIT) return null
    const s: Script = {
      id:        uid(),
      title:     template?.title   ?? 'Untitled Script',
      content:   template?.content ?? '',
      hasAudio:  false,
      profileId: null,
      language:  'en',
      duration:  null,
      speed:     1.0,
      tone:      'natural',
    }
    persist({ ...p, scripts: [...p.scripts, s] })
    return s
  }

  function updateScript(scriptId: string, update: Partial<Script>) {
    if (!project) return
    persist({
      ...project,
      scripts: project.scripts.map(s => s.id === scriptId ? { ...s, ...update } : s),
    })
  }

  function deleteScript(scriptId: string) {
    if (!project) return
    persist({ ...project, scripts: project.scripts.filter(s => s.id !== scriptId) })
  }

  function reorderScripts(scripts: Script[]) {
    if (!project) return
    persist({ ...project, scripts })
  }

  function updateProject(update: Partial<Project>) {
    if (!project) return
    persist({ ...project, ...update })
  }

  function clearProject() {
    if (!session) return
    localStorage.removeItem(key(session.guestId))
    setProject(null)
  }

  return {
    project, ensureProject,
    addScript, updateScript, deleteScript, reorderScripts, updateProject,
    clearProject,
  }
}
