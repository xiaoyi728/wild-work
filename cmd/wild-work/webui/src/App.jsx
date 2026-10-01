import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setOnUnauthorized } from './api.js';
import { shortUid, isWildcardHost } from './format.js';
import { noExplicitCheckin } from './constants.js';
import { reveal, magnetic } from './anim.js';
import Accounts from './components/Accounts.jsx';
import Usage from './components/Usage.jsx';
import Fees from './components/Fees.jsx';
import Settings from './components/Settings.jsx';
import LoginFlow from './components/LoginFlow.jsx';
import { AdminLogin, Confirm, Rename, Toast, Help, About } from './components/Misc.jsx';

// Paper 主题：选择记忆在 localStorage，不触碰任何业务逻辑。
// 按钮文字「纸」/「原」即当前动作（点下去会变成什么），不是当前状态。
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('ww-theme') || 'auto'; } catch (e) { return 'auto'; }
  });
  useEffect(() => {
    if (theme === 'paper') document.documentElement.dataset.theme = 'paper';
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'paper' ? 'auto' : 'paper';
    try { localStorage.setItem('ww-theme', next); } catch (e) {}
    setTheme(next);
    // 图表取色来自 CSS 变量，需用量面板重画（首屏无监听者，故只在手动切换时派发）
    window.dispatchEvent(new Event('ww-theme-change'));
  };
  return [theme, toggle];
}

