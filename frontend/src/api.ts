const ENGINE_API_BASE = 'http://127.0.0.1:8000';
const AUTH_API_BASE = 'http://127.0.0.1:8080';

/**
 * Utility to handle API requests with cookie-based auth (Sanctum SPA).
 * Ensures credentials are included and handles CSRF cookie fetching.
 */
function getCookie(name: string) {
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

class ApiClient {
  private csrfFetched = false;

  async getCsrfCookie() {
    if (this.csrfFetched) return;
    await fetch(`${AUTH_API_BASE}/sanctum/csrf-cookie`, {
      method: 'GET',
      credentials: 'include',
    });
    this.csrfFetched = true;
  }

  async request(path: string, options: RequestInit = {}) {
    const isLaravelRoute = ['/login', '/register', '/logout', '/user', '/projects', '/voice-profiles'].some(p => path === p || path.startsWith(p + '/'));

    // For state-changing requests to the Laravel backend, ensure we have the CSRF cookie
    if (isLaravelRoute && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase() || '')) {
      await this.getCsrfCookie();
    }

    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else if (isLaravelRoute) {
      url = `${AUTH_API_BASE}/api${path}`;
    } else {
      url = `${ENGINE_API_BASE}${path.startsWith('/') ? '' : '/api/'}${path}`;
    }
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

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
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.message || 'An error occurred');
      (error as any).status = response.status;
      (error as any).data = errorData;
      throw error;
    }

    if (response.status === 204) return null;
    
    const contentType = response.headers.get('Content-Type');
    if (contentType && (contentType.includes('audio/') || contentType.includes('application/octet-stream'))) {
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
      body: JSON.stringify(data),
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
}

export const api = new ApiClient();
