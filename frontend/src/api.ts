const ENGINE_API_BASE = 'http://127.0.0.1:8000';
const LARAVEL_API_BASE = 'http://localhost:8080';;

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

// Paths that belong to the Laravel backend
const LARAVEL_PATHS = [
  '/login', '/logout', '/register', '/user',
  '/projects', '/voice-profiles', '/sanctum',
];

function isLaravelPath(path: string): boolean {
  return LARAVEL_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

class ApiClient {
  async getCsrfCookie(): Promise<void> {
    // Always fetch fresh — lightweight GET, browser caches the cookie
    try {
      await fetch(`${LARAVEL_API_BASE}/sanctum/csrf-cookie`, {
        method: 'GET',
        credentials: 'include',
      });
    } catch (e) {
      console.warn('CSRF cookie fetch failed:', e);
    }
  }

  async request(path: string, options: RequestInit = {}): Promise<any> {
    const method = (options.method ?? 'GET').toUpperCase();
    const laravel = isLaravelPath(path);

    // Fetch CSRF token before any state-changing Laravel request
    if (laravel && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await this.getCsrfCookie();
    }

    // Build full URL
    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else if (laravel) {
      url = `${LARAVEL_API_BASE}/api${path}`;
    } else {
      // Engine routes (voice synthesis, transcription, etc.)
      url = `${ENGINE_API_BASE}${path.startsWith('/') ? path : '/' + path}`;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    };

    // Only set Content-Type for JSON bodies (not FormData)
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const xsrfToken = getCookie('XSRF-TOKEN');
    if (xsrfToken) {
      headers['X-XSRF-TOKEN'] = xsrfToken;
    }

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      let errorData: any = {};
      try { errorData = await response.json(); } catch { /* ignore */ }
      const error = new Error(errorData.message ?? `HTTP ${response.status}`);
      (error as any).status = response.status;
      (error as any).data = errorData;
      throw error;
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
      return response.blob();
    }

    return response.json();
  }

  get(path: string, options: RequestInit = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  post(path: string, data?: any, options: RequestInit = {}) {
    return this.request(path, {
      ...options,
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data),
    });
  }

  put(path: string, data?: any, options: RequestInit = {}) {
    return this.request(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete(path: string, options: RequestInit = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }

  // ── Engine-specific helpers (always go to port 8000) ──────────────

  enginePost(path: string, formData: FormData): Promise<any> {
    return this.request(path.startsWith('/') ? path : '/' + path, {
      method: 'POST',
      body: formData,
      // No Content-Type header — let browser set multipart boundary
    });
  }

  engineGet(path: string): Promise<any> {
    return fetch(`${ENGINE_API_BASE}${path.startsWith('/') ? path : '/' + path}`, {
      method: 'GET',
      credentials: 'omit',
    }).then(r => r.json());
  }
}

export const api = new ApiClient();

// ── Data mappers: snake_case (Laravel) ↔ camelCase (frontend) ───────

export function mapScript(raw: any) {
  return {
    id: raw.id,
    title: raw.title ?? 'Untitled',
    content: raw.content ?? '',
    hasAudio: raw.has_audio ?? false,
    profileId: raw.profile_id ?? null,
    language: raw.language ?? 'en',
    duration: raw.duration ?? null,
    speed: raw.speed ?? 1.0,
    waveformPeaks: raw.waveform_peaks ?? undefined,
    orderIndex: raw.order_index ?? 0,
  };
}

export function mapProject(raw: any) {
  return {
    id: raw.id,
    name: raw.name ?? 'Untitled',
    emoji: raw.emoji ?? '🎬',
    description: raw.description ?? '',
    createdAt: raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
    scripts: (raw.scripts ?? []).map(mapScript),
  };
}