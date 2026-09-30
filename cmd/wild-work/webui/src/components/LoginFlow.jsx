import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { chLabel, noExplicitCheckin, NO_CHECKIN_LOGIN_HINT } from '../constants.js';

// 添加账号：确认弹层 → login/start → 轮询 /api/state 的 login_busy。
// 智谱清言走另一条路：CDP 自动捕获 Cookie（独立 profile），手工粘贴 refresh_token 为兜底。
export default function LoginFlow({ flow, actions }) {
  const {
    confirm, // {channel} 待确认
    pending, // {channel, url} 进行中
    glm, // null | {status, uid, nickname, error, manualOpen}
  } = flow;

  return (
    <>
      {confirm ? (
        <div className="overlay" id="loginConfirmOverlay"
             onClick={(e) => { if (e.target.id === 'loginConfirmOverlay') actions.closeConfirm(); }}>
          <div className="modal">
            <div className="modal-title" id="lcTitle">{`添加 ${chLabel(confirm.channel)} 账号`}</div>
            <div className="modal-body">
              <p id="lcMsg">
                {noExplicitCheckin(confirm.channel)
                  ? `点击「登录${chLabel(confirm.channel)}」将打开浏览器窗口，请按照指示正常登录${chLabel(confirm.channel)}账号，登录成功后关闭浏览器窗口即可。${NO_CHECKIN_LOGIN_HINT[confirm.channel] || ''}`
                  : `点击「登录${chLabel(confirm.channel)}」将打开浏览器窗口，请按照指示正常登录${chLabel(confirm.channel)}账号，登录成功后关闭浏览器窗口即可。`}
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn small" id="btnLoginConfirmCancel" onClick={actions.closeConfirm}>取消</button>
              <button className="btn small primary" id="btnLoginConfirm" onClick={actions.confirmLogin}>
                {`登录${chLabel(confirm.channel)}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="overlay" id="loginOverlay">
          <div className="modal">
            <div className="modal-title" id="loginTitle">{`添加 ${chLabel(pending.channel)} 账号`}</div>
            <div className="modal-body">
              <div id="loginMsg">请在浏览器新窗口中完成登录…</div>
              <div className="login-buttons">
                <button className="btn small glare" id="btnCopyUrl" onClick={() => actions.copyUrl(pending.url)}>复制链接</button>
                <button className="btn small danger" id="btnCancelLogin" onClick={actions.cancelLogin}>取消</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {glm ? (
        <div className="overlay" id="glmOverlay">
          <div className="modal modal-wide">
            <div className="modal-title">添加 智谱清言 账号</div>
            <div className="modal-body settings-body">

              {/* 风险与能力边界告知：本渠道为体验性质，务必先读 */}
              <div className="glm-warn">
                <div className="glm-warn-title">⚠️ 使用前必读（体验渠道）</div>
                <ol>
                  <li><b>本渠道仅供体验</b>，不作为日常主力渠道。</li>
                  <li><b>WEB 逆向渠道一旦改版很容易触发风控导致封号</b>，请用小号，勿用主力账号。</li>
                  <li><b>仅能文本对话</b>：不支持工具调用（tool_calls）、不支持多模态（图片输入）；
                      对话不复用上游会话，每次对话在您的清言账号中留痕且<b>不会自动删除</b>；
                      因此<b>不建议通过 Agent（Claude Code/Codex 等）使用</b>。</li>
                </ol>
              </div>

              <div className="cfg-section" id="glmAuto">
                <div className="cfg-heading">自动登录</div>
                <ol className="glm-steps">
                  <li>已为你打开一个**独立的浏览器窗口**（不影响你日常浏览器的登录态）。</li>
                  <li>在那个窗口里正常登录智谱清言（扫码 / 手机号 / 微信均可）。</li>
                  <li>登录完成后**无需任何操作**，这里会自动捕获凭据并添加账号。</li>
                </ol>
                <div className="hint" id="glmStatus">{glm.status}</div>
                <div className="hint">每个账号使用独立的浏览器环境，所以可以连续添加多个清言账号，互不干扰。</div>
              </div>

              <div className="cfg-section">
                <div className="cfg-heading">
                  <span className="btn small" id="btnGLMToggleManual" style={{ cursor: 'pointer' }}
                        onClick={glm.toggleManual}>手工方式（自动失败时用）</span>
                </div>
                {glm.manualOpen ? (
                  <div id="glmManual">
                    <ol className="glm-steps">
                      <li>在自己浏览器打开 <a href="https://chatglm.cn" target="_blank" rel="noopener noreferrer">chatglm.cn</a> 并登录。</li>
                      <li>按 <code>F12</code> → <code>Application</code> → <code>Cookies</code> → <code>https://chatglm.cn</code>。</li>
                      <li>复制 <code>chatglm_refresh_token</code> 的值，粘贴到下面。</li>
                    </ol>
                    <input id="glmTokenInput" className="input grow" spellCheck="false" autoComplete="off"
                           placeholder="粘贴 chatglm_refresh_token 的值"
                           value={glm.token} onChange={(e) => glm.setToken(e.target.value)} />
                    <div className="hint" style={{ marginTop: 6 }}>
                      <button className="btn small primary" id="btnGLMSubmit"
                              disabled={glm.validating} onClick={glm.submit}>
                        {glm.validating ? '验证中…' : '验证并添加'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="hint" id="glmErr" style={{ color: 'var(--danger)' }}>{glm.error}</div>
              <div className="hint">凭据只保存在本机 <code>auths/</code> 目录，不会外传。token 会随刷新自动轮换并回写。</div>
            </div>
            <div className="modal-actions">
              <button className="btn small" id="btnGLMCancel" onClick={glm.cancel}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
