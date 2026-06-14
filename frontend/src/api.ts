// ── Environment validation ─────────────────────────────────────────
const ENGINE_API_BASE = import.meta.env.VITE_ENGINE_URL as string | undefined
const LARAVEL_API_BASE = import.meta.env.VITE_API_URL as string | undefined

if (!ENGINE_API_BASE || !LARAVEL_API_BASE) {
  throw new Error('[api] VITE_ENGINE_URL and VITE_API_URL must be set in .env')
}

// Kept only for the legacy non-/engine fetch fallback in request(); the engine
// is otherwise reached through the backend proxy. The engine API key is no
// longer referenced on the client — it lives server-side.
const ENGINE_BASE = ENGINE_API_BASE ?? ''
const LARAVEL_BASE = LARAVEL_API_BASE?.replace(/\/api\/?$/, '') ?? ''
const LARAVEL_API = LARAVEL_API_BASE ?? ''

// ── CSRF helper ───────────────────────────────────────────────────
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[2]) : null
}

// ── Path routing ──────────────────────────────────────────────────
const LARAVEL_PATHS = [
  '/login', '/logout', '/register', '/user',
  '/projects', '/voice-profiles', '/scripts',
  '/forgot-password', '/reset-password',
  '/email', '/subscription', '/guest-limits',
  '/plan-limits', '/admin', '/synthesis', '/translation',
  '/engine', '/activity-logs', '/notifications',
]

function isLaravelPath(path: string): boolean {
  return LARAVEL_PATHS.some(
    p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')
  )
}

// ── API error class ───────────────────────────────────────────────
export class ApiError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(message: string, status: number, data: unknown = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

// ── API client ────────────────────────────────────────────────────
class ApiClient {
  private async getCsrfCookie(): Promise<void> {
    try {
      await fetch(`${LARAVEL_BASE}/sanctum/csrf-cookie`, {
        method: 'GET',
        credentials: 'include',
      })
    } catch (e) {
      console.warn('[api] CSRF cookie fetch failed:', e)
    }
  }

  async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const method = (options.method ?? 'GET').toUpperCase()
    const laravel = isLaravelPath(path)

    if (laravel && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await this.getCsrfCookie()
    }

    let url: string
    if (path.startsWith('http')) {
      url = path
    } else if (laravel) {
      url = `${LARAVEL_API}${path}`
    } else {
      url = `${ENGINE_BASE}${path.startsWith('/') ? path : '/' + path}`
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    const xsrfToken = getCookie('XSRF-TOKEN')
    if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    })

    if (!response.ok) {
      let errorData: Record<string, unknown> = {}
      try { errorData = await response.json() } catch { /* ignore */ }

      let message = (errorData.message as string) ?? `HTTP ${response.status}`
      if (errorData.errors && typeof errorData.errors === 'object') {
        const firstField = Object.values(errorData.errors as Record<string, string[]>)[0]
        if (firstField?.[0]) message = firstField[0]
      }

      throw new ApiError(message, response.status, errorData)
    }

    if (response.status === 204) return null

    const contentType = response.headers.get('Content-Type') ?? ''
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      return response.blob()
    }

    return response.json()
  }

  get(path: string, options: RequestInit = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'GET' })
  }

  post(path: string, data?: unknown, options: RequestInit = {}): Promise<unknown> {
    return this.request(path, {
      ...options,
      method: 'POST',
      body: data instanceof FormData
        ? data
        : data !== undefined ? JSON.stringify(data) : undefined,
    })
  }

  put(path: string, data?: unknown, options: RequestInit = {}): Promise<unknown> {
    return this.request(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  delete(path: string, options: RequestInit = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'DELETE' })
  }

  // ── Engine-specific helpers ────────────────────────────────────
  // The AI engine is no longer publicly reachable. These helpers route every
  // engine call through the Laravel backend proxy (which injects the engine
  // API key server-side), mapping the old engine path to its /engine/* route.
  private toBackendEnginePath(path: string): string {
    const p = path.startsWith('/') ? path : '/' + path
    if (p.startsWith('/engine/')) return p
    if (p === '/export/mp3') return '/engine/export-mp3'
    return '/engine' + p
  }

  enginePost(path: string, formData: FormData, signal?: AbortSignal): Promise<unknown> {
    return this.request(this.toBackendEnginePath(path), { method: 'POST', body: formData, signal })
  }

  engineJsonPost(path: string, data: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request(this.toBackendEnginePath(path), {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    })
  }

  engineGet(path: string): Promise<unknown> {
    return this.request(this.toBackendEnginePath(path), { method: 'GET' })
  }

  /**
   * Background synthesis: submit a job, poll status every `pollMs`, then
   * download the finished WAV. Falls back to the legacy synchronous
   * /synthesize endpoint if the engine has no job queue (404 on submit).
   */
  async engineSynthesize(
    formData: FormData,
    signal?: AbortSignal,
    pollMs = 2000,
  ): Promise<Blob> {
    // 1. Submit — routed through backend so it uses the active engine
    const csrfToken = getCookie('XSRF-TOKEN')
    const submitHeaders: Record<string, string> = {}
    if (csrfToken) submitHeaders['X-XSRF-TOKEN'] = csrfToken

    let submit: Response
    try {
      submit = await fetch(`${LARAVEL_API}/engine/synthesize/submit`, {
        method: 'POST', body: formData, credentials: 'include', signal,
        headers: submitHeaders,
      })
    } catch (e) {
      throw e
    }
    if (submit.status === 404) {
      // Older engine without the queue — use the synchronous path.
      return this.legacySynthesize(formData, signal) as Promise<Blob>
    }
    if (!submit.ok) {
      const text = await submit.text().catch(() => '')
      throw new ApiError(`Engine error: HTTP ${submit.status}`, submit.status, { body: text })
    }
    const { job_id } = (await submit.json()) as { job_id: string }

    // 2. Poll status until done or error
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await new Promise(res => setTimeout(res, pollMs))
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const sr = await fetch(`${LARAVEL_API}/engine/synthesize/status/${job_id}`, {
        method: 'GET', credentials: 'include', signal,
      })
      if (!sr.ok) {
        const text = await sr.text().catch(() => '')
        throw new ApiError(`Engine error: HTTP ${sr.status}`, sr.status, { body: text })
      }
      const st = (await sr.json()) as { status: string; error?: string; code?: number }
      if (st.status === 'error') {
        throw new ApiError(st.error ?? 'Synthesis failed', st.code ?? 500)
      }
      if (st.status === 'done') break
    }

    // 3. Download the result
    const rr = await fetch(`${LARAVEL_API}/engine/synthesize/result/${job_id}`, {
      method: 'GET', credentials: 'include', signal,
    })
    if (!rr.ok) {
      const text = await rr.text().catch(() => '')
      throw new ApiError(`Engine error: HTTP ${rr.status}`, rr.status, { body: text })
    }
    return rr.blob()
  }

  /** Legacy synchronous synthesis, proxied through the backend */
  async legacySynthesize(formData: FormData, signal?: AbortSignal): Promise<Blob> {
    const csrfToken = getCookie('XSRF-TOKEN')
    const h: Record<string, string> = {}
    if (csrfToken) h['X-XSRF-TOKEN'] = csrfToken
    const r = await fetch(`${LARAVEL_API}/engine/synthesize`, {
      method: 'POST', body: formData, credentials: 'include', signal, headers: h,
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new ApiError(`Engine error: HTTP ${r.status}`, r.status, { body: text })
    }
    return r.blob()
  }

  async engineFetchBlob(path: string): Promise<Blob> {
    const result = await this.request(this.toBackendEnginePath(path), { method: 'GET' })
    if (result instanceof Blob) return result
    throw new ApiError('Expected audio response from engine', 502)
  }
}

