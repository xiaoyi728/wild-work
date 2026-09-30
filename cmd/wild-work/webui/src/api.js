// 面板取数层。
// credentials 必须带 same-origin：R4 会话是 HttpOnly + SameSite=Lax cookie，
// 不带则 cookie 不发，/api/* 全 401。
//
// 401 + need_login 是 vanilla 版里 api() 直接调 showLogin() 的位置。React 下不能这么写
// ——取数层不该知道界面。改为注册回调，由 App 注入「弹登录层」的动作，
// 保持与现状一致的行为：会话失效时即时弹登录层，而不是等下一次探针。
let onUnauthorized = null;
export function setOnUnauthorized(fn) { onUnauthorized = fn; }

export async function api(path, body) {
  const opts = {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const resp = await fetch(path, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 && data.need_login && onUnauthorized) onUnauthorized();
    const err = new Error(data.error || `请求失败 ${resp.status}`);
    err.status = resp.status;
    err.needLogin = !!data.need_login;
    throw err;
  }
  return data;
}
