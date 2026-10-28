let accessToken: string | null = null;
let refreshToken: string | null = null;

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && retry && refreshToken) {
    const refresh = await fetch('/api/v1/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }), credentials: 'same-origin',
    });
    if (refresh.ok) {
      const session = await refresh.json() as { accessToken: string; refreshToken: string };
      accessToken = session.accessToken;
      refreshToken = session.refreshToken;
      headers.set('Authorization', `Bearer ${accessToken}`);
      response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const apexApi = {
  async login(username: string, password: string) {
    const session = await request<{ accessToken: string; refreshToken: string; user: unknown }>('/api/v1/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }, false);
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    return session;
  },
  async register(username: string, email: string, password: string) {
    const session = await request<{ accessToken: string; refreshToken: string; user: unknown }>('/api/v1/auth/register', {
      method: 'POST', body: JSON.stringify({ username, email, password }),
    }, false);
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;
    return session;
  },
  async logout() {
    if (!refreshToken) return;
    await request<void>('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
    accessToken = null;
    refreshToken = null;
  },
  me: () => request<{ user: unknown }>('/api/v1/auth/me'),
  getData: (namespace: string, key: string) => request<{ data: unknown }>(`/api/v1/data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`),
  putData: (namespace: string, key: string, data: unknown, expectedVersion?: number) => request<{ version: number }>(
    `/api/v1/data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
    { method: 'PUT', body: JSON.stringify({ data, expectedVersion }) },
  ),
  deleteData: (namespace: string, key: string) => request<void>(`/api/v1/data/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  health: () => request<{ status: string; mode: string; integrity: string }>('/api/v1/health'),
  setSession(access: string, refresh: string) {
    accessToken = access;
    refreshToken = refresh;
  },
  clearSession() {
    accessToken = null;
    refreshToken = null;
  },
};