export const api = new ApiClient()

// ── Data mappers: snake_case (Laravel) ↔ camelCase (frontend) ─────
export function mapScript(raw: Record<string, unknown>) {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? 'Untitled',
    content: (raw.content as string) ?? '',
    hasAudio: (raw.has_audio as boolean) ?? false,
    profileId: (raw.profile_id as string | null) ?? null,
    language: (raw.language as string) ?? 'en',
    duration: (raw.duration as number | null) ?? null,
    speed: (raw.speed as number) ?? 1.0,
    tone: (raw.tone as string) ?? 'natural',
    engine: (raw.engine as string | undefined) ?? 'xtts',
    speakerMap: (raw.speaker_map as Record<string, string> | undefined) ?? undefined,
    waveformPeaks: (raw.waveform_peaks as number[] | undefined) ?? undefined,
    audioUrl: (raw.audio_url as string | undefined) ?? undefined,
    advancedParams: (raw.advanced_params as { temperature?: number; top_k?: number; top_p?: number } | undefined) ?? undefined,
    orderIndex: (raw.order_index as number) ?? 0,
  }
}

export function mapProject(raw: Record<string, unknown>) {
  return {
    id: raw.id as string,
    name: (raw.name as string) ?? 'Untitled',
    emoji: (raw.emoji as string) ?? '🎬',
    description: (raw.description as string) ?? '',
    createdAt: (raw.created_at as string) ?? (raw.createdAt as string) ?? new Date().toISOString(),
    scripts: ((raw.scripts as Record<string, unknown>[]) ?? []).map(mapScript),
    timelineClips: (raw.timeline_clips as import('./types').TimelineClip[] | undefined) ?? undefined,
    laneConfig: (raw.lane_config as { solo: Record<number, boolean>; mute: Record<number, boolean> } | undefined) ?? undefined,
  }
}