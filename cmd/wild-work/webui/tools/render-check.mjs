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
  autostart: false, checkin_times: ['09:00'], next_checkin: '',
  oczen_api_key: '', channels: ['workbuddy', 'traework'], accounts: ACCOUNTS,
  compat: { default_channel: 'workbuddy', max_tokens_cap: 32000, model_map: {} },
  // 思考强度注入（R63）与自定义渠道（R66）的编辑副本源数据。
  // 自定义渠道那条专治三种「编造」：① 容量 k/M 单位必须可解析（1M→1M、64k→64k）；
  // ② supports_tools 缺省 = 支持（未声明不得画成"无工具"）；③ supports_tools:false 要如实标出。
  reasoning_efforts: { '*': 'medium', 'workbuddyai/deepseek-v4.1-flash': 'high' },
  custom_channels: [{
    name: 'stepfun', base_url: 'https://api.stepfun.com/step_plan/v1', api_key: 'sk-test-1234567890', enabled: true,
    models: [
      { id: 'step-3', context_window: 1000000, max_tokens: 64000, supports_images: true, supports_reasoning: true, reasoning_efforts: ['low', 'high'] },
      { id: 'step-2-mini', context_window: 32000, max_tokens: 8000, supports_tools: false },
    ],
  }],
  fees: {
    updated_at: '', channels: [
      // 每条都带 `id`（= Go 侧 provider.PublicModelID 的产物，完整 ID 的唯一真源）。
      // Cline 那条专治两种错： ①「名里含 / 即视为已带前缀」（会把 cline-free/x 当成完整 ID）；
      // ② 旧的双层约定（R59 起对外直通上游命名空间，不再拼 cline/）。
      { channel: 'qodercn', models: [{ model: 'qwen3.8-flash', id: 'qodercn/qwen3.8-flash', priced: true, rate: 0.3, free: false, has_context: true, context_window: 180000 }] },
      { channel: 'cline', models: [{ model: 'cline-free/grok-4', id: 'cline-free/grok-4', priced: false, rate: 0, free: true, has_context: false }] },
      // 上游目录声明了思考档位 + 上下文来自本工具实测：两条各治一个「冒充」——
      // 档位不得给未声明的渠道编出来，实测值不得画成上游官方声明（R46/issue #40、R49）。
      { channel: 'workbuddy', models: [{ model: 'deepseek-v4', id: 'workbuddy/deepseek-v4', priced: true, rate: 0.2, free: false, has_context: true, context_window: 1000000, reasoning_efforts: ['low', 'high', 'max'], default_reasoning_effort: 'high' }] },
      { channel: 'raccoon', models: [{ model: 'sn-sensenova-6-8-flash', id: 'raccoon/sn-sensenova-6-8-flash', priced: false, rate: 0, free: true, has_context: true, context_window: 524288, hand_measured: true }] },
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

  // 2b) 自定义渠道（R66 收尾）：无积分概念 ⇒ 不显示签到/刷新积分入口，
  //     但停用/删除仍须在场；普通渠道的签到/刷新入口不得被误伤。
  //     判据按卡片切块，否则「找到一个刷新按钮」会掩盖自定义卡片上的同一个按钮。
  const customState = {
    ...STATE,
    accounts: [
      { uid: 'custom-stepfun', group: 'stepfun', nickname: 'stepfun (自定义)', credits: 0, unusable_credits: 0,
        credits_na: true, cooling: false, until: '', reason: '', disabled: false, err_count: 0,
        last_checkin_at: '', last_checkin_ok: false, last_used_at: '' },
      ACCOUNTS[0],
    ],
  };
  // R103：无积分概念卡片默认收起；本场景要检查卡片内部入口，故临时让 localStorage 报告「已展开」。
  globalThis.localStorage = { getItem: () => '1', setItem: () => {}, removeItem: () => {} };
  const customHtml = renderToStaticMarkup(
    React.createElement(Accounts, { state: customState, actions: { ...stubActions, busy }, knownUids: new Set() }));
  delete globalThis.localStorage;
  const cardOf = (uid) => (customHtml.split('<div class="acct-card').slice(1).find((c) => c.includes(uid)) || '');
  const customCard = cardOf('custom-stepfun');
  const normalCard = cardOf('u-normal');
  const v2b = [];
  if (!customCard) v2b.push('自定义渠道卡片没渲染');
  if (/title="刷新积分"/.test(customCard)) v2b.push('自定义渠道仍显示「刷新积分」入口（后端恒报不适用）');
  if (/title="签到"/.test(customCard)) v2b.push('自定义渠道仍显示「签到」入口（后端 noExplicitCheckin 恒拒绝）');
  if (!/不支持手动签到/.test(customCard)) v2b.push('自定义渠道应显示「不支持手动签到」状态');
  if (!/title="停用"/.test(customCard)) v2b.push('自定义渠道的停用入口被误删（应保留）');
  if (!/title="删除账号"/.test(customCard)) v2b.push('自定义渠道的删除入口被误删（应保留）');
  if (/acct-name editable/.test(customCard)) v2b.push('自定义渠道无凭证文件，显示名不得标成可改名');
  if (!/title="刷新积分"/.test(normalCard)) v2b.push('普通渠道的刷新积分入口被误伤');
  if (!/title="签到"/.test(normalCard)) v2b.push('普通渠道的签到入口被误伤');
  results.push({ name: '自定义渠道无积分入口', visible: visibleControls(customHtml).length, missing: v2b });
  if (v2b.length) console.error(`✗ 自定义渠道无积分入口：${v2b.join('；')}`);
  else console.log('✓ 自定义渠道隐藏签到/刷新积分、保留停用/删除，普通渠道入口未受影响');

  // 2c) 仅「无积分概念」账号（全新安装只有 oczen 匿名）：
  //     汇总条里没有任何计分行，但「不适用 N 号 · 展开」必须仍可达——
  //     否则 acctAllNAHidden 指向的按钮根本不存在，匿名账号卡片永远打不开
  //     （2026-10-21 沙箱实测：rows 为空时整个 cs-bar 不渲染，提示文案悬空）。
  globalThis.localStorage = { getItem: () => '0', setItem: () => {}, removeItem: () => {} };
  const naOnlyHtml = renderToStaticMarkup(
    React.createElement(Accounts, {
      state: { ...STATE, accounts: ACCOUNTS.filter((a) => a.credits_na) },
      actions: { ...stubActions, busy }, knownUids: new Set(),
    }));
  delete globalThis.localStorage;
  const v2c = [];
  if (!/id="btnToggleNA"/.test(naOnlyHtml)) v2c.push('仅无积分账号时「不适用 N 号 · 展开」按钮缺失（提示文案指向不存在的按钮）');
  if (!/id="acctAllNAHidden"/.test(naOnlyHtml)) v2c.push('仅无积分账号时应显示「已收起」说明');
  if (/id="acct-card/.test(naOnlyHtml)) v2c.push('默认收起状态下不应直接渲染卡片');
  results.push({ name: '仅不适用账号可展开', visible: visibleControls(naOnlyHtml).length, missing: v2c });
  if (v2c.length) console.error(`✗ 仅不适用账号可展开：${v2c.join('；')}`);
  else console.log('✓ 仅无积分概念账号时展开开关仍可达（汇总条不渲染也不丢入口）');

  // 3) 设置弹层：chkPet 必须在场（L6.3 第 8 条那个受控改动没把控件弄丢）
  check('Settings 弹层', renderToStaticMarkup(
    React.createElement(Settings, {
      state: STATE, onClose: noop, onSaved: noop, onToast: noop, onEnsureSession: async () => true,
      setAuthSession: noop, onLogout: noop, onShowLogin: noop, onSaveTimes: async () => {},
    })), ['chkPet', 'chkLoopGuard', 'btnSettingsSave', 'btnSettingsCancel', 'adminPassInput', 'keyInput', 'selHost', 'btnAddTime',
      // v2.7.3 新增：思考强度（R63）与自定义渠道（R66）两区的**交互控件**必须真渲染出来。
      // （effList / customChList 是容器 div，不属可交互控件，故不列在这里；它们由场景 8 断言。）
      'effGlobalInput', 'effModelInput', 'effEffortInput', 'btnEffAdd', 'btnEffSave',
      'inCustomName', 'inCustomURL', 'inCustomKey', 'btnCustomAdd', 'btnCustomSave', 'btnCustomTest',
      'fbFromInput', 'fbToInput', 'btnFbAdd', 'btnFbSave']);

  // 4) 渠道费率弹层
  const feesHtml = renderToStaticMarkup(
    React.createElement(Fees, { fees: STATE.fees, refreshBusy: false, onRefresh: noop, onClose: noop }));
  check('Fees 弹层', feesHtml, ['btnRefreshFees', 'btnFeesClose', 'btnModelSearch']);

  // 5) 复制给客户端的「完整模型 ID」的唯一真源是费率行的 `id`（Go 侧 provider.PublicModelID）。
  //    R59 起 Cline 直通上游命名空间：对外就是 cline-free/grok-4，不再拼成 cline/cline-free/...；
  //    runtimeForModel 用 SplitN(model,"/",2) 切第一个斜杠，故普通渠道仍是 <渠道>/<模型>。
  //    两个方向都要测：用 id（新契约）与缺 id 的回落（旧产物必须仍能得到可路由的写法）。
  const { collectAllModels } = await load('/src/components/Fees.jsx');
  const flat = collectAllModels(STATE.fees);
  const idProblems = [];
  for (const x of flat) {
    const want = x.m.id || `${x.ch}/${x.m.model}`;
    if (x.full !== want) idProblems.push(`${x.ch}/${x.m.model} → 复制目标算成了 ${x.full}（应 ${want}）`);
  }
  if (!/data-mid="cline-free\/grok-4"/.test(feesHtml)) idProblems.push('Cline 的复制目标应为上游命名空间 cline-free/grok-4（R59）');
  if (/data-mid="cline\/cline-free\/grok-4"/.test(feesHtml)) idProblems.push('Cline 不应再复制出双层路径 cline/cline-free/...（R59 起直通上游命名空间）');
  results.push({ name: '完整模型 ID 前缀', visible: visibleControls(feesHtml).length, missing: idProblems });
  if (idProblems.length) console.error(`✗ 完整模型 ID 前缀：${idProblems.join('；')}`);
  else console.log(`✓ 完整模型 ID：${flat.length} 条全部等于费率行 id（Cline 直通 cline-free/*，R59；缺 id 才回落补前缀）`);

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

  // 7) 思考档位与实测来源（R49 / R46）+ 完整 ID 三路径（R59/R52）。
  say(modelIds('cline', 'cline-free/grok-4', 'cline-free/grok-4').full === 'cline-free/grok-4',
    `id 在场时须直通（R59：上游命名空间不再套 cline/），实际 ${modelIds('cline', 'cline-free/grok-4', 'cline-free/grok-4').full}`);
  say(modelIds('cline', 'cline-free/grok-4').full === 'cline/cline-free/grok-4',
    `缺 id 的回落路径仍须补前缀（否则 runtimeForModel 会把渠道解析成 cline-free），实际 ${modelIds('cline', 'cline-free/grok-4').full}`);
  say(modelIds('workbuddy', 'workbuddy/deepseek-v4', 'workbuddy/deepseek-v4').full === 'workbuddy/deepseek-v4',
    `已带渠道前缀的名字不得重复拼接，实际 ${modelIds('workbuddy', 'workbuddy/deepseek-v4', 'workbuddy/deepseek-v4').full}`);
  say(/\[low·high·max\]/.test(feesHtml), '上游声明的档位没渲染出 [low·high·max]');
  say(count(/class="effort-tag"/) === 1, `effort-tag 应只在「上游声明了档位」的那一行出现，实际 ${count(/class="effort-tag"/)} 次`);
  say(count(/class="ctx-tag hand"/) === 1, `hand_measured 的上下文应带 hand 类，实际 ${count(/class="ctx-tag hand"/)} 次`);
  results.push({ name: '缓存三态 + 档位/实测来源标注', visible: visibleControls(feesHtml).length, missing: v7 });
  if (v7.length) console.error(`✗ 缓存三态 + 档位/实测来源标注：${v7.join('；')}`);
  else console.log('✓ 缓存三态（0% 与「—」分流）、档位只在声明时出现、实测值带来源标、双层 ID 前缀护栏均通过');

  // 8) v2.7.3：思考强度（R63）与自定义渠道（R66）的渲染层判据。
  //    两者都是取数驱动的编辑区，SSR 不跑 useEffect，故判据落在「用 fixture 直接渲染」上。
  const settingsHtml = renderToStaticMarkup(
    React.createElement(Settings, {
      state: STATE, onClose: noop, onSaved: noop, onToast: noop, onEnsureSession: async () => true,
      setAuthSession: noop, onLogout: noop, onShowLogin: noop, onSaveTimes: async () => {},
    }));
  const v8 = [];
  const has = (needle) => settingsHtml.includes(needle);
  // 两个编辑区的容器必须真渲染出来（它们是取数驱动的分支，不在场景 3 的控件口径内）
  has('id="effList"') || v8.push('#effList 容器没渲染（模型档位映射区整块缺失）');
  has('id="customChList"') || v8.push('#customChList 容器没渲染（自定义渠道区整块缺失）');
  // 思考强度：`*` 单独回显到「全局默认」行，其余是模型→档位的映射行
  has('value="medium"') || v8.push('全局默认档位没回显到 effGlobalInput（`*` 必须单独走全局默认行）');
  has('workbuddyai/deepseek-v4.1-flash') || v8.push('模型档位映射行没渲染（应显示 workbuddyai/deepseek-v4.1-flash）');
  has('data-test-custom="0"') || v8.push('自定义渠道的「测试连通」按钮没渲染');
  // 自定义渠道卡片：标识 / 地址 / 脱敏密钥（不得明文回显完整 key）
  has('stepfun') || v8.push('自定义渠道标识没渲染');
  has('https://api.stepfun.com/step_plan/v1') || v8.push('自定义渠道 Base URL 没渲染');
  !has('sk-test-1234567890') || v8.push('自定义渠道的 api_key 明文进了面板 HTML（必须脱敏回显）');
  has('sk-…7890') || v8.push('脱敏密钥形态应为 sk-…7890（保留首 3 末 4 供识别「未改动」）');
  // 容量 k/M 单位：1M→"1M"、64k→"64k"（不是 1000000 / 64000）
  has('>1M<') || v8.push('上下文 1000000 应格式化为 1M');
  has('>64k<') || v8.push('最大输出 64000 应格式化为 64k');
  // 能力三态：supports_tools 缺省 = 支持（step-3 有「工具」），显式 false 如实不标（step-2-mini）
  has('<span class="tag">工具</span>') || v8.push('supports_tools 缺省应画成「工具」能力（缺省 = 支持）');
  const toolsTags = (settingsHtml.match(/<span class="tag">工具<\/span>/g) || []).length;
  toolsTags === 1 || v8.push(`supports_tools:false 的模型不得标「工具」；期望恰 1 条带工具标，实际 ${toolsTags} 条`);
  has('[low, high]') || v8.push('模型声明的思考档位列表没渲染');
  results.push({ name: '思考强度 + 自定义渠道', visible: visibleControls(settingsHtml).length, missing: v8 });
  if (v8.length) console.error(`✗ 思考强度 + 自定义渠道：${v8.join('；')}`);
  else console.log('✓ 思考强度全局默认/映射行、自定义渠道卡片（脱敏 key、k/M 单位、工具能力缺省、档位列表）均通过');
} finally {
  await server.close();
}

const bad = results.filter((r) => r.missing.length);
if (bad.length) {
  console.error(`\n渲染层闸门失败：${bad.length}/${results.length} 个场景缺控件`);
  process.exit(1);
}
console.log(`\n渲染层闸门通过：${results.length} 个场景，可见控件 ${results.map((r) => r.visible).join(' / ')}`);
