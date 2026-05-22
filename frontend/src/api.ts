// ── Environment validation ─────────────────────────────────────────
const ENGINE_API_BASE = import.meta.env.VITE_ENGINE_URL as string | undefined
const LARAVEL_API_BASE = import.meta.env.VITE_API_URL as string | undefined

if (!ENGINE_API_BASE || !LARAVEL_API_BASE) {
  throw new Error('[api] VITE_ENGINE_URL and VITE_API_URL must be set in .env')
}

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
  enginePost(path: string, formData: FormData, signal?: AbortSignal): Promise<unknown> {
    const fullPath = path.startsWith('/') ? path : '/' + path
    return fetch(`${ENGINE_BASE}${fullPath}`, {
      method: 'POST',
      body: formData,
      credentials: 'omit',
      signal,
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new ApiError(`Engine error: HTTP ${r.status}`, r.status, { body: text })
      }
      const ct = r.headers.get('Content-Type') ?? ''
      return ct.includes('audio/') ? r.blob() : r.json()
    })
  }

  engineGet(path: string): Promise<unknown> {
    const fullPath = path.startsWith('/') ? path : '/' + path
    return fetch(`${ENGINE_BASE}${fullPath}`, {
      method: 'GET',
      credentials: 'omit',
    }).then(r => {
      if (!r.ok) throw new ApiError(`Engine error: HTTP ${r.status}`, r.status)
      return r.json()
    })
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
    speakerMap: (raw.speaker_map as Record<string, string> | undefined) ?? undefined,
    waveformPeaks: (raw.waveform_peaks as number[] | undefined) ?? undefined,
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
  }
}