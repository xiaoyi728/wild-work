import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { CHANNEL_PRESETS, MASK_SENTINEL, RESERVED_CHANNEL_NAMES } from '../constants.js';
import { isLoopbackHost, isWildcardHost, parseTokens, formatTokenCount } from '../format.js';

// 现状：监听下拉只有三个语义位。空/`::` 等通配写法按「全部网卡」看待，
// 与后端 config.Listen 归一化口径保持一致。
function hostToSelect(listenHost) {
  if (listenHost === '127.0.0.1') return '127.0.0.1';
  if (isWildcardHost(listenHost)) return '0.0.0.0';
  return '__custom__';
}

// validateBackupProxy 校验备用上游通道地址，返回 [url, err]（空串合法 = 关闭）。
// 判据与后端 backuplink.Set 同源：仅 http/https/socks5，且必须有主机名（R57）。
function validateBackupProxy(raw) {
  const v = (raw || '').trim();
  if (!v) return ['', ''];
  let u;
  try { u = new URL(v); } catch { return [null, `备用代理地址无效：${v}`]; }
  if (!['http:', 'https:', 'socks5:'].includes(u.protocol)) {
    return [null, `备用代理协议不支持（仅 http/https/socks5）：${v}`];
  }
  if (!u.hostname) return [null, `备用代理缺少主机名：${v}`];
  return [v, ''];
}

// parseModelList 解析降级链的备胎输入：逗号/空格分隔多个 channel/model，本地形态校验。
// 与后端 SetModelFallback 的判据同源（全路径 + 不自环），错误就地提示、阻断保存。
function parseModelList(raw) {
  const out = [];
  for (const p of String(raw || '').split(/[,，\s]+/)) {
    const t = p.trim();
    if (!t) continue;
    if (!/^[^/]+\/.+/.test(t)) return [null, `备胎模型 ${t} 需为 channel/model 形式（如 workbuddyai/glm-5.2）`];
    out.push(t);
  }
  return [out, ''];
}

// parseMapText 校验编辑器内容，返回 [modelMap, 错误信息]。
// 语法错误就地提示并阻断保存。
function parseMapText(raw, channelList) {
  const map = {};
  const channels = new Set(channelList || []);
  for (const line0 of (raw || '').split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) return [null, `格式错误（缺少 =）：${line}`];
    const k = line.substring(0, idx).trim(), v = line.substring(idx + 1).trim();
    if (!k || !v) return [null, `格式错误（键或值为空）：${line}`];
    const vi = v.indexOf('/');
    if (vi <= 0 || !v.substring(vi + 1).trim()) return [null, `映射目标必须是「渠道/模型」形式：${v}`];
    const ch = v.substring(0, vi);
    if (channels.size && !channels.has(ch)) {
      return [null, `未知渠道「${ch}」；已知渠道：${[...channels].join(', ')}`];
    }
    if (map[k] !== undefined) return [null, `重复的键：${k}`];
    map[k] = v;
  }
  return [map, ''];
}

