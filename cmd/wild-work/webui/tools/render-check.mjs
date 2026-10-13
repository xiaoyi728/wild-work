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
  fees: {
    updated_at: '', channels: [
      // 两条都要：一条常规裸名，一条模型名本身含斜杠（Cline 的 cline-free/*）。
      // 后者专治「含斜杠就当作已带渠道前缀」这个判据 —— 见 Fees.jsx 的 modelIds 注释。
      { channel: 'qodercn', models: [{ model: 'qwen3.8-flash', priced: true, rate: 0.3, free: false, has_context: true, context_window: 180000 }] },
      { channel: 'cline', models: [{ model: 'cline-free/grok-4', priced: false, rate: 0, free: true, has_context: false }] },
      // 上游目录声明了思考档位 + 上下文来自本工具实测：两条各治一个「冒充」——
      // 档位不得给未声明的渠道编出来，实测值不得画成上游官方声明（R46/issue #40、R49）。
      { channel: 'workbuddy', models: [{ model: 'deepseek-v4', priced: true, rate: 0.2, free: false, has_context: true, context_window: 1000000, reasoning_efforts: ['low', 'high', 'max'], default_reasoning_effort: 'high' }] },
      { channel: 'raccoon', models: [{ model: 'sn-sensenova-6-8-flash', priced: false, rate: 0, free: true, has_context: true, context_window: 524288, hand_measured: true }] },
    ],
  },
};
const stubActions = new Proxy({}, { get: () => (() => {}) });
const busy = { refreshAll: false, checkinAll: false, refreshFees: false };

const PANEL_ACTIONS = ['btnRefreshAll', 'btnCheckinAll', 'btnAddWB', 'btnAddQoderCN', 'btnAddTrae',
  'btnAddWBAI', 'btnAddQoderCOM', 'btnAddQwen', 'btnAddGLM', 'btnAddCline'];

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
    })), ['chkPet', 'chkLoopGuard', 'btnSettingsSave', 'btnSettingsCancel', 'adminPassInput', 'keyInput', 'selHost', 'btnAddTime']);

  // 4) 渠道费率弹层
  const feesHtml = renderToStaticMarkup(
    React.createElement(Fees, { fees: STATE.fees, refreshBusy: false, onRefresh: noop, onClose: noop }));
  check('Fees 弹层', feesHtml, ['btnRefreshFees', 'btnFeesClose', 'btnModelSearch']);

  // 5) 复制给客户端的「完整模型 ID」必须始终带渠道前缀。
  //    internal/server/handler.go:runtimeForModel 用 SplitN(model,"/",2) 只切**第一个**斜杠，
  //    于是 Cline 的 cline-free/grok-4 必须写成 cline/cline-free/grok-4 才路由得到。
  //    上游 330ee79 用「模型名含 / 即视为已带前缀」的判据，对这一族会复制出
  //    provider "cline-free" is not configured —— 不报错，只是粘过去调不通。
  const { collectAllModels } = await load('/src/components/Fees.jsx');
  const flat = collectAllModels(STATE.fees);
  const idProblems = [];
  // 不变量：完整 ID 恒为「渠道/模型」，与模型名里有没有斜杠无关。
  for (const x of flat) {
    if (x.full !== `${x.ch}/${x.m.model}`) idProblems.push(`${x.ch}/${x.m.model} → 复制目标算成了 ${x.full}`);
  }
  if (/data-mid="cline-free\/grok-4"/.test(feesHtml)) idProblems.push('费率单元格 data-mid 缺渠道前缀');
  results.push({ name: '完整模型 ID 前缀', visible: visibleControls(feesHtml).length, missing: idProblems });
  if (idProblems.length) console.error(`✗ 完整模型 ID 前缀：${idProblems.join('；')}`);
  else console.log(`✓ 完整模型 ID 前缀：${flat.length} 条全部形如「渠道/模型」（含斜杠名亦不例外）`);

  // 6) 缓存利用率三态（上游 v2.7.0 的缓存列）。判据做在纯函数 cacheRate 上而不是端到端：
  //    Usage/Stats 两张表都是取数驱动的分支，SSR 不跑 useEffect，渲不出行来。
  //    「命中 0」与「上游不提供」必须画成两样——后者若画 0%，用户会去优化一个
  //    上游根本不回报的指标（internal/server/cacheusage.go 的 reported 标志就是为它设的）。
  const { cacheRate } = await load('/src/components/CacheCell.jsx');
  const { modelIds } = await load('/src/components/Fees.jsx');
  const v7 = [];
  const say = (cond, msg) => { if (!cond) v7.push(msg); };
  const count = (re) => (feesHtml.match(new RegExp(re.source, 'g')) || []).length;
  say(cacheRate({ cr_cov: 0, cr: 0, cr_reqs: 0 }) === null, 'cr_cov=0 应判「不提供」(null)');
  say(cacheRate({}) === null, '字段整体缺失（旧流水）应判「不提供」');
  say(cacheRate(null) === null, '行缺失不应抛，应判「不提供」');
  const cZero = cacheRate({ cr_cov: 1000, cr: 0, cr_reqs: 3 });
  say(cZero && cZero.shown === '0.00%', `有样本且真未命中应显示 0.00%，实际 ${cZero && cZero.shown}`);
  const cHit = cacheRate({ cr_cov: 1283, cr: 1218, cr_reqs: 9 });
  say(cHit && cHit.shown === '94.9%', `1218/1283 应显示 94.9%，实际 ${cHit && cHit.shown}`);

  // 7) 思考档位与实测来源（R49 / R46）：声明了才渲染，未声明的一律不出现。
  say(modelIds('cline', 'cline-free/grok-4').full === 'cline/cline-free/grok-4',
    `自带命名空间的上游 ID 必须补成双层路径，实际 ${modelIds('cline', 'cline-free/grok-4').full}`);
  say(modelIds('workbuddy', 'workbuddy/deepseek-v4').full === 'workbuddy/deepseek-v4',
    `已带渠道前缀的名字不得重复拼接，实际 ${modelIds('workbuddy', 'workbuddy/deepseek-v4').full}`);
  say(/\[low·high·max\]/.test(feesHtml), '上游声明的档位没渲染出 [low·high·max]');
  say(count(/class="effort-tag"/) === 1, `effort-tag 应只在「上游声明了档位」的那一行出现，实际 ${count(/class="effort-tag"/)} 次`);
  say(count(/class="ctx-tag hand"/) === 1, `hand_measured 的上下文应带 hand 类，实际 ${count(/class="ctx-tag hand"/)} 次`);
  results.push({ name: '缓存三态 + 档位/实测来源标注', visible: visibleControls(feesHtml).length, missing: v7 });
  if (v7.length) console.error(`✗ 缓存三态 + 档位/实测来源标注：${v7.join('；')}`);
  else console.log('✓ 缓存三态（0% 与「—」分流）、档位只在声明时出现、实测值带来源标、双层 ID 前缀护栏均通过');
} finally {
  await server.close();
}

const bad = results.filter((r) => r.missing.length);
if (bad.length) {
  console.error(`\n渲染层闸门失败：${bad.length}/${results.length} 个场景缺控件`);
  process.exit(1);
}
console.log(`\n渲染层闸门通过：${results.length} 个场景，可见控件 ${results.map((r) => r.visible).join(' / ')}`);
