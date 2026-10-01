// 渲染层闸门：把组件在 Node 里真渲染成 HTML，数「可见控件」。
//
// 为什么需要它：TestDOMIdParity 静态扫 JSX 里的 id="..." 字面量，只能证明
// 「这个 id 被写出来了」，证明不了「它此刻真渲染在 DOM 上」。L6.2 第 2 条缺陷
// （未登录时可见控件 20 → 8：主 tab、渠道费率、刷新积分、7 个添加按钮整块没渲染）
// 它就是没抓住的。SSR 渲染的是真实分支判定，控件没渲染出来这里就数不到。
//
// 判据口径与浏览器里手工数的那次一致：interactive 元素 + 不在 .hidden 子树内。
// React 用 {cond ? <X/> : null} 卸载、用 class="... hidden" 折叠未选中的 tab-body，
// 前者不产出 HTML、后者等价于 display:none，两种都该排除在「可见」之外。
//
// 用法：node cmd/wild-work/webui/tools/render-check.mjs
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// anim.js 在模块作用域就读 window（IntersectionObserver 特性探测），Settings 读 window.Pet，
// useTheme 读 localStorage。SSR 里没有这些，给最小桩：只需活到模块求值和首次渲染，
// 因为 useEffect 在 renderToStaticMarkup 下根本不执行。
const noop = () => {};
const win = {
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
  Pet: undefined, location: { reload: noop, href: 'http://127.0.0.1/' },
};
globalThis.window = win;
// zrender 的 env 探测在模块求值时就 document.createElement('canvas')（因为我桩了 window，
// 它认定自己在浏览器里）。给它一个够用的假 canvas，只为让 import 过去。
globalThis.document = {
  documentElement: { dataset: {}, style: {}, classList: { add: noop, remove: noop, toggle: noop } },
  addEventListener: noop, removeEventListener: noop,
  createElement: () => ({ getContext: () => null, style: {}, setAttribute: noop, appendChild: noop }),
  createElementNS: () => ({ getContext: () => null, style: {}, setAttribute: noop }),
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

// CreditValue 用 useLayoutEffect 做数字滚动，SSR 必然警告「does nothing on the server」——
// 与本闸门要证的事无关，静音；其余 console.error 一律照打。
const realError = console.error;
console.error = (...a) => {
  if (String(a[0] || '').includes('useLayoutEffect does nothing on the server')) return;
  realError(...a);
};

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const CONTROL = /^(button|input|select|textarea)$/;

// 数一遍 HTML 里的可见控件：button/input/select/textarea，外加面板卡上的
// 图标操作（span.icon-op / span.icon-link —— 它们就是卡片的签到/刷新/停用/删除按钮）
// 与顶栏两格「点击复制」（code.info-value —— #apiAddr / #apiKeyDisplay 带 onClick）。
// 三类合起来在浏览器里实测得 20，与上一轮手工计数的口径对齐。
function visibleControls(html) {
  const stack = [];
  const found = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const [, closing, name, attrs, selfClose] = m;
    const lower = name.toLowerCase();
    if (closing) { stack.pop(); continue; }
    const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
    const hidden = /(^|\s)hidden(\s|$)/.test(cls);
    const isCtl = CONTROL.test(lower) || /\bicon-(op|link)\b/.test(cls) || /\binfo-value\b/.test(cls);
    if (isCtl && !stack.includes(true)) {
      const id = (attrs.match(/\bid="([^"]*)"/) || [])[1];
      found.push(id || `${lower}.${cls.split(/\s+/)[0] || ''}`);
    }
    if (!VOID.has(lower) && !selfClose) stack.push(stack.includes(true) || hidden);
  }
  return found;
}

const ids = (controls) => controls.filter((c) => !c.includes('.'));

