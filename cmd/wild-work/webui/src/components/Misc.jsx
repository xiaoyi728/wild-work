import React, { useEffect, useRef, useState } from 'react';

// 管理面板登录层。注意 id 一律带 admin 前缀，与「添加账号」弹层（loginOverlay/loginMsg）
// 语义不同，切勿混用。
export function AdminLogin({ open, msg, onSubmit }) {
  const inputRef = useRef(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" id="adminLoginOverlay">
      <div className="modal" style={{ width: 360 }}>
        <div className="modal-title">管理面板登录</div>
        <div className="modal-body">
          <div className="hint" style={{ margin: '0 0 8px' }}>
            当前监听地址已对外暴露，请输入管理员密码（config.json 的 <code>admin_password</code>）。
          </div>
          <input id="adminLoginPass" className="input" type="password" placeholder="管理员密码"
                 style={{ width: '100%' }} autoComplete="current-password"
                 ref={inputRef} value={pass} onChange={(e) => setPass(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div className="hint" id="adminLoginErr" style={{ color: 'var(--danger)' }}>{msg}</div>
        </div>
        <div className="modal-actions">
          <button className="btn small primary" id="btnAdminLogin" disabled={busy}
                  onClick={() => submit()}>登录</button>
        </div>
      </div>
    </div>
  );

  async function submit() {
    if (!pass) { onSubmit('', null, '请输入管理员密码'); return; }
    setBusy(true);
    try { await onSubmit(pass, true); } finally { setBusy(false); }
  }
}

// 通用确认框（停用/删除等破坏性操作）
export function Confirm({ open, msg, onOk, onCancel }) {
  if (!open) return null;
  return (
    <div className="overlay" id="confirmOverlay">
      <div className="modal">
        <div className="modal-title">确认操作</div>
        <div className="modal-body" id="confirmMsg">{msg}</div>
        <div className="modal-actions">
          <button className="btn small" id="btnConfirmCancel" onClick={onCancel}>取消</button>
          <button className="btn small danger" id="btnConfirmOk" onClick={onOk}>确定</button>
        </div>
      </div>
    </div>
  );
}

// 显示名修改弹层
export function Rename({ open, uid, current, onSave, onCancel }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (open) {
      // 「当前名等于 shortUid」视为未改过名，输入框留空作为占位提示
      setValue(current.isDefault ? '' : current.name);
      if (ref.current) ref.current.focus();
    }
  }, [open, uid]);
  if (!open) return null;
  return (
    <div className="overlay" id="renameOverlay" onClick={(e) => { if (e.target.id === 'renameOverlay') onCancel(); }}>
      <div className="modal">
        <div className="modal-title">修改显示名</div>
        <div className="modal-body">
          <div className="hint" style={{ margin: '0 0 6px' }}>账号：<span id="rnUid" style={{ fontFamily: 'ui-monospace,monospace' }}>{uid}</span></div>
          <input id="rnInput" className="input grow" style={{ width: '100%' }} spellCheck="false" maxLength={60}
                 placeholder="输入新的显示名（1-60 字符）"
                 ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') onSave(value.trim()); }} />
        </div>
        <div className="modal-actions">
          <button className="btn small" id="btnRenameCancel" onClick={onCancel}>取消</button>
          <button className="btn small primary" id="btnRenameSave" onClick={() => onSave(value.trim())}>保存</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ text }) {
  if (!text) return null;
  return <div id="toast" className="toast">{text}</div>;
}

