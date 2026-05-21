const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export async function api(path, options = {}) {
  const response = await fetch(`${basePath}${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  }
  return data;
}