// ---- fixtures：覆盖卡片的所有渲染分支（正常/停用/签到失败/匿名无积分/不支持签到）
const ACCOUNTS = [
  { uid: 'u-normal', group: 'workbuddy', nickname: '小明', credits: 1200, unusable_credits: 300, credits_na: false, cooling: false, until: '', reason: '', disabled: false, err_count: 0, last_checkin_at: '2026-10-01T09:00:00Z', last_checkin_ok: true, last_used_at: '2026-10-01T09:00:00Z' },
  { uid: 'u-disabled', group: 'traework', nickname: '停用的', credits: 10, unusable_credits: 0, credits_na: false, cooling: false, until: '', reason: '手动停用', disabled: true, err_count: 0, last_checkin_at: '', last_checkin_ok: false, last_used_at: '' },
  { uid: 'u-fail', group: 'qodercn', nickname: '签到失败', credits: 5, unusable_credits: 0, credits_na: false, cooling: true, until: '10:00', reason: '限流', disabled: false, err_count: 3, last_checkin_at: '2026-10-01T09:00:00Z', last_checkin_ok: false, last_used_at: '' },
  { uid: 'u-na', group: 'glm', nickname: '清言', credits: 0, unusable_credits: 0, credits_na: true, cooling: false, until: '', reason: '', disabled: false, err_count: 0, last_checkin_at: '', last_checkin_ok: false, last_used_at: '' },
  { uid: 'u-nochk', group: 'workbuddyai', nickname: '国际版', credits: 77, unusable_credits: 0, credits_na: false, cooling: false, until: '', reason: '', disabled: false, err_count: 0, last_checkin_at: '', last_checkin_ok: false, last_used_at: '' },
  { uid: 'oczen-anonymous', group: 'oczen', nickname: '匿名', credits: 0, unusable_credits: 0, credits_na: true, cooling: false, until: '', reason: '', disabled: false, err_count: 0, last_checkin_at: '', last_checkin_ok: false, last_used_at: '' },
];
const STATE = {
  version: '2.5.4', api_base: 'http://127.0.0.1:7863', api_key: 'k', admin_enabled: false,
  auth_required: false, auth_session: true, listen_host: '127.0.0.1', listen_port: 7863,
  autostart: false, checkin_times: ['09:00'], next_checkin: '', expiring_days: 1,
  oczen_api_key: '', channels: ['workbuddy', 'traework'], accounts: ACCOUNTS,
  compat: { default_channel: 'workbuddy', max_tokens_cap: 32000, model_map: {} },
  fees: { updated_at: '', channels: [] },
};
const stubActions = new Proxy({}, { get: () => (() => {}) });
const busy = { refreshAll: false, checkinAll: false, refreshFees: false };

const PANEL_ACTIONS = ['btnRefreshAll', 'btnCheckinAll', 'btnAddWB', 'btnAddQoderCN', 'btnAddTrae',
  'btnAddWBAI', 'btnAddQoderCOM', 'btnAddQwen', 'btnAddGLM'];

const server = await createServer({
  configFile: false, root: ROOT, logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null },
});

const load = (p) => server.ssrLoadModule(p);
const results = [];
function check(name, html, expect) {
  const ctl = visibleControls(html);
  const got = ids(ctl);
  const missing = expect.filter((e) => !got.includes(e));
  results.push({ name, visible: ctl.length, missing });
  if (missing.length) console.error(`✗ ${name}：应渲染却没渲染的控件 → ${missing.join(', ')}`);
  else console.log(`✓ ${name}：可见控件 ${ctl.length} 个，期望的 ${expect.length} 个都在场`);
}

try {
  const App = (await load('/src/App.jsx')).default;
  const Accounts = (await load('/src/components/Accounts.jsx')).default;
  const Settings = (await load('/src/components/Settings.jsx')).default;
  const Fees = (await load('/src/components/Fees.jsx')).default;

  // 1) 未登录外壳 —— L6.2 第 2 条缺陷的现场：这一支曾经只剩 8 个控件
  const loggedOut = renderToStaticMarkup(React.createElement(App));
  check('App 未登录外壳', loggedOut,
    ['apiAddr', 'apiKeyDisplay', 'btnSettings', 'btnTheme', 'btnHelp', 'btnAbout',
      'mtabBtnAccounts', 'mtabBtnUsage', 'btnToggleFees', 'adminLoginPass', 'btnAdminLogin', ...PANEL_ACTIONS]);

  // 2) 操作区单独渲染（state=null 与 state=fixture 两支都必须把 9 个按钮摆出来）
  check('Accounts 未登录', renderToStaticMarkup(
    React.createElement(Accounts, { state: null, actions: { ...stubActions, busy }, knownUids: new Set() })), PANEL_ACTIONS);
  check('Accounts 有数据', renderToStaticMarkup(
    React.createElement(Accounts, { state: STATE, actions: { ...stubActions, busy }, knownUids: new Set(['u-normal']) })), PANEL_ACTIONS);

  // 3) 设置弹层：chkPet 必须在场（L6.3 第 8 条那个受控改动没把控件弄丢）
  check('Settings 弹层', renderToStaticMarkup(
    React.createElement(Settings, {
      state: STATE, onClose: noop, onSaved: noop, onToast: noop, onEnsureSession: async () => true,
      setAuthSession: noop, onLogout: noop, onShowLogin: noop, onSaveTimes: async () => {},
    })), ['chkPet', 'btnSettingsSave', 'btnSettingsCancel', 'adminPassInput', 'keyInput', 'selHost', 'btnAddTime']);

  // 4) 渠道费率弹层
  check('Fees 弹层', renderToStaticMarkup(
    React.createElement(Fees, { fees: STATE.fees, refreshBusy: false, onRefresh: noop, onClose: noop })),
    ['btnRefreshFees', 'btnFeesClose']);
} finally {
  await server.close();
}

const bad = results.filter((r) => r.missing.length);
if (bad.length) {
  console.error(`\n渲染层闸门失败：${bad.length}/${results.length} 个场景缺控件`);
  process.exit(1);
}
console.log(`\n渲染层闸门通过：${results.length} 个场景，可见控件 ${results.map((r) => r.visible).join(' / ')}`);