// 复制到剪贴板；navigator.clipboard 在非安全上下文不可用，降级 execCommand。
async function copyText(text, label, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}已复制到剪贴板`);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(`${label}已复制到剪贴板`);
    } catch (err) {
      toast('复制失败，请手动复制');
    }
    document.body.removeChild(ta);
  }
}

// 顶栏外壳。登录态与非登录态共用同一份实现 —— 主题按钮（纸/原）在两种状态下都必须存在。
// 无 state 时各字段留空但仍渲染出结构，与 vanilla「静态 DOM 先在场、数据后填」的表现一致。
function NavShell({ state, theme, toggleTheme, onSettings, onHelp, onAbout, onCopy, disabled }) {
  const wildcard = state ? isWildcardHost(state.listen_host) : false;
  const host = state ? (wildcard ? (state.lan_ip || '127.0.0.1')
    : (state.listen_host === 'localhost' ? '127.0.0.1' : state.listen_host)) : '';
  const apiURL = state ? `http://${host}:${state.listen_port}/v1` : '';
  const keyText = state ? (state.api_key === '' ? '（无鉴权）' : state.api_key) : '';
  return (
    <nav className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <img className="logo" src={import.meta.env.BASE_URL + "logo64.png"} alt="logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="brand-text">
            <div className="title">wild-work <span className="ver" id="ver">{state ? `v${state.version}` : ''}</span></div>
            <div className="sub" id="serverLine">{state ? (state.running ? '服务运行中' : '服务未启动') : ''}</div>
          </div>
        </div>
        <div className="top-info">
          <div className="info-cell">
            <span className="info-label">OpenAI接口</span>
            <code className="info-value" id="apiAddr"
                  title={state ? (wildcard ? '监听 0.0.0.0（所有网卡），局域网可用；点击复制' : '点击复制地址；进入设置修改') : ''}
                  onClick={() => { if (state && !disabled) onCopy(apiURL, 'OpenAI 接口地址'); }}>
              <span className="val">{apiURL}</span>
            </code>
          </div>
          <div className="info-cell">
            <span className="info-label">API-Key</span>
            <code className="info-value" id="apiKeyDisplay" title="点击复制密钥；进入设置修改"
                  onClick={() => {
                    if (!state || disabled) return;
                    if (keyText === '（无鉴权）') { onCopy(null, 'API-Key'); return; }
                    onCopy(keyText, 'API-Key');
                  }}>
              <span className="val">{keyText}</span>
            </code>
          </div>
        </div>
        <div className="top-icons">
          <span className="icon-link gear" id="btnSettings" title="设置" onClick={() => { if (!disabled) onSettings(); }}>⚙</span>
          <span className="icon-link" id="btnTheme"
                title={theme === 'paper' ? '恢复默认主题' : '切换 Paper（象牙纸感）主题'}
                onClick={toggleTheme}>{theme === 'paper' ? '原' : '纸'}</span>
          <span className="icon-link" id="btnHelp" title="帮助" onClick={() => { if (!disabled) onHelp(); }}>?</span>
          <span className="icon-link" id="btnAbout" title="关于" onClick={() => { if (!disabled) onAbout(); }}>i</span>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const [state, setState] = useState(null);
  const [fees, setFees] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMsg, setLoginMsg] = useState('');
  const [authSession, setAuthSession] = useState('');
  const [toastText, setToastText] = useState('');
  const [confirmBox, setConfirmBox] = useState(null);
  const [renameBox, setRenameBox] = useState(null);
  const [showFees, setShowFees] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [mainTab, setMainTab] = useState('accounts');
  const [usageDays, setUsageDays] = useState(7);
  const [usageNonce, setUsageNonce] = useState(0);
  const [sinceText, setSinceText] = useState('');
  const [busy, setBusy] = useState({ refreshAll: false, checkinAll: false, refreshFees: false });
  const [flow, setFlow] = useState({ confirm: null, pending: null, glm: null });

  const [theme, toggleTheme] = useTheme();
  const knownUids = useRef(new Set());
  const hadData = useRef(false);
  const toastTimer = useRef(null);
  const sectionRef = useRef(null);
  const actionsRef = useRef(null);

  const toast = useCallback((msg) => {
    setToastText(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 3000);
  }, []);

  // 已渲染过面板数据时不再只盖一层遮罩，而是整页重载：彻底清掉 DOM/内存里的账号与密钥
  // （登出或会话失效后残留展示不安全）。首次加载（state 为 null）不重载，避免死循环。
  const showLogin = useCallback((msg) => {
    const prev = hadData.current;
    hadData.current = false;
    setState(null);
    if (prev) { location.reload(); return; }
    setLoginMsg(msg || '');
    setLoginOpen(true);
  }, []);

  useEffect(() => { setOnUnauthorized(() => showLogin()); }, [showLogin]);

  const loadState = useCallback(async () => {
    const s = await api('/api/state');
    // 账号数据已变（刷新/签到/增删），明细缓存随之失效，避免 tooltip 展示旧余额。
    setState(s);
    hadData.current = true;
    if (window.Pet) window.Pet.sync(s.accounts); // 桌宠：观感层，判空即可，不参与业务
    return s;
  }, []);

  const loadFees = useCallback(async () => {
    try { setFees(await api('/api/fees')); } catch (e) { /* 费率接口失败不阻塞 */ }
  }, []);

  async function refreshFees() {
    setBusy((b) => ({ ...b, refreshFees: true }));
    try {
      await api('/api/fees/refresh', {});
      setFees(await api('/api/fees'));
      toast('模型列表和费率已刷新');
    } catch (e) { toast(e.message); } finally {
      setBusy((b) => ({ ...b, refreshFees: false }));
    }
  }

  // 初始化：会话探针（不返回 401）——未登录状态下只拉这接口，避免控制台报错
  useEffect(() => {
    (async () => {
      try {
        const st = await api('/api/auth/state');
        if (st.auth_enabled && !st.auth_session) { showLogin(); return; }
        setAuthSession(st.auth_session || '');
      } catch (e) { /* 探针失败走下面的常规加载（如代理拦截） */ }
      loadState();
      loadFees();
    })();
  }, []);

  // 动效初始化（仅视觉层，不新增交互）
  useEffect(() => {
    if (!state || !sectionRef.current) return;
    reveal(sectionRef.current);
    sectionRef.current.querySelectorAll('.panel-actions .btn, .panel-actions-wrap .btn').forEach(magnetic);
  }, [state ? state.version : null]);

  async function ensureSession(msg) {
    try {
      const st = await api('/api/auth/state');
      if (st.auth_enabled && !st.auth_session) { showLogin(msg); return; }
      setAuthSession(st.auth_session || '');
    } catch (e) { showLogin(msg); return; }
    await loadState();
  }

  async function submitLogin(pass) {
    try {
      const r = await api('/api/auth/login', { password: pass });
      setAuthSession(r.session || '');
      setLoginOpen(false);
      setLoginMsg('');
      await loadState();
      await loadFees();
    } catch (e) {
      setLoginMsg(e.message);
    }
  }

  async function logout(msg) {
    try { await api('/api/auth/logout', {}); } catch (e) { /* 会话已失效也继续收敛到登录层 */ }
    setAuthSession('');
    showLogin(msg || '已退出登录');
  }

  // ---------- 账号操作 ----------
  async function checkin(uid) {
    try {
      const r = await api('/api/account/checkin', { uid });
      // 未达成且可重试（活动尚未创建/上游瞬时故障）：说明会在签到窗口内自动重试，
      // 避免用户看到「无可用签到活动」误以为失败。
      if (!r.ok && r.retryable) toast(`暂未领到：${r.msg}（10:00–12:00 窗口内会自动重试）`);
      else toast(r.ok ? `签到成功：${r.msg}（剩余 ${r.remain}）` : `签到：${r.msg}`);
      loadState();
    } catch (e) { toast(e.message); }
  }

  async function refreshOne(uid) {
    try {
      const r = await api('/api/account/refresh', { uid });
      toast(`刷新成功：剩余积分 ${r.remain}`);
      loadState();
    } catch (e) { toast(e.message); }
  }

  function toggleDisable(uid, currentlyDisabled) {
    const action = currentlyDisabled ? '启用' : '停用';
    askConfirm(`确定${action}该账号？${currentlyDisabled ? '' : '停用后路由不会分配给该账号。'}`, async () => {
      try {
        await api('/api/account/disable', { uid, disabled: !currentlyDisabled });
        toast(`账号已${action}`);
        loadState();
      } catch (e) { toast(e.message); }
    });
  }

  function removeAcct(uid) {
    askConfirm('确定删除该账号？删除后需重新登录。', async () => {
      try {
        await api('/api/account/remove', { uid });
        toast('账号已删除');
        loadState();
      } catch (e) { toast(e.message); }
    });
  }

  async function checkinAll() {
    setBusy((b) => ({ ...b, checkinAll: true }));
    try {
      const r = await api('/api/account/checkin_all', {});
      const results = r.results || [];
      const ok = results.filter((x) => x.ok).length;
      const pending = results.filter((x) => !x.ok && x.retryable).length;
      const skip = (state.accounts || []).filter((a) => noExplicitCheckin(a.group)).length;
      const total = results.length + skip;
      const parts = [skip ? `成功 ${ok} / ${total}（${skip} 个无签到活动跳过）` : `成功 ${ok} / 共 ${total}`];
      if (pending) parts.push(`${pending} 个未领到将在窗口内自动重试`);
      toast(`批量签到完成：${parts.join('；')}`);
      loadState();
    } catch (e) { toast(e.message); } finally {
      setBusy((b) => ({ ...b, checkinAll: false }));
    }
  }

  async function refreshAll() {
    setBusy((b) => ({ ...b, refreshAll: true }));
    try {
      const r = await api('/api/account/refresh_all', {});
      toast(r.busy ? '已有刷新任务进行中' : `积分刷新完成：成功 ${r.ok} / 失败 ${r.failed}`);
      loadState();
    } catch (e) { toast(e.message); } finally {
      setBusy((b) => ({ ...b, refreshAll: false }));
    }
  }

  function askConfirm(msg, onOk) { setConfirmBox({ msg, onOk }); }

  // ---------- 显示名 ----------
  function openRename(uid, currentName) {
    if (uid === 'oczen-anon') { toast('OpenCodeZen 匿名通道账号不可改名'); return; }
    setRenameBox({ uid, name: currentName, isDefault: currentName === shortUid(uid) });
  }

  async function saveRename(nickname) {
    if (!renameBox) return;
    if (!nickname) { toast('显示名不能为空'); return; }
    try {
      await api('/api/account/nickname', { uid: renameBox.uid, nickname });
      toast('显示名已更新');
      setRenameBox(null);
      loadState();
    } catch (e) { toast(e.message); }
  }

  // ---------- 添加账号（标准 OAuth 式） ----------
  const loginPoll = useRef(null);
  function stopLoginPoll() { if (loginPoll.current) { clearInterval(loginPoll.current); loginPoll.current = null; } }

  function promptLogin(channel) { setFlow((f) => ({ ...f, confirm: { channel } })); }

  async function startLogin(channel) {
    try {
      const r = await api('/api/login/start', { channel });
      const url = r.auth_url;
      if (!url) { toast('无法获取登录链接'); return; }
      setFlow((f) => ({ ...f, confirm: null, pending: { channel, url } }));
      window.open(url, '_blank', 'noopener,noreferrer');
      stopLoginPoll();
      loginPoll.current = setInterval(async () => {
        try {
          const st = await api('/api/state');
          if (!st.login_busy) {
            stopLoginPoll();
            setFlow((f) => ({ ...f, pending: null }));
            toast('登录完成，正在同步账号…');
            await loadState();
            refreshFees();
          }
        } catch (e) { /* 忽略 */ }
      }, 3000);
    } catch (e) { toast(e.message); }
  }

  async function cancelLogin() {
    try {
      await api('/api/login/cancel', {});
      stopLoginPoll();
      setFlow((f) => ({ ...f, pending: null }));
      toast('登录已取消');
    } catch (e) { toast(e.message); }
  }

  // ---------- 智谱清言：CDP 自动捕获 Cookie，手工粘贴为兜底 ----------
  const glmPoll = useRef(null);
  const glmTimer = useRef(null);
  function stopGLMPoll() { if (glmPoll.current) { clearInterval(glmPoll.current); glmPoll.current = null; } }

  function startGLMLogin() {
    setFlow((f) => ({ ...f, glm: { status: '正在启动浏览器…', error: '', manualOpen: false, token: '', validating: false } }));
    api('/api/login/glm_auto', {})
      .then(() => {
        setFlow((f) => f.glm ? { ...f, glm: { ...f.glm, status: '浏览器已打开，请在其中登录智谱清言…' } } : f);
        glmPoll.current = setInterval(async () => {
          try {
            const st = await api('/api/login/glm_auto_status');
            if (st.status === 'success') {
              stopGLMPoll();
              toast('智谱清言账号已添加');
              await loadState();
              refreshFees();
              setFlow((f) => f.glm ? { ...f, glm: { ...f.glm, status: `✅ 已添加账号：${st.nickname || st.uid}` } } : f);
              glmTimer.current = setTimeout(() => setFlow((f) => ({ ...f, glm: null })), 1200);
            } else if (st.status === 'failed') {
              stopGLMPoll();
              setFlow((f) => f.glm ? { ...f, glm: { ...f.glm, status: '', error: (st.error || '登录失败') + '（可展开下方手工方式）', manualOpen: true } } : f);
            } else if (st.status === 'cancelled' || st.status === 'idle') {
              stopGLMPoll();
            }
          } catch (e) { /* 忽略瞬时错误 */ }
        }, 2000);
      })
      .catch((e) => {
        setFlow((f) => f.glm ? { ...f, glm: { ...f.glm, status: '', error: (e.message || '启动失败') + '（可展开下方手工方式）', manualOpen: true } } : f);
      });
  }

  function cancelGLMLogin() {
    stopGLMPoll();
    clearTimeout(glmTimer.current);
    api('/api/login/glm_auto_cancel', {}).catch(() => {});
    setFlow((f) => ({ ...f, glm: null }));
  }

  async function submitGLMToken(token) {
    const t = (token || '').trim();
    if (!t) { setFlow((f) => ({ ...f, glm: { ...f.glm, error: '请粘贴 refresh_token' } })); return; }
    setFlow((f) => ({ ...f, glm: { ...f.glm, validating: true, error: '验证中…' } }));
    try {
      await api('/api/login/glm_token', { refresh_token: t });
      stopGLMPoll();
      setFlow((f) => ({ ...f, glm: null }));
      toast('智谱清言账号已添加');
      await loadState();
      refreshFees();
    } catch (e) {
      setFlow((f) => ({ ...f, glm: { ...f.glm, validating: false, error: e.message || '验证失败' } }));
    }
  }

  useEffect(() => () => { stopLoginPoll(); stopGLMPoll(); clearTimeout(glmTimer.current); }, []);

  const glmView = flow.glm ? {
    ...flow.glm,
    toggleManual: () => setFlow((f) => ({ ...f, glm: { ...f.glm, manualOpen: !f.glm.manualOpen } })),
    setToken: (v) => setFlow((f) => ({ ...f, glm: { ...f.glm, token: v } })),
    submit: () => submitGLMToken(flow.glm.token),
    cancel: cancelGLMLogin,
  } : null;

  // 顶栏渲染已收敛到 NavShell（登录态与非登录态共用）。

  const actions = useMemo(() => ({
    promptLogin, startGLMLogin, checkin, refreshOne, toggleDisable, removeAcct,
    checkinAll, refreshAll, refreshFees, openRename, copyUrl: (u) => copyText(u, '链接', toast),
    cancelLogin, confirmLogin: () => flow.confirm && startLogin(flow.confirm.channel),
    closeConfirm: () => setFlow((f) => ({ ...f, confirm: null })),
    busy,
  }), [state, flow.confirm, busy]);
  actionsRef.current = actions;

  // 未登录时必须仍然渲染整幅页面外壳，只在其上叠一层登录弹窗 —— 与 vanilla 一致。
  // vanilla 的面板 DOM 是静态 HTML，会话探针 showLogin(); return; 只是不填数据、不加载账号，
  // 顶栏与「纸」主题按钮始终在。若这里 early-return 成裸弹窗，用户在登录前就没有主题入口，
  // 而且整页外壳会闪失。
  if (!state) {
    return (
      <>
        <NavShell state={null} theme={theme} toggleTheme={toggleTheme}
                  onSettings={() => {}} onHelp={() => {}} onAbout={() => {}}
                  onCopy={() => {}} disabled />
        <div className="container">
          <section className="section" id="secAccounts">
            <div className="footer">wild-work — 多渠道账号聚合 · 仅供个人学习 · 右键托盘图标退出</div>
          </section>
        </div>
        <AdminLogin open msg={loginMsg} onSubmit={(pass) => submitLogin(pass)} />
      </>
    );
  }

  return (
    <>
      <NavShell state={state} theme={theme} toggleTheme={toggleTheme}
                onSettings={() => setShowSettings(true)} onHelp={() => setShowHelp(true)} onAbout={() => setShowAbout(true)}
                onCopy={(txt, label) => { if (txt === null) { toast('当前未设置 API-Key'); return; } copyText(txt, label, toast); }} />

      <div className="container">
        <section className="section" id="secAccounts" ref={sectionRef}>
          <div className="section-head">
            <div className="main-tabs">
              <button className={`mtab${mainTab === 'accounts' ? ' active' : ''}`} onClick={() => setMainTab('accounts')}>账号管理</button>
              <button className={`mtab${mainTab === 'usage' ? ' active' : ''}`} onClick={() => setMainTab('usage')}>
                用量与流水 <span className="ver" id="usageSince">{sinceText}</span>
              </button>
            </div>
            <div className="panel-actions">
              <button className="btn" id="btnToggleFees" onClick={() => setShowFees(true)}>渠道费率</button>
            </div>
          </div>

          <div className={`mtab-body${mainTab === 'accounts' ? '' : ' hidden'}`} id="mtabAccounts">
            <Accounts state={state} actions={actions} knownUids={knownUids.current} />
          </div>
          <div className={`mtab-body${mainTab === 'usage' ? '' : ' hidden'}`} id="mtabUsage">
            <Usage active={mainTab === 'usage'} usageDays={usageDays} setUsageDays={setUsageDays}
                   bump={usageNonce + (mainTab === 'usage' ? 1 : 0)} sinceSink={setSinceText} />
          </div>
        </section>

        <div className="footer">wild-work — 多渠道账号聚合 · 仅供个人学习 · 右键托盘图标退出</div>
      </div>

      {showFees ? <Fees fees={fees} refreshBusy={busy.refreshFees} onRefresh={refreshFees} onClose={() => setShowFees(false)} /> : null}
      {showSettings ? (
        <Settings key={JSON.stringify(state.compat) + state.listen_port}
                  state={state} onClose={() => setShowSettings(false)} onSaved={loadState}
                  onToast={toast} onEnsureSession={ensureSession} setAuthSession={setAuthSession}
                  onLogout={logout} onShowLogin={showLogin}
                  onSaveTimes={async (times) => {
                    try { await api('/api/config/checkin_times', { times }); toast('签到时间已更新'); loadState(); }
                    catch (e) { toast(e.message); }
                  }} />
      ) : null}
      <LoginFlow flow={{ ...flow, glm: glmView }} actions={{
        closeConfirm: () => setFlow((f) => ({ ...f, confirm: null })),
        confirmLogin: () => flow.confirm && startLogin(flow.confirm.channel),
        cancelLogin, copyUrl: (u) => copyText(u, '链接', toast),
      }} />
      <Confirm open={!!confirmBox} msg={confirmBox && confirmBox.msg}
               onOk={() => { const fn = confirmBox.onOk; setConfirmBox(null); fn(); }}
               onCancel={() => setConfirmBox(null)} />
      <Rename open={!!renameBox} uid={renameBox && shortUid(renameBox.uid)}
              current={renameBox ? { name: renameBox.name, isDefault: renameBox.isDefault } : null}
              onSave={saveRename} onCancel={() => setRenameBox(null)} />
      <Help open={showHelp} onClose={() => setShowHelp(false)} />
      <About open={showAbout} version={state.version} onClose={() => setShowAbout(false)} />
      <Toast text={toastText} />
    </>
  );
}

