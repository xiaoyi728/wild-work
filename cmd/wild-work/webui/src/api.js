// 面板取数层。
// credentials 必须带 same-origin：R4 会话是 HttpOnly + SameSite=Lax cookie，
// 不带则 cookie 不发，/api/* 全 401。
export async function api(path, body) {
  const opts = {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const resp = await fetch(path, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.needLogin = !!data.need_login;
    throw err;
  }
  return data;
}