export default function Settings({ state, onClose, onSaved, onToast, onEnsureSession, setAuthSession, onLogout, onShowLogin, onSaveTimes }) {
  const cc = state.compat || {};
  const channels = cc.channels || [];
  const initEntries = Object.entries(cc.model_map || {});

  const [host, setHost] = useState(hostToSelect(state.listen_host));
  const [customHost, setCustomHost] = useState(hostToSelect(state.listen_host) === '__custom__' ? state.listen_host : '');
  const [port, setPort] = useState(state.listen_port);
  const [apiKey, setApiKey] = useState(state.api_key);
  const [adminPass, setAdminPass] = useState(''); // 后端不回显，留空 = 不改动
  const [selCh, setSelCh] = useState(cc.default_channel || (channels[0] || ''));
  const [maxTok, setMaxTok] = useState(cc.max_tokens_cap || 0);
  const [mapText, setMapText] = useState(initEntries.map(([k, v]) => `${k} = ${v}`).join('\n'));
  const [mapOpen, setMapOpen] = useState(false); // 随对话框打开而重置为当前值、收起
  const [mapErr, setMapErr] = useState('');
  const [backupProxy, setBackupProxy] = useState(state.backup_proxy || '');
  const [proxyErr, setProxyErr] = useState('');
  // 模型降级链编辑副本（打开弹层时深拷贝；「保存降级链」是独立按钮，保存即热生效）
  const [fbRules, setFbRules] = useState(() => JSON.parse(JSON.stringify(state.model_fallback || [])));
  // 设置内「查询模型」：复用费率页的查找弹层（降级链/思考强度都要填完整 model ID）。
  const [msOpen, setMsOpen] = useState(false);
  const [msFees, setMsFees] = useState(null);
  const [bodyLog, setBodyLog] = useState(!!state.body_log);
  const [fbFrom, setFbFrom] = useState('');
  const [fbTo, setFbTo] = useState('');
  const [fbErr, setFbErr] = useState('');
  const [oczenKey, setOczenKey] = useState(state.oczen_api_key || ''); // 回显脱敏值
  const oczenTouched = useRef(false);
  // 思考强度注入编辑副本（R63）：`*` 全局默认行单独存，其余为模型→档位映射。
  const [effGlobal, setEffGlobal] = useState(() => (state.reasoning_efforts || {})['*'] || '');
  const [effRules, setEffRules] = useState(() => Object.entries(state.reasoning_efforts || {})
    .filter(([k]) => k !== '*').map(([model, effort]) => ({ model, effort })));
  const [effModel, setEffModel] = useState('');
  const [effEffort, setEffEffort] = useState('');
  const [effErr, setEffErr] = useState('');
  // 自定义渠道编辑副本（R66）：结构与 config.custom_channels[] 同形。
  const [customCh, setCustomCh] = useState(() => JSON.parse(JSON.stringify(state.custom_channels || [])));
  const [newChName, setNewChName] = useState('');
  const [newChURL, setNewChURL] = useState('');
  const [newChKey, setNewChKey] = useState('');
  const [customErr, setCustomErr] = useState('');
  const [customOk, setCustomOk] = useState('');
  const [customTesting, setCustomTesting] = useState(false);
  // 每个渠道的「新增模型」输入草稿，按渠道下标存（下标即渲染顺序，增删后整表重渲染）。
  const [modelDraft, setModelDraft] = useState({});
  const [autostart, setAutostart] = useState(!!state.autostart);
  // 思考链防癫：后端缺省（旧 config.json 无 features 段）按开启显示，与 config.Default() 一致。
  const [loopGuard, setLoopGuard] = useState(state.loop_guard !== false);
  const [expiring, setExpiring] = useState(String(state.expiring_days || 1));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  // 桌宠开关只存本浏览器 localStorage，后端不参与，故初值在弹层挂载时现读一次。
  // 受控 + 订阅广播是两个入口不打架的前提：弹层里拨开关、或点桌宠浮层的「隐藏」，
  // 另一边都得跟着变。vanilla 是靠 app.js:774 那行嵌错位置（glm 轮询回调里）的赋值
  // 顺带掩盖了这个问题，移植时没照搬那行，于是暴露成勾选与实况不符。
  const [petOn, setPetOn] = useState(() => !!(window.Pet && window.Pet.isEnabled()));
  useEffect(() => {
    const onToggle = (e) => setPetOn(!!(e.detail && e.detail.on));
    window.addEventListener('ww-pet-toggle', onToggle);
    return () => window.removeEventListener('ww-pet-toggle', onToggle);
  }, []);

  // 选定的监听主机名（下拉 + 自定义输入合成）
  const selectedHost = host !== '__custom__' ? host : customHost.trim();
  // 按当前监听地址动态显示/隐藏黄色警告条与管理密码的必填星号。
  // 默认 127.0.0.1（本机）时两者均不显示——本机监听无需密码，提示只会干扰。
  const needPass = !isLoopbackHost(selectedHost);

  const mapSummary = initEntries.length === 0 ? '（空）'
    : initEntries.map(([k, v]) => `${k} → ${v}`).join('\u00A0 \u00A0');

  // 缺省建议：仅列出「已接入（有账号）」的渠道——未绑定的渠道点了也会因无账号而失败。
  const presets = useMemo(() => {
    const bound = new Set((state.accounts || []).map((a) => a.group));
    // TraeCode 与 TraeWork 共用账号，账号列表里只会出现 traework；
    // 但 TraeCode 是可独立路由的渠道，其预设也应可见。
    if (bound.has('traework')) bound.add('traecode');
    return channels.filter((c) => CHANNEL_PRESETS[c] && bound.has(c));
  }, [channels, state.accounts]);

  async function toggleAutostart(next) {
    setAutostart(next);
    try {
      await api('/api/config/autostart', { on: next });
      onToast('设置已保存');
    } catch (e) { onToast(e.message); onSaved(); }
  }

  // 「测试」按钮：用输入框当前的候选 key（含脱敏值/空）调后端实测。
  // 后端：候选 key 临时写入渠道 client → big-pickle 发最小对话 → 200/429 均算通过
  // （200 = 配额正常；429 = 连通但匿名共享配额限流，属预期现象）；测试后恢复配置原值。
  async function testOczenKey() {
    if (testing) return;
    setTesting(true);
    setProxyErr('');
    try {
      let k = oczenKey.trim();
      if (k.includes(MASK_SENTINEL)) k = ''; // 脱敏形态 = 未改动，用当前配置值测
      const r = await api('/api/config/oczen_test', { api_key: k });
      // 与真实对话同源（issue #117）：直连被地区拒时后端会自动改走备用通道，
      // via_backup 标出答复来自哪个出口——否则配了代理点测试仍看到 403 会误以为功能没生效。
      const via = r.via_backup ? '经备用通道' : '直连';
      if (r.ok) {
        onToast(r.status === 200 ? `✓ OpenCodeZen 凭证可用（200，${via}）` : `✓ 连通正常（429 匿名限流，属预期，${via}）`);
      } else {
        const brief = (r.body || r.error || '').slice(0, 90).replace(/\s+/g, ' ');
        const hint = (!r.via_backup && r.status === 403)
          ? '（未走备用通道；若已配代理仍为直连，说明本次不是地区拒绝或备用链路拨不动，详见日志）' : '';
        onToast(`✗ 测试失败 HTTP ${r.status}${hint}：${brief}`);
      }
    } catch (e) {
      onToast('✗ 测试失败：' + e.message);
    } finally {
      setTesting(false);
    }
  }

  // 收编降级链底部草稿：两框都有内容时作为一条规则追加；只填一侧视为未填完并阻断。
  // 「添加规则」「保存降级链」与弹层底部「保存」三处共用，否则填完直接点底部保存会静默丢规则。
  function collectFbDraft(base, requireDraft) {
    const from = fbFrom.trim();
    const to = fbTo.trim();
    if (!from && !to) {
      return requireDraft ? [null, '先在输入框填主模型与备胎，再点「添加规则」'] : [base, ''];
    }
    if (!from || !to) return [null, '主模型与备胎需同时填写（或清空两框）'];
    if (!/^[^/]+\/.+/.test(from)) return [null, `主模型 ${from} 需为 channel/model 形式`];
    if (base.some((r) => r.from === from)) return [null, `主模型 ${from} 已有规则（每个主模型只允许一条）`];
    const [tos, err] = parseModelList(to);
    if (err) return [null, err];
    const backups = tos.filter((t) => t !== from);
    if (!backups.length) return [null, '备胎不能与主模型相同'];
    return [base.concat([{ from, to: backups }]), ''];
  }

  // 「添加规则」：主模型须为 channel/model 全路径且全局唯一（与后端 SetModelFallback 同源校验）。
  function addFbRule() {
    const [rules, err] = collectFbDraft(fbRules, true);
    if (err) { setFbErr(err); return; }
    setFbRules(rules);
    setFbFrom(''); setFbTo(''); setFbErr('');
  }

  // 行内追加备胎：同一 API 同时服务「＋」按钮与输入框回车两条路径。
  function appendFbTo(i, raw) {
    const [tos, err] = parseModelList(raw);
    if (err) { setFbErr(err); return; }
    if (!tos.length) { setFbErr('先在输入框填备胎 ID 再点 ＋'); return; }
    setFbRules((rs) => rs.map((r, idx) => (idx === i
      ? { ...r, to: r.to.concat(tos.filter((t) => t !== r.from && !r.to.includes(t))) }
      : r)));
    setFbErr('');
  }

  // 「保存降级链」：独立端点，保存即热生效（无需重启），与设置弹层的其它项互不牵连。
  // 底部草稿一并收编——「添加规则」不是保存的前置步骤，用户填完直接保存也应生效。
  async function saveModelFallback() {
    const [rules, fbDraftErr] = collectFbDraft(fbRules, false);
    if (fbDraftErr) { setFbErr(fbDraftErr); return; }
    try {
      await api('/api/config/model_fallback', { rules });
      setFbRules(rules);
      setFbFrom(''); setFbTo('');
      setFbErr('');
      onToast('降级链已保存（热生效）');
      onSaved();
    } catch (e) { setFbErr(e.message); }
  }

  // 行内改主模型 ID（上游 eb0ccec9）：形态校验 + 主模型唯一性校验，失败回滚输入框；
  // 成功写回并滤掉与新值自环的备胎。输入框是非受控的（key=r.from，提交后随 key 重挂载），
  // 故校验失败必须手动把 el.value 拨回旧值，否则错误文本会留在框里。
  function editFbFrom(i, raw, el) {
    const next = String(raw || '').trim();
    const cur = fbRules[i].from;
    if (!next || next === cur) { if (el) el.value = cur; return; }
    if (!/^[^/]+\/.+/.test(next)) {
      setFbErr(`主模型 ${next} 需为 channel/model 形式（如 workbuddyai/deepseek-v4.1-flash）`);
      if (el) el.value = cur;
      return;
    }
    if (fbRules.some((r, k) => k !== i && r.from === next)) {
      setFbErr(`主模型 ${next} 已有规则（每个主模型只允许一条）`);
      if (el) el.value = cur;
      return;
    }
    setFbRules((rs) => rs.map((r, k) => (k === i
      ? { ...r, from: next, to: r.to.filter((t) => t !== next) } : r)));
    setFbErr('');
  }

  // ---------- 思考强度注入（R63） ----------
  // 「添加」：模型 ID 必填、非 `*`（`*` 是全局默认专用键）、档位必填、模型唯一。
  function addEffRule() {
    const model = effModel.trim();
    const effort = effEffort.trim();
    if (!model) { setEffErr('模型 ID 不能为空（全局默认请在上方「全局默认」行填）'); return; }
    if (model === '*') { setEffErr('* 是全局默认专用键，请在上方「全局默认」行填'); return; }
    if (!effort) { setEffErr('思考档位不能为空'); return; }
    if (effRules.some((r) => r.model === model)) { setEffErr(`模型 ${model} 已有档位（每个模型只允许一条）`); return; }
    setEffRules((rs) => rs.concat([{ model, effort }]));
    setEffModel(''); setEffEffort(''); setEffErr('');
  }

  // 「保存思考强度」：独立端点，保存即热生效。`*` 全局默认只在非空时写入
  // （空 = 不设全局默认，不是「设成空串」）。
  async function saveReasoningEfforts() {
    try {
      const efforts = {};
      const g = effGlobal.trim();
      if (g) efforts['*'] = g;
      for (const r of effRules) efforts[r.model] = r.effort;
      await api('/api/config/reasoning_efforts', { efforts });
      setEffErr('');
      onToast('思考强度已保存（热生效）');
      onSaved();
    } catch (e) { setEffErr(e.message); }
  }

  // ---------- 自定义渠道（R66） ----------
  // 新建渠道：标识非空、不与内建同名、URL 非空、标识唯一（后端同样会拒，这里是即时反馈）。
  function addCustomChannel() {
    const name = newChName.trim();
    const base = newChURL.trim();
    if (!name) { setCustomErr('请填渠道标识（如 stepfun）'); return; }
    if (RESERVED_CHANNEL_NAMES.has(name.toLowerCase())) {
      setCustomErr(`渠道标识 ${name} 与内建渠道同名，会与内建运行时冲突，请换一个`); return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) { setCustomErr('渠道标识只能用字母/数字/下划线/连字符'); return; }
    if (customCh.some((c) => c.name === name)) { setCustomErr(`渠道标识 ${name} 已存在`); return; }
    if (!/^https?:\/\//i.test(base)) { setCustomErr('Base URL 需以 http:// 或 https:// 开头'); return; }
    setCustomCh((cs) => cs.concat([{ name, base_url: base, api_key: newChKey.trim(), models: [], enabled: true }]));
    setNewChName(''); setNewChURL(''); setNewChKey(''); setCustomErr(''); setCustomOk('');
  }

  async function testCustomChannel(name, baseURL, key) {
    setCustomTesting(true); setCustomErr(''); setCustomOk('');
    try {
      // name + base_url + api_key 一起发：回显态可能是脱敏值，后端按 name 找回真实密钥，
      // 否则未改动过的渠道点测试会恒报 401（同 issue #117 的「探针没走同一条链路」）。
      const res = await api('/api/config/custom_channel_test', { name, base_url: baseURL, api_key: key });
      if (res.ok) {
        const models = res.models || [];
        onToast(`[${name}] 连接成功！拉取到 ${models.length} 个模型`);
        setCustomOk(`[${name}] 连接成功，模型: ${models.slice(0, 6).join(', ')}${models.length > 6 ? '…' : ''}`);
      } else {
        setCustomErr(`[${name}] 测试失败：${res.error}`);
      }
    } catch (e) {
      setCustomErr(`[${name}] 测试失败：${e.message}`);
    } finally { setCustomTesting(false); }
  }

  // 某个渠道的「新增模型」草稿。默认上下文 1M / 输出 64k / 三项能力全开
  // （与 vanilla 的输入框默认值一致）；工具能力缺省 = 支持（后端 supports_tools 缺省 true）。
  const modelDraftOf = (i) => modelDraft[i] || { id: '', ctx: '1M', out: '64k', eff: '', img: true, rsn: true, tools: true };
  function setModelDraftAt(i, patch) {
    setModelDraft((d) => ({ ...d, [i]: { ...(d[i] || { id: '', ctx: '1M', out: '64k', eff: '', img: true, rsn: true, tools: true }), ...patch } }));
  }

  // 追加模型：ID 必填且同渠道内唯一；容量走 parseTokens（k/M）；能力按勾选写入。
  // 只写非默认字段，避免把「未声明」编造成具体值（同 R49 的哲学）。
  function addModelAt(i) {
    const d = modelDraftOf(i);
    const id = (d.id || '').trim();
    if (!id) { setCustomErr('请填入模型 ID'); return; }
    const ch = customCh[i];
    if (!ch) return;
    if ((ch.models || []).some((m) => (typeof m === 'string' ? m : m.id) === id)) {
      setCustomErr(`模型 ${id} 在该渠道下已存在`); return;
    }
    const m = { id };
    const ctx = parseTokens(d.ctx, 0);
    const out = parseTokens(d.out, 0);
    if (ctx) m.context_window = ctx;
    if (out) m.max_tokens = out;
    if ((d.eff || '').trim()) m.reasoning_efforts = (d.eff || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (d.img) m.supports_images = true;
    if (d.rsn) m.supports_reasoning = true;
    if (!d.tools) m.supports_tools = false; // 缺省 = 支持，故只在显式关闭时落字段
    setCustomCh((cs) => cs.map((c, k) => (k === i ? { ...c, models: (c.models || []).concat([m]) } : c)));
    setModelDraft((dd) => ({ ...dd, [i]: { id: '', ctx: '1M', out: '64k', eff: '', img: true, rsn: true, tools: true } }));
    setCustomErr('');
  }

  async function openModelSearch() {
    setMsOpen(true);
    if (msFees) return;
    try { setMsFees(await api('/api/fees')); } catch (e) { onToast(e.message); }
  }

  async function toggleBodyLog(on) {
    setBodyLog(on);
    try {
      await api('/api/config/body_log', { on });
      onToast(on ? '请求体摘要记录已开启（写 data/ledger/body-trace-*.jsonl）' : '请求体摘要记录已关闭');
      onSaved();
    } catch (e) { setBodyLog(!on); onToast(e.message); }
  }

  async function saveCustomChannels() {
    try {
      // 自动收录「填了输入行但没点＋新增渠道」的那一条（否则会静默保存空列表）。
      let list = customCh;
      const name = newChName.trim();
      if (name && !customCh.some((c) => c.name === name)) {
        if (RESERVED_CHANNEL_NAMES.has(name.toLowerCase())) { setCustomErr('渠道标识与内建渠道同名，请换一个'); return; }
        if (!/^[A-Za-z0-9_-]+$/.test(name)) { setCustomErr('渠道标识只能用字母/数字/下划线/连字符'); return; }
        if (!/^https?:\/\//i.test(newChURL.trim())) { setCustomErr('Base URL 需以 http:// 或 https:// 开头'); return; }
        list = customCh.concat([{ name, base_url: newChURL.trim(), api_key: newChKey.trim(), models: [], enabled: true }]);
        setCustomCh(list);
        setNewChName(''); setNewChURL(''); setNewChKey('');
      }
      await api('/api/config/custom_channels', { channels: list });
      setCustomErr('');
      setCustomOk('渠道及模型配置已成功保存并立即生效');
      onToast('自定义渠道已保存（热生效）');
      onSaved();
    } catch (e) { setCustomErr(e.message); setCustomOk(''); }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      // 1) 监听地址 + 管理密码（同请求提交：后端先存密码再切监听）
      const h = host === '__custom__' ? (customHost.trim() || '127.0.0.1') : host;
      const listenBody = { host: h, port: parseInt(port, 10) };
      if (adminPass) listenBody.admin_password = adminPass; // 空 = 不改动，避免覆盖已设密码
      try {
        await api('/api/config/listen', listenBody);
      } catch (e) { onToast(e.message); return; }

      // 刚设置/修改密码：旧会话已被作废，立即用新密码重新登录，保证本次保存的后续步骤可用。
      // （从「本机监听 + 无密码」切到 0.0.0.0 时鉴权刚启用，此前根本没有 cookie。）
      if (adminPass) {
        try {
          const r = await api('/api/auth/login', { password: adminPass });
          setAuthSession(r.session || '');
        } catch (e) {
          onToast(e.message); onClose();
          onShowLogin('管理密码已变更，请重新登录');
          return;
        }
      }

      // 2) 备用上游通道（先本地校验，失败阻断保存）+ oczen key（仅在用户改动过时提交，
      //    避免把脱敏回显值误存回）
      const [proxy, perr] = validateBackupProxy(backupProxy);
      if (perr) { setProxyErr(perr); onToast(perr); return; }
      const body = { proxy };
      if (oczenTouched.current) {
        let k = oczenKey.trim();
        // 值仍是脱敏形态（含 …）则视为未修改，保持服务端现值
        if (k && k.includes(MASK_SENTINEL)) k = undefined;
        if (k !== undefined) body.oczen_api_key = k; // 不携带字段 = 不改动；空串 = 清除回匿名
      }
      try {
        await api('/api/config/proxy', body);
      } catch (e) { onToast(e.message); return; }

      // 3) 模型映射：优先读编辑器；编辑器从未展开过则用原值
      //    （保证「只改监听/渠道不碰映射」）
      let modelMap = (state.compat && state.compat.model_map) || {};
      if (mapOpen) {
        const [parsed, err] = parseMapText(mapText, channels);
        if (err) { setMapErr(err); onToast(err); return; }
        modelMap = parsed;
      }
      try {
        await api('/api/config/compat', {
          default_channel: selCh, max_tokens_cap: parseInt(maxTok, 10) || 0, model_map: modelMap,
        });
      } catch (e) { onToast(e.message); return; }

      // 4) 临期阈值（1/2/3 天，独立端点即时生效）
      const expDays = parseInt(expiring, 10) || 1;
      if (expDays !== (state.expiring_days || 1)) {
        try {
          await api('/api/config/expiring_days', { days: expDays });
        } catch (e) { onToast(e.message); return; }
      }

      // 4.5) 思考链防癫开关（独立端点，atomic 全局开关即时生效，无需重启）
      if (loopGuard !== (state.loop_guard !== false)) {
        try {
          await api('/api/config/loop_guard', { on: loopGuard });
        } catch (e) { onToast(e.message); return; }
      }

      // 4.6) 模型降级链：底部「保存」与区块内「保存降级链」同源提交。
      // 否则「添加规则 → 点底部保存」会关窗并丢掉规则（草稿也一并收编）。
      // 未变更则不发请求，避免每次改监听都重写一遍降级链。
      const [fbFinal, fbConfErr] = collectFbDraft(fbRules, false);
      if (fbConfErr) { setFbErr(fbConfErr); onToast(fbConfErr); return; }
      if (JSON.stringify(fbFinal) !== JSON.stringify(state.model_fallback || [])) {
        try {
          await api('/api/config/model_fallback', { rules: fbFinal });
          setFbRules(fbFinal);
          setFbFrom(''); setFbTo('');
          setFbErr('');
        } catch (e) { setFbErr(e.message); onToast(e.message); return; }
      }

      // 5) API-Key（最后保存：改 Key 可能影响当前会话的后续请求）
      try {
        await api('/api/config/api_key', { key: apiKey.trim() });
      } catch (e) { onToast(e.message); return; }

      // 6) 密码已在第 1 步生效（会话已换新），无需再强制重登
      onToast(adminPass ? '设置已保存，管理密码已生效' : '设置已保存');
      onClose();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  // 「清除」按钮：关闭面板鉴权（仅环回监听允许，后端会校验）。
  async function clearAdminPassword() {
    if (!window.confirm('确定清除管理密码？清除后面板将不再鉴权（仅允许监听 127.0.0.1）。')) return;
    try {
      await api('/api/config/admin_password', { password: '' });
    } catch (e) { onToast(e.message); return; }
    setAuthSession('');
    onToast('管理密码已清除，面板鉴权已关闭');
    onClose();
    onEnsureSession();
  }

  // 新增时段取「此刻」的时分，去重后升序保存（与现状一致）。
  function addTime() {
    const times = (state.checkin_times || []).slice();
    const now = new Date();
    const next = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!times.includes(next)) times.push(next);
    onSaveTimes(times.sort());
  }

  function insertPreset(ch) {
    const p = CHANNEL_PRESETS[ch];
    // 追加尚未存在的行，避免重复插入
    const cur = mapText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const have = new Set(cur.map((l) => l.split('=')[0].trim()));
    const add = p.items.filter((it) => !have.has(it.split('=')[0].trim()));
    if (!add.length) { onToast(`${p.label} 的建议映射已存在`); return; }
    setMapText(cur.concat(add).join('\n'));
  }

  return (
    <div className="overlay" id="settingsOverlay" onClick={(e) => { if (e.target.id === 'settingsOverlay') onClose(); }}>
      <div className="modal modal-wide">
        <div className="modal-title">设置</div>
        <div className="modal-body settings-body">

          <div className="cfg-section">
            <div className="cfg-heading">接口与鉴权</div>
            <div className="row">
              <label className="lbl wide">监听</label>
              <select id="selHost" className="select" value={host} onChange={(e) => setHost(e.target.value)}>
                <option value="127.0.0.1">127.0.0.1（本机）</option>
                <option value="0.0.0.0">0.0.0.0（全部）</option>
                <option value="__custom__">自定义…</option>
              </select>
              <span className="muted">:</span>
              <input id="inPort" className="input port" type="number" min="1" max="65535"
                     value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            {host === '__custom__' ? (
              <div id="customHostRow" className="row">
                <input id="inHost" className="input grow" placeholder="如 192.168.1.100" spellCheck="false"
                       value={customHost} onChange={(e) => setCustomHost(e.target.value)} />
              </div>
            ) : null}
            <div className="row">
              <label className="lbl wide">API-Key</label>
              <input id="keyInput" className="input grow" spellCheck="false" placeholder="留空 = 不鉴权"
                     value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') saveSettings(); }} />
            </div>
            <div className="row">
              <label className="lbl wide" title="面板登录口令（与给 AI 客户端用的 API-Key 是两套）">
                管理密码{needPass ? <span id="adminPassReq" className="req" title="监听非本机地址时必填">*</span> : null}
              </label>
              <input id="adminPassInput" className="input grow" type="password" spellCheck="false"
                     autoComplete="new-password"
                     placeholder={state.admin_pass_set
                       ? '已设置（留空 = 不改动；填入新值 = 修改）'
                       : (state.auth_required ? '必填：监听非 127.0.0.1 时面板必须鉴权' : '留空 = 面板不鉴权（仅本机监听时允许）')}
                     value={adminPass} onChange={(e) => setAdminPass(e.target.value)} />
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              <label className="lbl wide"></label>
              <button className="btn small" id="btnAdminLogout" onClick={onLogout}>退出登录</button>
              <button className="btn small" id="btnClearAdminPass" title="关闭面板鉴权（仅监听 127.0.0.1 时允许）" onClick={clearAdminPassword}>清除密码</button>
              <span className="hint" style={{ marginLeft: 8 }}>改密码后所有已登录会话立即失效</span>
            </div>
            {needPass ? (
              <div id="listenRiskTip" className="risk-tip">⚠️ 监听 0.0.0.0 时必须设置管理密码，否则局域网内任何设备都可访问本 API 与账号管理。</div>
            ) : null}
          </div>

          <div className="cfg-section">
            <div className="cfg-heading">模型路由（Claude Code / Codex 映射）</div>
            <div className="row">
              <label className="lbl wide">默认渠道</label>
              <select id="selCh" className="select" value={selCh} onChange={(e) => setSelCh(e.target.value)}>
                {channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="row">
              <label className="lbl wide">封顶 tokens</label>
              <input id="inMaxTok" className="input port" type="number" min="0" step="1000"
                     value={maxTok} onChange={(e) => setMaxTok(e.target.value)} />
              <span className="hint" style={{ marginLeft: 6 }}>0=不限制</span>
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              <label className="lbl wide">映射表</label>
              <span className="btn small" id="btnCompatMap" onClick={() => setMapOpen((v) => !v)}>编辑</span>
              <span className="hint" id="mapSummary" style={{ marginLeft: 6 }}>{mapSummary}</span>
            </div>
            {mapOpen ? (
              <div id="mapEditor" className="map-editor">
                <div className="hint" style={{ marginBottom: 4 }}>
                  一行一条，格式：<code>客户端模型名 = 渠道/模型名</code>；支持通配 <code>claude-* = workbuddy/glm-5.2</code>；以 # 开头为注释。
                </div>
                <textarea id="mapText" className="input map-text" spellCheck="false" rows={6}
                          value={mapText} onChange={(e) => { setMapText(e.target.value); setMapErr(''); }} />
                <div className="hint" style={{ marginTop: 5 }}>
                  缺省建议（点击插入）：<span id="mapPresets">
                    {presets.length ? presets.map((c) => (
                      <span key={c} className="btn tiny preset" title={CHANNEL_PRESETS[c].items.join('\n')}
                            onClick={() => insertPreset(c)}>{CHANNEL_PRESETS[c].label}</span>
                    )).reduce((acc, el, i) => i === 0 ? [el] : acc.concat([ <span key={'s' + i}> </span>, el]), [])
                      : <span className="hint">（尚未接入任何渠道，先在账号管理添加账号）</span>}
                  </span>
                </div>
                <div className="hint" id="mapErr" style={{ color: 'var(--danger)', marginTop: 4 }}>{mapErr}</div>
              </div>
            ) : null}
          </div>

          <div className="cfg-section">
            <div className="cfg-heading">自动签到与开机自启</div>
            <div className="row">
              <label className="lbl wide">签到时间</label>
              <div id="timesBox" className="times">
                {(state.checkin_times || []).map((t) => (
                  <span key={t} className="time-chip" title="点击删除"
                        onClick={() => onSaveTimes((state.checkin_times || []).filter((x) => x !== t))}>{t} ✕</span>
                ))}
              </div>
              <button className="icon-btn" id="btnAddTime" title="增加一个签到时间" onClick={addTime}>＋</button>
            </div>
            <div className="hint">保活 22:00 自动 · 下次 <span id="nextCheckin">{state.next_checkin || '-'}</span></div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide" title="到期日在此范围内的积分视为临期，调度器优先消耗，减少到期作废">临期阈值</label>
              <select id="selExpiring" className="input" style={{ width: 100 }}
                      value={expiring} onChange={(e) => setExpiring(e.target.value)}>
                <option value="1">1 天</option>
                <option value="2">2 天</option>
                <option value="3">3 天</option>
              </select>
              <span className="hint" style={{ marginLeft: 8 }}>该范围内到期的积分优先消耗</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide">开机自启</label>
              <label className="switch">
                <input type="checkbox" id="chkAutostart" checked={autostart}
                       onChange={(e) => toggleAutostart(e.target.checked)} />
                <span className="slider"></span>
              </label>
              <span className="hint" style={{ marginLeft: 8 }}>程序随系统启动自动运行</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide" title="流式生成中检测思考链复读/空转（发癫），命中即中断并返回错误，由下游 AI 客户端自行重试恢复">思考链防癫</label>
              <label className="switch">
                <input type="checkbox" id="chkLoopGuard" checked={loopGuard}
                       onChange={(e) => setLoopGuard(e.target.checked)} />
                <span className="slider"></span>
              </label>
              <span className="hint" style={{ marginLeft: 8 }}>检测模型思维链死循环，命中即中断；不罚账号</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide" title="把每次请求的上下文构成摘要写入 data/ledger/body-trace-*.jsonl（含消息前 200 字预览），用于定位上下文膨胀；默认关闭">请求体摘要</label>
              <label className="switch">
                <input type="checkbox" id="chkBodyLog" checked={bodyLog}
                       onChange={(e) => toggleBodyLog(e.target.checked)} />
                <span className="slider"></span>
              </label>
              <span className="hint" style={{ marginLeft: 8 }}>诊断用：记录上下文构成摘要（含预览），用完请关</span>
            </div>
          </div>

          <div className="cfg-section">
            <div className="cfg-heading">备用上游通道</div>
            <div className="hint" style={{ margin: '0 0 8px' }}>
              全局只配<b>一个</b>备用代理（http/https/socks5），留空 = 无备用通道。
              它<b>不影响本工具的任何常规请求</b>：所有渠道一律直连；只有上游回「地区限制」时，
              才在同一次请求内自动改走该通道重发一次（重发也失败则透传原始错误）。
              目前取用方：<b>Cline</b> 与 <b>OpenCodeZen</b>。
            </div>
            <div className="hint" style={{ margin: '0 0 8px' }}>OC Zen Key 留空 = 匿名凭证；填入 sk-… 自定义 key 可解锁独立配额与付费模型。</div>
            <div className="row proxy-row">
              <label className="lbl wide" title="备用上游代理地址（仅命中地区限制时自动取用）">备用代理</label>
              <input id="backupProxyInput" className="input grow proxy-input" spellCheck="false"
                     placeholder="如 socks5://127.0.0.1:1080 或 http://127.0.0.1:7890（留空 = 关闭）"
                     value={backupProxy}
                     onChange={(e) => { setBackupProxy(e.target.value); setProxyErr(''); }} />
              {/* 生效位：后端同时回 backup_proxy（配置）与 backup_proxy_active（进程内已装载）。
                  两者不等 = 配置写了但未生效（地址不合法/装载失败），必须让用户看见。 */}
              <span id="backupProxyState" className="hint"
                    style={{ color: state.backup_proxy && !state.backup_proxy_active ? 'var(--danger)' : undefined }}>
                {!state.backup_proxy ? '' : (state.backup_proxy_active ? '已生效' : '未生效（地址无效或装载失败）')}
              </span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide" title="OpenCodeZen 自定义 API key">OC Zen Key</label>
              <input id="oczenKeyInput" className="input grow" spellCheck="false"
                     placeholder="留空 = 匿名凭证 public（sk-… 可解锁独立配额/付费模型）"
                     value={oczenKey}
                     onChange={(e) => { setOczenKey(e.target.value); oczenTouched.current = true; }} />
              <button className="btn small" id="btnOczenTest" disabled={testing} onClick={testOczenKey}>
                {testing ? '测试中…' : '测试'}
              </button>
            </div>
            <div className="hint" id="proxyErr" style={{ color: 'var(--danger)' }}>{proxyErr}</div>
          </div>

          {/* 模型降级链：主模型在其渠道全池模型级冷却时按链顶备胎，不粘滞自动切回（R54） */}
          <div className="cfg-section">
            <div className="cfg-heading">模型降级链
              <button className="btn small" id="btnSearchModelFb" style={{ marginLeft: 8 }} onClick={openModelSearch}>🔍 查询模型</button>
            </div>
            <div className="hint" style={{ margin: '0 0 8px' }}>
              主模型在渠道全部账号上限流冷却（503 提示解冻时间）时，按顺序找第一个可用的备胎模型顶上，
              响应头 <span className="mono-inline">X-Model-Fallback</span> 标注实际备胎；原模型解冻后自动切回，不粘滞。
              模型 ID 用 <span className="mono-inline">channel/model</span> 全路径（如 workbuddyai/deepseek-v4.1-flash），备胎可跨渠道。
              填完两个输入框后点「添加规则」或任一保存按钮都会提交；右下角「保存」也会一并保存本区块。
            </div>
            <div id="fbList" className="proxy-list">
              {fbRules.length ? fbRules.map((r, i) => (
                <div key={r.from} className="row proxy-row fb-rule">
                  {/* 主模型改成行内可编辑输入框（上游 eb0ccec9）：左列上下两行=主模型 + 备胎添加框，
                      右侧 → 备胎 chips。主模型 ID 超长时在输入框内横向滚动，不再遮挡箭头与档位。 */}
                  <span className="fb-from-col">
                    <input className="input fb-from" spellCheck="false"
                           title="主模型 ID（channel/model，可编辑；失焦或回车确认，点「保存降级链」生效）"
                           defaultValue={r.from}
                           onBlur={(e) => editFbFrom(i, e.target.value, e.target)}
                           onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                    <input className="input fb-to-add" spellCheck="false"
                           placeholder="＋备胎 ID（回车添加）"
                           onKeyDown={(e) => { if (e.key === 'Enter') { appendFbTo(i, e.target.value); e.target.value = ''; } }} />
                  </span>
                  <span className="fb-arrow">→</span>
                  <span className="fb-tos">
                    {r.to.map((t, j) => (
                      <span key={t} className="fb-to" title={`${t}（可拖拽调整备胎顺序）`} draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(j))}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                              if (Number.isNaN(from) || from === j) return;
                              setFbRules((rs) => rs.map((x, idx) => {
                                if (idx !== i) return x;
                                const to = x.to.slice();
                                const [moved] = to.splice(from, 1);
                                to.splice(j, 0, moved);
                                return { ...x, to };
                              }));
                            }}>{t}
                        <a className="fb-x" title="移除该备胎"
                           onClick={() => setFbRules((rs) => rs.map((x, idx) => (idx === i ? { ...x, to: x.to.filter((_, k) => k !== j) } : x)))}>×</a>
                      </span>
                    ))}
                  </span>
                  <button className="icon-btn" title="删除整条规则"
                          onClick={() => setFbRules((rs) => rs.filter((_, idx) => idx !== i))}>🗑</button>
                </div>
              )) : <div className="hint">（暂无规则——原模型无可用账号时将直接返回 503 提示）</div>}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input id="fbFromInput" className="input" style={{ width: 230 }} spellCheck="false"
                     placeholder="主模型 ID（channel/model）"
                     value={fbFrom} onChange={(e) => { setFbFrom(e.target.value); setFbErr(''); }} />
              <input id="fbToInput" className="input grow" spellCheck="false"
                     placeholder="备胎模型 ID，可填多个用逗号分隔（按顺序尝试，可跨渠道）"
                     value={fbTo} onChange={(e) => { setFbTo(e.target.value); setFbErr(''); }}
                     onKeyDown={(e) => { if (e.key === 'Enter') addFbRule(); }} />
              <button className="btn small" id="btnFbAdd" title="添加一条降级规则" onClick={addFbRule}>添加规则</button>
              <button className="btn small primary" id="btnFbSave" onClick={saveModelFallback}>保存降级链</button>
            </div>
            <div className="hint" id="fbErr" style={{ color: 'var(--danger)' }}>{fbErr}</div>
          </div>

          {/* 思考强度注入（R63）：与 R49「只透传上游声明」互补——这条解决「客户端没说话时用哪档」 */}
          <div className="cfg-section">
            <div className="cfg-heading">思考强度
              <button className="btn small" id="btnSearchModelEff" style={{ marginLeft: 8 }} onClick={openModelSearch}>🔍 查询模型</button>
            </div>
            <div className="hint" style={{ margin: '0 0 8px' }}>
              客户端请求<b>未带</b> <span className="mono-inline">reasoning_effort</span> 时，按请求模型 ID 注入配置的思考档位；
              客户端显式传了的（任意值）一律不覆盖；精确未命中回退全局默认。哑管道不校验档位取值
              （支持什么档位由渠道模型自己决定）；<b>TraeWork 渠道协议无 reasoning 注入点，注入无害但无效</b>。
              模型 ID 用 <span className="mono-inline">channel/model</span> 全路径（如 workbuddyai/deepseek-v4.1-flash），
              <span className="mono-inline">*</span> 为全局默认。
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="lbl wide" title="全局默认档位：精确未命中时回退注入">全局默认</label>
              <input id="effGlobalInput" className="input grow" spellCheck="false" list="effortDatalist"
                     placeholder="留空 = 无全局默认（如 medium）"
                     value={effGlobal} onChange={(e) => { setEffGlobal(e.target.value); setEffErr(''); }} />
            </div>
            <div id="effList" className="proxy-list">
              {effRules.length ? effRules.map((r, i) => (
                <div key={r.model} className="row proxy-row">
                  <span className="lbl wide eff-model" title={r.model}>{r.model}</span>
                  <span className="fb-arrow">→</span>
                  <span className="eff-value">{r.effort}</span>
                  <button className="icon-btn" title="删除该映射"
                          onClick={() => setEffRules((rs) => rs.filter((_, k) => k !== i))}>🗑</button>
                </div>
              )) : <div className="hint">（暂无模型档位——未配置的请求不注入）</div>}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input id="effModelInput" className="input" style={{ width: 230 }} spellCheck="false"
                     placeholder="模型 ID（channel/model）"
                     value={effModel} onChange={(e) => { setEffModel(e.target.value); setEffErr(''); }} />
              <input id="effEffortInput" className="input grow" spellCheck="false" list="effortDatalist"
                     placeholder="思考档位（可自由输入，建议 none/low/medium/high/max）"
                     value={effEffort} onChange={(e) => { setEffEffort(e.target.value); setEffErr(''); }}
                     onKeyDown={(e) => { if (e.key === 'Enter') addEffRule(); }} />
              <button className="btn small" id="btnEffAdd" title="添加一条模型档位映射" onClick={addEffRule}>添加</button>
              <button className="btn small primary" id="btnEffSave" onClick={saveReasoningEfforts}>保存思考强度</button>
            </div>
            <datalist id="effortDatalist">
              <option value="none"></option>
              <option value="low"></option>
              <option value="medium"></option>
              <option value="high"></option>
              <option value="max"></option>
            </datalist>
            <div className="hint" id="effErr" style={{ color: 'var(--danger)' }}>{effErr}</div>
          </div>

          {/* 自定义渠道（R66）：面板配置的 OpenAI 兼容渠道，模型面不做任何本地假设，全按用户填写 */}
          <div className="cfg-section">
            <div className="cfg-heading">自定义渠道（OpenAI 兼容）</div>
            <div className="hint" style={{ margin: '0 0 8px' }}>
              先配置渠道标识、地址与 API 密钥，再在各渠道下配置模型 ID、上下文大小、思考等级与多模态能力。
              客户端用 <code>渠道标识/模型名</code> 访问，用量与统计全线统一。
              渠道标识不得与内建渠道同名（如 workbuddy / cline / oczen / raccoon 等）。
            </div>
            <div id="customChList" className="custom-channels-list">
              {customCh.length ? customCh.map((c, i) => {
                const isOff = c.enabled === false;
                const keyMask = c.api_key
                  ? (c.api_key.length > 8 ? c.api_key.slice(0, 3) + MASK_SENTINEL + c.api_key.slice(-4) : '••••••')
                  : '无密钥';
                const models = c.models || [];
                const d = modelDraftOf(i);
                return (
                  <div key={c.name} className="custom-ch-card">
                    <div className="custom-ch-header">
                      <span className="badge custom">{c.name}</span>
                      <span className="custom-ch-url">{c.base_url}</span>
                      {/* 只显示脱敏形态，**不放 title 明文**：面板本就只应拿到脱敏值
                          （/api/state 已脱敏），万一拿到明文也不该再往 DOM 里写一份。 */}
                      <span className="hint">[{keyMask}]</span>
                      <span className={`tag ${isOff ? 'neutral' : 'ok'}`}>{isOff ? '已禁用' : '已启用'}</span>
                      <span className="custom-ch-actions">
                        <button className="btn small" disabled={customTesting}
                                data-test-custom={i}
                                onClick={() => testCustomChannel(c.name, c.base_url, c.api_key)}>测试连通</button>
                        <button className="btn small" data-toggle-custom={i}
                                onClick={() => setCustomCh((cs) => cs.map((x, k) => (k === i ? { ...x, enabled: x.enabled === false } : x)))}>
                          {isOff ? '启用' : '停用'}
                        </button>
                        <button className="icon-btn" title="删除该渠道"
                                onClick={() => setCustomCh((cs) => cs.filter((_, k) => k !== i))}>🗑</button>
                      </span>
                    </div>
                    <div className="custom-models-box">
                      {models.length ? (
                        <table className="custom-models-table">
                          <colgroup>
                            <col style={{ width: 'auto' }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 75 }} />
                            <col style={{ width: 130 }} />
                            <col style={{ width: 130 }} />
                            <col style={{ width: 36 }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>模型 ID</th><th>上下文</th><th>最大输出</th><th>思考等级</th><th>能力</th>
                              <th style={{ textAlign: 'center' }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map((m, j) => {
                              const obj = typeof m === 'object' && m !== null;
                              const mid = obj ? m.id : m;
                              const ctx = obj && m.context_window ? formatTokenCount(parseTokens(m.context_window, 0)) : '—';
                              const out = obj && m.max_tokens ? formatTokenCount(parseTokens(m.max_tokens, 0)) : '—';
                              const efforts = obj && Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : [];
                              const defEff = (obj && m.default_reasoning_effort) || efforts[0] || '';
                              const hasRsn = obj && (m.supports_reasoning || efforts.length > 0);
                              const caps = [];
                              if (obj && m.supports_images) caps.push(<span key="i" className="tag">识图</span>);
                              if (hasRsn) caps.push(<span key="r" className="tag">思考</span>);
                              // 工具能力缺省 = 支持（与后端 SupportsTools 缺省 true 同源）
                              if (!obj || m.supports_tools !== false) caps.push(<span key="t" className="tag">工具</span>);
                              return (
                                <tr key={mid}>
                                  <td><code>{mid}</code></td>
                                  <td>{ctx}</td>
                                  <td>{out}</td>
                                  <td>{hasRsn
                                    ? <><span className="tag ok" title={`默认: ${defEff}`}>{defEff || '开启'}</span>{efforts.length ? <span className="hint"> [{efforts.join(', ')}]</span> : null}</>
                                    : <span className="hint">—</span>}</td>
                                  <td>{caps.length ? caps : <span className="hint">—</span>}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    <a className="fb-x" title="移除此模型"
                                       onClick={() => setCustomCh((cs) => cs.map((x, k) => (k === i
                                         ? { ...x, models: (x.models || []).filter((_, n) => n !== j) } : x)))}>×</a>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : <div className="hint" style={{ margin: '4px 0 8px' }}>（该渠道尚未配置模型，请在下方添加模型及参数）</div>}
                      {/* 单行紧凑布局：模型表格固定列宽对齐，任一输入框回车即可添加（PR #121） */}
                      <div className="custom-model-add-row">
                        <input className="input custom-m-id" placeholder="模型 ID" spellCheck="false"
                               value={d.id} onChange={(e) => setModelDraftAt(i, { id: e.target.value })}
                               onKeyDown={(e) => { if (e.key === 'Enter') addModelAt(i); }} />
                        <input className="input custom-m-num" placeholder="上下文(如 1M)" spellCheck="false"
                               value={d.ctx} onChange={(e) => setModelDraftAt(i, { ctx: e.target.value })}
                               onKeyDown={(e) => { if (e.key === 'Enter') addModelAt(i); }} />
                        <input className="input custom-m-num" placeholder="输出(如 64k)" spellCheck="false"
                               value={d.out} onChange={(e) => setModelDraftAt(i, { out: e.target.value })}
                               onKeyDown={(e) => { if (e.key === 'Enter') addModelAt(i); }} />
                        <input className="input custom-m-eff" placeholder="思考档位" spellCheck="false"
                               value={d.eff} onChange={(e) => setModelDraftAt(i, { eff: e.target.value })}
                               onKeyDown={(e) => { if (e.key === 'Enter') addModelAt(i); }} />
                        <label className="hint custom-m-cap"><input type="checkbox" checked={d.img}
                               onChange={(e) => setModelDraftAt(i, { img: e.target.checked })} />识图</label>
                        <label className="hint custom-m-cap"><input type="checkbox" checked={d.rsn}
                               onChange={(e) => setModelDraftAt(i, { rsn: e.target.checked })} />思考</label>
                        <label className="hint custom-m-cap"><input type="checkbox" checked={d.tools}
                               onChange={(e) => setModelDraftAt(i, { tools: e.target.checked })} />工具</label>
                        <button className="btn small" data-add-model={i} title="添加模型"
                                onClick={() => addModelAt(i)}>➕</button>
                      </div>
                    </div>
                  </div>
                );
              }) : <div className="hint">（暂无自定义渠道，请先在下方输入渠道标识、地址与 API 密钥添加渠道）</div>}
            </div>
            <div className="row custom-ch-add-row">
              <input id="inCustomName" className="input custom-ch-name" placeholder="渠道标识(如stepfun)" spellCheck="false"
                     value={newChName} onChange={(e) => { setNewChName(e.target.value); setCustomErr(''); }} />
              <input id="inCustomURL" className="input grow" placeholder="Base URL (如 https://api.stepfun.com/step_plan/v1)" spellCheck="false"
                     value={newChURL} onChange={(e) => { setNewChURL(e.target.value); setCustomErr(''); }} />
              <input id="inCustomKey" className="input custom-ch-key" type="password" placeholder="API Key (可选)" spellCheck="false"
                     autoComplete="new-password"
                     value={newChKey} onChange={(e) => { setNewChKey(e.target.value); setCustomErr(''); }} />
              <button className="btn small" id="btnCustomTest" disabled={customTesting || !newChURL.trim()}
                      title="用当前输入的地址与密钥探测该上游的 /models"
                      onClick={() => testCustomChannel(newChName.trim() || '(未命名)', newChURL.trim(), newChKey.trim())}>测试连通</button>
              <button className="btn small" id="btnCustomAdd" onClick={addCustomChannel}>＋ 新增渠道</button>
              <button className="btn small primary" id="btnCustomSave" onClick={saveCustomChannels}>保存全部配置</button>
            </div>
            <div className="hint" id="customChErr" style={{ color: 'var(--danger)', marginTop: 4 }}>{customErr}</div>
            <div className="hint" id="customChOk" style={{ color: 'var(--ok)', marginTop: 4 }}>{customOk}</div>
          </div>

          {/* 桌宠：纯观感层，开关只记在本浏览器（localStorage），不写 config.json、不影响 daemon */}
          <div className="cfg-section">
            <div className="cfg-heading">桌宠</div>
            <div className="row" style={{ alignItems: 'center' }}>
              <label className="lbl wide">显示桌宠</label>
              <label className="switch">
                <input type="checkbox" id="chkPet" checked={petOn}
                       onChange={(e) => { setPetOn(e.target.checked); if (window.Pet) window.Pet.setEnabled(e.target.checked); }} />
                <span className="slider"></span>
              </label>
              <span className="hint" style={{ marginLeft: 8 }}>右下角的小仓鼠，随请求派发与账号状态变化；关闭后不再轮询</span>
            </div>
          </div>

        </div>
        <div className="modal-actions">
          <button className="btn small" id="btnSettingsCancel" onClick={onClose}>取消</button>
          <button className="btn small primary" id="btnSettingsSave" disabled={busy} onClick={saveSettings}>保存</button>
        </div>
      </div>
      {msOpen ? <ModelSearch fees={msFees} onClose={() => setMsOpen(false)}
          onCopy={async (id) => { try { await navigator.clipboard.writeText(id); onToast(`已复制 ${id}`); } catch { onToast('复制失败，请手动选择'); } }} /> : null}
    </div>
  );
}
