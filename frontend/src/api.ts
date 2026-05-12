const ENGINE_API_BASE = 'http://3.83.53.113:8000';
const LARAVEL_BASE = 'http://3.83.53.113:8080';
const LARAVEL_API_BASE = `${LARAVEL_BASE}/api`;    // all API routes live here

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// Paths that belong to the Laravel backend (relative, without /api prefix)
const LARAVEL_PATHS = [
  '/login', '/logout', '/register', '/user',
  '/projects', '/voice-profiles', '/scripts',
];

function isLaravelPath(path: string): boolean {
  return LARAVEL_PATHS.some(
    p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')
  );
}

class ApiClient {
  /** Fetch a fresh CSRF cookie from Sanctum. Must be called before any
   *  state-changing request so Laravel sets the XSRF-TOKEN cookie. */
  async getCsrfCookie(): Promise<void> {
    try {
      await fetch(`${LARAVEL_BASE}/sanctum/csrf-cookie`, {
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

    // Always refresh CSRF before any mutating Laravel request
    if (laravel && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await this.getCsrfCookie();
    }

    // Build full URL
    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else if (laravel) {
      url = `${LARAVEL_API_BASE}${path}`;
    } else {
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

      // Flatten Laravel validation errors into a readable message
      let message = errorData.message ?? `HTTP ${response.status}`;
      if (errorData.errors) {
        const firstField = Object.values(errorData.errors as Record<string, string[]>)[0];
        if (firstField?.[0]) message = firstField[0];
      }

      const error = new Error(message);
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
      body: data instanceof FormData ? data : (data !== undefined ? JSON.stringify(data) : undefined),
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
    const fullPath = path.startsWith('/') ? path : '/' + path;
    return fetch(`${ENGINE_API_BASE}${fullPath}`, {
      method: 'POST',
      body: formData,
      credentials: 'omit',
    }).then(async r => {
      if (!r.ok) throw new Error(`Engine error: HTTP ${r.status}`);
      const ct = r.headers.get('Content-Type') ?? '';
      return ct.includes('audio/') ? r.blob() : r.json();
    });
  }

  engineGet(path: string): Promise<any> {
    const fullPath = path.startsWith('/') ? path : '/' + path;
    return fetch(`${ENGINE_API_BASE}${fullPath}`, {
      method: 'GET',
      credentials: 'omit',
    }).then(r => r.json());
  }
}

export const api = new ApiClient();

// ── Data mappers: snake_case (Laravel) ↔ camelCase (frontend) ────────

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