export function Help({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="overlay" id="helpOverlay" onClick={(e) => { if (e.target.id === 'helpOverlay') onClose(); }}>
      <div className="modal modal-wide">
        <div className="modal-title">配置说明</div>
        <div className="modal-body docs">
          <p>1. 添加账号后自动完成登录（WorkBuddy 国际版无需手动签到，定时自动领取日活奖励；Qoder 渠道无签到活动，仅 API 转发）。</p>
          <p>2. AI 客户端配置：Base URL <code>http://127.0.0.1:7863/v1</code>，API Key 见页面顶部。</p>
          <p>3. 支持三种接口协议：<br />
            · OpenAI Chat：<code>POST /v1/chat/completions</code>（旧版客户端）<br />
            · OpenAI Responses：<code>POST /v1/responses</code>（codex CLI）<br />
            · Anthropic Messages：<code>POST /v1/messages</code>（claude CLI，Base URL 不带 <code>/v1</code>）<br />
            Anthropic 客户端用 <code>x-api-key</code> 或 <code>Authorization: Bearer</code> 均可。</p>
          <p>4. 模型 ID 建议带渠道前缀：<code>workbuddy/&lt;model&gt;</code>、<code>workbuddyai/&lt;model&gt;</code>、<code>traework/&lt;model&gt;</code>、<code>qoder/&lt;model&gt;</code>；
            也支持裸名（走「设置 → 模型路由」的 <code>默认渠道</code> / <code>映射表</code> 配置）。</p>
          <p>5. 账号显示名可点击卡片上的名字直接修改；顶栏齿轮进入统一设置（监听 / API-Key / 模型路由 / 备用上游通道）。</p>
          <p>6. 备用上游通道：全局只配一个代理地址（http/https/socks5），<b>不影响任何常规请求</b>（所有渠道一律直连）；
            仅当上游回「地区限制」时，本工具会在同一次请求内自动改走该通道重发一次。目前取用方：Cline 与 OpenCodeZen。</p>
          <p>7. 积分会随聊天消耗实时变化，"全部刷新积分"可即时获取最新余额。</p>
          <p>8. 日志文件位于 exe 目录下 <code>data/app.log</code>，可从托盘菜单"查看日志"打开。</p>
          <p>9. 退出程序：右键托盘图标选择"退出"。</p>
          <div className="risk-block">
            <div className="risk-title">⚠️ 风险警告与免责声明</div>
            <ul className="risk-list">
              <li>本工具基于对上游平台接口的<b>逆向工程</b>实现，非官方支持，随时可能因上游改版而失效。</li>
              <li>使用本工具可能<b>违反上游平台的服务条款</b>，存在<b>账号被限制、封禁或追责的风险</b>，请自行评估并承担全部后果。</li>
              <li>请使用小号或可承受损失的账号接入，<b>切勿将主力账号用于本工具</b>。</li>
              <li>本工具仅限<b>个人学习与研究</b>用途，严禁用于商业用途或大规模滥用；请遵守各上游平台服务条款与当地法律法规。</li>
              <li>监听 <code>0.0.0.0</code> 会将 API 与账号管理暴露给局域网，请确认网络环境可信。</li>
              <li>本软件按"现状"提供，作者不对使用本软件造成的任何直接或间接损失（含账号损失、积分损失、数据丢失等）承担责任。</li>
              <li>本软件与上游各平台（WorkBuddy/CodeBuddy、TraeWork、Qoder、千问办公、OpenCode 等）无任何关联，商标权归其各自所有者。</li>
            </ul>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn small primary" id="btnHelpClose" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}

export function About({ open, version, onClose }) {
  if (!open) return null;
  return (
    <div className="overlay" id="aboutOverlay" onClick={(e) => { if (e.target.id === 'aboutOverlay') onClose(); }}>
      <div className="modal" style={{ textAlign: 'center' }}>
        <img className="logo" src={import.meta.env.BASE_URL + "logo64.png"} alt="logo" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: 14 }} />
        <div className="modal-title">cy-work</div>
        <div className="modal-body" style={{ color: 'var(--muted)' }}>
          <p>版本 <span id="aboutVer">{version}</span></p>
          <p>多渠道账号聚合工具</p>
          <p>基于 WorkBuddy + TraeWork + Qoder 上游</p>
          <p style={{ marginTop: 10, fontSize: 12 }}>仅供个人学习使用</p>
        </div>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn small primary" id="btnAboutClose" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
