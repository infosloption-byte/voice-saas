import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { icons } from '../lib/constants'
import { toast } from '../lib/toast'
import { useEscapeKey } from '../hooks/useEscapeKey'
import type { VideoProject } from '../lib/types'

/**
 * Task #15 (Video Studio) Phase 1 — the project list. This is what the
 * "Video Studio" nav item now loads (it used to jump straight into
 * DubbingStudioPage's flat job list); clicking a card here is what opens
 * DubbingStudioPage, scoped to that project. Deliberately styled to reuse
 * the audio Projects page's existing `.project-grid`/`.project-card` CSS
 * (see AppPages.tsx's ProjectsPage) rather than introducing a parallel set
 * of card styles for what's structurally the same "grid of things you can
 * open or delete" pattern.
 *
 * Known gap, not fixed here: no rename-in-place UI yet (the API supports
 * it — see api.renameVideoProject — but there's no affordance to trigger
 * it from this page). Low priority for Phase 1 since every project starts
 * as "Untitled project" and renaming isn't blocking any other phase.
 */
export function VideoProjectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const confirmProject = projects.find(p => p.id === confirmId)
  useEscapeKey(() => setConfirmId(null), confirmId !== null && !deleting)

  // New-project name prompt — asks for a name before creating/navigating,
  // instead of silently creating "Untitled project" on click.
  const [namePromptOpen, setNamePromptOpen] = useState(false)
  const [newName, setNewName] = useState('')
  useEscapeKey(() => { if (!creating) setNamePromptOpen(false) }, namePromptOpen)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.listVideoProjects() as { projects: VideoProject[] }
      setProjects(res.projects ?? [])
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Failed to load video projects.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openNamePrompt() {
    setNewName('')
    setNamePromptOpen(true)
  }

  async function createProject() {
    setCreating(true)
    try {
      const project = await api.createVideoProject(newName.trim() || undefined) as VideoProject
      toast.ok('Video project created.')
      setNamePromptOpen(false)
      onOpen(project.id)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to create video project.')
    } finally {
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!confirmId) return
    setDeleting(true)
    try {
      await api.deleteVideoProject(confirmId)
      setProjects(prev => prev.filter(p => p.id !== confirmId))
      toast.ok('Video project deleted.')
      setConfirmId(null)
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : 'Failed to delete video project.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 13, padding: '40px 0' }}>
        <span className="spinner" /> Loading video projects…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="empty-state" style={{ padding: '40px 0' }}>
        <p>{loadError}</p>
        <button className="btn btn--ghost" onClick={load} style={{ marginTop: 10 }}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      <div className="proj-page-head">
        <div>
          <h2 className="proj-page-head__title">Video Studio</h2>
          <p className="proj-page-head__sub">
            {projects.length} project{projects.length !== 1 ? 's' : ''} · dub videos, mix in images and audio, and compose a timeline
          </p>
        </div>
      </div>

      <div className="project-grid">
        <button className="project-card project-card--new" onClick={openNamePrompt} disabled={creating}>
          <div className="project-card--new__inner">
            <div className="project-card--new__icon">{icons.plus}</div>
            <span className="project-card--new__label">New video project</span>
            <span className="project-card--new__hint">Upload a video, image, or audio clip to start</span>
          </div>
        </button>

        {projects.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '20px 0' }}>
            <p>No video projects yet — create one to start dubbing or editing.</p>
          </div>
        )}

        {projects.map(p => (
          <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
            <div className="project-card__actions">
              <button
                className="btn btn--icon btn--ghost btn--sm"
                title="Delete video project"
                onClick={e => { e.stopPropagation(); setConfirmId(p.id) }}
              >
                {icons.trash}
              </button>
            </div>

            <div className="project-card__header">
              <div className="project-card__icon">🎬</div>
              <div className="project-card__header-text">
                <div className="project-card__name">{p.name}</div>
                <div className="project-card__date">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </div>
              </div>
            </div>

            <div className="project-card__stats">
              <div className="project-card__stat">
                <span className="project-card__stat-val">{p.asset_count}</span>
                <span className="project-card__stat-lbl">Asset{p.asset_count !== 1 ? 's' : ''}</span>
              </div>
            </div>

            <div className="project-card__tags">
              {p.status === 'draft'     && <span className="tag">Draft</span>}
              {p.status === 'rendering' && <span className="tag tag--info">Rendering…</span>}
              {p.status === 'done'      && <span className="tag tag--ok">Rendered</span>}
              {p.status === 'failed'    && <span className="tag tag--warn">Render failed</span>}
              {p.asset_count === 0 && <span className="tag tag--warn">Empty</span>}
            </div>
          </div>
        ))}
      </div>

      {namePromptOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Name your video project" onClick={() => !creating && setNamePromptOpen(false)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Name your video project</div>
            <div className="modal__body">
              <input
                autoFocus
                className="full-input"
                placeholder="Untitled project"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !creating) createProject() }}
                maxLength={255}
              />
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setNamePromptOpen(false)} disabled={creating}>Cancel</button>
              <button className="btn btn--primary" onClick={createProject} disabled={creating}>
                {creating ? <span className="spinner" /> : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmId && confirmProject && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete video project" onClick={() => !deleting && setConfirmId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal__title">Delete video project?</div>
            <div className="modal__body">
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>
                <strong>{confirmProject.name}</strong> and its {confirmProject.asset_count} asset{confirmProject.asset_count !== 1 ? 's' : ''} will be permanently deleted. This cannot be undone.
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                Any dubbing jobs attached to this project stay in your Video Studio job history — only the project itself and its non-dubbed uploads are removed.
              </p>
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmId(null)} disabled={deleting}>Cancel</button>
              <button className="btn btn--danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? <span className="spinner" /> : icons.trash} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
