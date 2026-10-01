import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { PROXY_CHANNELS, PROXY_HINT, CHANNEL_PRESETS, MASK_SENTINEL } from '../constants.js';
import { isLoopbackHost, isWildcardHost } from '../format.js';

// 现状：监听下拉只有三个语义位。空/`::` 等通配写法按「全部网卡」看待，
// 与后端 config.Listen 归一化口径保持一致。
function hostToSelect(listenHost) {
  if (listenHost === '127.0.0.1') return '127.0.0.1';
  if (isWildcardHost(listenHost)) return '0.0.0.0';
  return '__custom__';
}

// validateProxies 收集代理输入并做本地形态校验，返回 {proxies, err}。
function validateProxies(inputs) {
  const proxies = {};
  for (const [ch, raw] of Object.entries(inputs)) {
    const v = (raw || '').trim();
    if (!v) continue;
    let u;
    try { u = new URL(v); } catch { return [null, `渠道 ${ch} 代理地址无效：${v}`]; }
    if (!['http:', 'https:', 'socks5:'].includes(u.protocol)) {
      return [null, `渠道 ${ch} 代理协议不支持（仅 http/https/socks5）：${v}`];
    }
    if (!u.hostname) return [null, `渠道 ${ch} 代理缺少主机名：${v}`];
    proxies[ch] = v;
  }
  return [proxies, ''];
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
  const [proxies, setProxies] = useState(() => {
    const p = state.proxies || {};
    return Object.fromEntries(PROXY_CHANNELS.map((ch) => [ch, p[ch] || '']));
  });
  const [proxyErr, setProxyErr] = useState('');
  const [oczenKey, setOczenKey] = useState(state.oczen_api_key || ''); // 回显脱敏值
  const oczenTouched = useRef(false);
  const [autostart, setAutostart] = useState(!!state.autostart);
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
      if (r.ok) {
        onToast(r.status === 200 ? '✓ OpenCodeZen 凭证可用（200）' : '✓ 连通正常（429 匿名限流，属预期）');
      } else {
        const brief = (r.body || r.error || '').slice(0, 90).replace(/\s+/g, ' ');
        onToast(`✗ 测试失败 HTTP ${r.status}：${brief}`);
      }
    } catch (e) {
      onToast('✗ 测试失败：' + e.message);
    } finally {
      setTesting(false);
    }
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

      // 2) 代理（先本地校验，失败阻断保存）+ oczen key（仅在用户改动过时提交，
      //    避免把脱敏回显值误存回）
      const [px, perr] = validateProxies(proxies);
      if (perr) { setProxyErr(perr); onToast(perr); return; }
      const body = { proxies: px };
      if (oczenTouched.current) {
        let k = oczenKey.trim();
        // 值仍是脱敏形态（含 …）则视为未修改，保持服务端现值
        if (k && k.includes(MASK_SENTINEL)) k = undefined;
        if (k !== undefined) body.oczen_api_key = k; // 不携带字段 = 不改动；空串 = 清除回匿名
      }
      try {
        await api('/api/config/proxies', body);
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
          </div>

          <div className="cfg-section">
            <div className="cfg-heading">渠道上游代理</div>
            <div className="hint" style={{ margin: '0 0 8px' }}>给指定渠道的上游请求单独配置代理（http/https/socks5），留空 = 直连。典型用途：OpenCodeZen 的区域限制模型需要经代理访问。</div>
            <div className="hint" style={{ margin: '0 0 8px' }}>OC Zen Key 留空 = 匿名凭证；填入 sk-… 自定义 key 可解锁独立配额与付费模型。</div>
            <div id="proxyList" className="proxy-list">
              {PROXY_CHANNELS.map((ch) => (
                <div key={ch} className="row proxy-row">
                  <label className="lbl wide" title={PROXY_HINT[ch] || ch}>{PROXY_HINT[ch] || ch}</label>
                  <input className="input grow proxy-input" data-ch={ch}
                         spellCheck="false" placeholder="如 socks5://127.0.0.1:1080（留空直连）"
                         value={proxies[ch] || ''}
                         onChange={(e) => setProxies((p) => ({ ...p, [ch]: e.target.value }))} />
                </div>
              ))}
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
    </div>
  );
}
