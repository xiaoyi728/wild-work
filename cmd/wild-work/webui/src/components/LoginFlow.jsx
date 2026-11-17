import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { chLabel, hasWebLogin, isImportLocal, isPasteKey, NO_CHECKIN_LOGIN_HINT } from '../constants.js';

// 添加账号：确认弹层 → login/start → 轮询 /api/state 的 login_busy。
// 智谱清言走另一条路：CDP 自动捕获 Cookie（独立 profile），手工粘贴 refresh_token 为兜底。
//
// 四种添加形态（对应 constants.js 的判据集）：
//   ① 普通：浏览器授权登录（workbuddy 系 / qoder 系 / traework / qwenwork）；
//   ② 导入型：凭据只在本机已登录的官方客户端里（monkeycode / loomy），
//      没有授权 URL，直接调 /api/account/import_local 读本机配置；
//   ③ 网页版自动登录 + 导入两条路都有（raccoon，AGENTS.md R44）——浏览器由后端拉起
//      （独立 profile + CDP），弹窗给两个按钮，并必须写明「登录态互踢」的风险；
//   ④ 粘贴凭据型（cline）：Key 在官方站点创建，本工具只做一次「验证 + 落盘」。
// 另外两个渠道不走通用确认弹层，各自有专用弹层：
//   豆包（doubao）：服务端申请二维码 + 手机 App 扫码，手工粘贴 Cookie 为兜底；
//   WPS 灵犀（lingxi）：CDP 浏览器登录（复用通用 pending）或粘贴 wps_sid。
export default function LoginFlow({ flow, actions }) {
  const {
    confirm, // {channel} 待确认
    pending, // {channel, url, web} 进行中（web=true ⇒ 浏览器已由后端拉起）
    glm, // null | {status, uid, nickname, error, manualOpen}
    cline, // null | {key, err, busy} 粘贴官方 API Key
    doubao, // null | {state, qr, status, err, manualOpen, cookie, busy} 扫码/粘贴 Cookie
    lingxi, // null | {sid, err, busy} 粘贴 wps_sid
  } = flow;

  const ch = confirm && confirm.channel;
  const canImport = !!ch && isImportLocal(ch);
  const canLogin = !!ch && (!isImportLocal(ch) || hasWebLogin(ch));
  const hint = ch ? (NO_CHECKIN_LOGIN_HINT[ch] || '') : '';
  const msg = !ch ? '' : canLogin && !canImport
    ? `点击「登录${chLabel(ch)}」将打开浏览器窗口，请按照指示正常登录${chLabel(ch)}账号，登录成功后关闭浏览器窗口即可。${hint}`
    : canImport && !canLogin
      ? `点击「导入${chLabel(ch)}」将从<b>本机已登录的 ${chLabel(ch)} 官方客户端</b>读取凭据并添加账号，无需浏览器登录。${hint}`
      : `点击「登录${chLabel(ch)}」会打开一个<b>独立的浏览器窗口</b>（不影响你日常浏览器的登录态），`
        + `请在其中正常登录（扫码 / 手机号 / 微信均可），登录完成后本工具会自动捕获凭据并保存账号。`
        // 互踢必须写在弹层里：上游 refresh 会轮换 refresh_token，同一份凭据被本工具与
        // 浏览器/官方客户端共用就会互相挤下线。不告知的话用户只会看到「莫名其妙掉线」。
        + `<div class="glm-warn" style="margin-top:10px">`
        + `<div class="glm-warn-title">⚠️ 关于登录态互踢</div>`
        + `本工具会用捕获到的凭据<b>自动续期</b>（上游刷新时会轮换 refresh_token）。`
        + `若你把这个账号的凭据<b>同时</b>用在本工具和浏览器 / 官方客户端上，两边会争抢同一个 refresh_token，`
        + `可能出现<b>其中一侧被挤下线</b>的情况（上游可能对同一账号限制单会话）。`
        + `想两边同时用，请在本工具里点「登录${chLabel(ch)}」<b>单独登录一次</b>（本流程新建独立会话），`
        + `而不是从浏览器复制凭据粘进来。`
        + `</div>`
        + `也可以改用「从客户端导入」：直接读取本机已登录客户端的凭据。`;

  return (
    <>
      {confirm ? (
        <div className="overlay" id="loginConfirmOverlay"
             onClick={(e) => { if (e.target.id === 'loginConfirmOverlay') actions.closeConfirm(); }}>
          <div className="modal">
            <div className="modal-title" id="lcTitle">
              {canImport && !canLogin ? `导入 ${chLabel(ch)} 账号` : `添加 ${chLabel(ch)} 账号`}
            </div>
            <div className="modal-body">
              <p id="lcMsg" dangerouslySetInnerHTML={{ __html: msg }} />
            </div>
            <div className="modal-actions">
              <button className="btn small" id="btnLoginConfirmCancel" onClick={actions.closeConfirm}>取消</button>
              {canImport && canLogin ? (
                <button className="btn small" id="btnLoginImportAlt" title={`从本机已登录的 ${chLabel(ch)} 客户端读取凭据`}
                        onClick={actions.confirmImport}>从客户端导入</button>
              ) : null}
              {canLogin ? (
                <button className="btn small primary" id="btnLoginConfirm" onClick={actions.confirmLogin}>
                  {`登录${chLabel(ch)}`}
                </button>
              ) : (
                <button className="btn small primary" id="btnLoginImport" onClick={actions.confirmImport}>
                  {`导入${chLabel(ch)}`}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="overlay" id="loginOverlay">
          <div className="modal">
            <div className="modal-title" id="loginTitle">{`添加 ${chLabel(pending.channel)} 账号`}</div>
            <div className="modal-body">
              <div id="loginMsg">
                {pending.web
                  ? `已为你打开一个独立的浏览器窗口，请在其中完成${chLabel(pending.channel)}登录；登录完成后无需任何操作，本工具会自动捕获凭据并添加账号。`
                  : '请在浏览器新窗口中完成登录…'}
              </div>
              {pending.manual ? (
                <div id="manualCallback" style={{ marginTop: 10 }}>
                  <div className="hint" style={{ marginBottom: 6 }}>
                    如果浏览器与网关不在同一台机器（例如从局域网另一台电脑打开面板），
                    登录完成后浏览器可能停在一条打不开的 <code>127.0.0.1</code> 地址上。
                    把地址栏里的<b>完整 URL</b>复制粘贴到下面即可完成登录。
                  </div>
                  <input className="input grow" id="manualCallbackInput" spellCheck="false" autoComplete="off"
                         placeholder="粘贴登录完成后浏览器地址栏里的完整 URL（含 ? 后的全部参数）"
                         value={pending.manualURL || ''}
                         onChange={(e) => actions.setPendingManualURL(e.target.value)} />
                  <button className="btn small primary" id="btnManualCallback" style={{ marginLeft: 8 }}
                          disabled={pending.manualBusy} onClick={actions.submitManual}>
                    {pending.manualBusy ? '提交中…' : '提交回调'}
                  </button>
                </div>
              ) : null}
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
      {cline ? <ClineModal cline={cline} /> : null}
      {doubao ? <DoubaoModal doubao={doubao} actions={actions} /> : null}
      {lingxi ? <LingxiModal lingxi={lingxi} actions={actions} /> : null}
    </>
  );
}

// 粘贴型渠道（Cline）的专用弹层：没有浏览器编排，只有一次「验证 + 落盘」。
// 文案里的两条约束是这渠道最容易踩的坑，缺一条就会有用户在一个账号下堆 Key 以为能翻倍额度：
//   ① 额度按 Cline **账号**计（官方字段 …UsageCostUSDPerUser）；
//   ② Key 只在创建时完整显示一次，错过就得重建。
function ClineModal({ cline }) {
  const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  return (
    <div className="overlay" id="clineOverlay"
         onClick={(e) => { if (e.target.id === 'clineOverlay') cline.cancel(); }}>
      <div className="modal modal-wide">
        <div className="modal-title">添加 Cline 账号</div>
        <div className="modal-body settings-body">

          <div className="cfg-section">
            <div className="cfg-heading">申请办法</div>
            <ol className="glm-steps">
              <li>打开 <a href="https://app.cline.bot/" target="_blank" rel="noopener noreferrer">app.cline.bot</a> 并注册账号。</li>
              <li>进入 <code>Account / API Keys</code> → <code>Create API Key</code>。</li>
              <li>Key（形如 <code>sk_</code> + 64 位十六进制）<b>只在创建时完整显示一次</b>，请立即复制粘贴到下面。</li>
            </ol>
            <input id="clineKeyInput" className="input grow" spellCheck="false" autoComplete="off" ref={inputRef}
                   placeholder="粘贴 API Key（sk_…）" style={{ width: '100%', fontFamily: 'ui-monospace,monospace' }}
                   value={cline.key} onChange={(e) => cline.setKey(e.target.value)} />
          </div>

          {/* 实测参数表：上游 recommended-models 的 free[] 只给 id/name/description/tags，
              完全不返回上下文与能力字段，而客户端靠 /v1/models 的 context_length /
              input_modalities 判断压缩时机与能否收图 —— 只能本工具逐个实测后写进去。
              措辞按 R46 的裁定写「向上取一档」（上游面板文案此处仍写着向下取档，与实测值不符）。 */}
          <div className="cfg-section">
            <div className="cfg-heading">免费模型参数（本工具实测验证值，仅供参考）</div>
            <table className="table cline-caps">
              <thead><tr><th>模型</th><th>上下文</th><th>图像</th><th>工具</th><th>备注</th></tr></thead>
              <tbody>
                <tr><td><code>mimo-v2.6-flash</code></td><td>1M</td><td>✅</td><td>✅</td><td></td></tr>
                <tr><td><code>step-5-preview</code></td><td>1M</td><td>✅</td><td>✅</td><td></td></tr>
                <tr><td><code>muse-spark-1.3-contributor</code></td><td>1M</td><td>✅</td><td>✅</td>
                    <td className="dim">地区限制：启用设置里的<b>备用上游通道</b>后自动改道</td></tr>
                <tr><td><code>solar-mini4</code></td><td>512K</td><td>—</td><td>✅</td>
                    <td className="dim">上游明确不接受图像输入</td></tr>
              </tbody>
            </table>
            <div className="hint">
              以上为 2026-10-12 实测结果（「头/中/尾三暗号」回忆验证，排除上游静默截断）：
              上下文按实测通过值<b>向上取一档</b>，超大 prompt（&gt;~700K）首字节常需 &gt;90s，
              已超出本工具 90s 响应头超时，故实测值本身是<b>下界</b>；
              <b>非官方值，仅作参考</b>，上游随时可能调整。
            </div>
          </div>

          <div className="glm-warn">
            <div className="glm-warn-title">⚠️ 必须使用多个独立账号各自的 Key</div>
            <ol>
              <li>官方免费额度<b>按 Cline 账号计</b>（其权益字段名为 <code>…UsageCostUSDPerUser</code>）。</li>
              <li>同一个账号下创建多把 Key <b>共享同一份额度</b>，不会增加可用额度。
                  本工具在检测到多把 Key 同属一个账号时会给出提示。</li>
              <li>想扩额度请<b>注册多个独立 Cline 账号</b>，每个账号各建一把 Key，逐个粘贴添加。</li>
            </ol>
          </div>

          <div className="hint">
            本渠道只调度 <b>免费模型</b>（上游无余额/额度查询接口，故积分显示「不适用」；
            实际花费见「用量与流水」）。订阅池 <code>cline-pass</code> 与付费模型不在本渠道使用范围内。
            Key 不过期、不轮换，也不会与浏览器/客户端互相挤下线。
          </div>

          <div className="hint" id="clineErr" style={{ color: 'var(--danger)' }}>{cline.err}</div>
        </div>
        <div className="modal-actions">
          <button className="btn" id="btnClineCancel" onClick={cline.cancel}>取消</button>
          <button className="btn primary" id="btnClineSubmit" disabled={cline.busy} onClick={cline.submit}>
            {cline.busy ? '验证中…' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 豆包：扫码登录（服务端纯 HTTP 申请二维码并换登录态）为主，手工粘贴 Cookie 兜底。
// 关键点：
//   · 二维码由**后端**申请，NAS / WSL / 无桌面环境同样可用（不依赖本机浏览器）；
//   · 二维码图片地址可能为空（正在申请/申请失败），此时渲染占位块而不是破图；
//   · 申请失败或扫码失败时自动展开手工方式并把错误原文露出来，不让用户卡在空白弹层里。
function DoubaoModal({ doubao, actions }) {
  const cookieRef = useRef(null);
  useEffect(() => { if (doubao.manualOpen && cookieRef.current) cookieRef.current.focus(); }, [doubao.manualOpen]);
  const failed = doubao.state === 'failed';
  return (
    <div className="overlay" id="doubaoOverlay"
         onClick={(e) => { if (e.target.id === 'doubaoOverlay') actions.cancelDoubao(); }}>
      <div className="modal modal-wide">
        <div className="modal-title">添加豆包账号</div>
        <div className="modal-body settings-body">

          <div className="cfg-section" id="doubaoQr">
            <div className="cfg-heading">扫码登录（推荐）</div>
            <ol className="glm-steps">
              <li>用手机上的 <b>豆包 App</b> 扫下方二维码。</li>
              <li>手机上点「确认登录」，这里会自动完成，<b>不需要复制任何 Cookie</b>。</li>
              <li>二维码由服务器自己申请、自己换登录态，NAS / 服务器部署同样有效。</li>
            </ol>
            <div className="doubao-qr-box">
              {doubao.qr
                ? <img className="doubao-qr" id="doubaoQrImg" src={doubao.qr}
                       alt="豆包登录二维码" width="180" height="180" />
                : <div className="doubao-qr-empty" id="doubaoQrEmpty">
                    {failed ? '二维码申请失败' : '正在申请二维码…'}
                  </div>}
            </div>
            {doubao.status && !doubao.err
              ? <div className="hint" id="doubaoQrStatus">{doubao.status}</div>
              : null}
            <div className="hint" style={{ marginTop: 8 }}>
              <button className="btn small primary" id="btnDoubaoQrStart"
                      disabled={doubao.busy} onClick={actions.restartDoubaoQr}>重新申请二维码</button>
            </div>
            <div className="hint">每个账号单独扫一次；二维码过期后点「重新申请二维码」换新。</div>
          </div>

          {/* 手工兜底：校验/落盘与扫码走后端同一条通道（sessionid 必须在内）。 */}
          <div className="cfg-section">
            <div className="cfg-heading">手工粘贴 Cookie（兜底）</div>
            <div className="hint" style={{ marginBottom: 6 }}>
              扫码不可用（例如面板打不开二维码图片）时用这条路：在已登录豆包网页版的浏览器里按
              <code> F12 </code> → <code>Application</code> → <code>Cookies</code> →
              <code> https://www.doubao.com </code>，整行复制（<b>必须含 sessionid</b>）后粘进来，
              效果与扫码等价。
            </div>
            {doubao.manualOpen ? (
              <div id="doubaoManual">
                <textarea className="input grow doubao-cookie-input" id="doubaoCookieInput" rows={4}
                          ref={cookieRef} spellCheck="false" autoComplete="off"
                          placeholder="sessionid=…; ttwid=…; s_v_web_id=…"
                          value={doubao.cookie}
                          onChange={(e) => doubao.setCookie(e.target.value)} />
                <div className="hint" style={{ marginTop: 8 }}>
                  <button className="btn small primary" id="btnDoubaoCookie"
                          disabled={doubao.busy} onClick={() => actions.submitDoubaoCookie(doubao.cookie)}>
                    {doubao.busy ? '验证中…' : '验证并添加'}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="hint" style={{ marginTop: 8 }}>
              <button className="btn small" id="btnDoubaoManualToggle" onClick={doubao.toggleManual}>
                {doubao.manualOpen ? '收起手工方式' : '展开手工方式'}
              </button>
            </div>
          </div>

        </div>
        <div className="modal-actions">
          <div className="hint" id="doubaoErr"
               style={{ color: 'var(--danger)', marginRight: 'auto', marginTop: 0 }}>{doubao.err}</div>
          <button className="btn" id="btnDoubaoCancel" onClick={actions.cancelDoubao}>取消</button>
        </div>
      </div>
    </div>
  );
}

// WPS 灵犀：两条等价路径 —— ① 浏览器登录（后端拉起独立 profile + CDP 捕获 wps_sid，
// 关闭本弹层后走通用 pending 弹层）；② 手工粘贴 wps_sid。
// 弹层里必须写清三条约束（缺一条都会让用户误判「为什么没额度」）：
//   ① 灵犀与 Comate 是同一 WPS 账号体系的两个独立产品，须灵犀侧已开通；
//   ② 智点按 WPS 账号计，重复添加不增加额度；
//   ③ wps_sid 不参与自动续期，失效后需重新登录或重新粘贴。
function LingxiModal({ lingxi, actions }) {
  const sidRef = useRef(null);
  useEffect(() => { if (sidRef.current) sidRef.current.focus(); }, []);
  return (
    <div className="overlay" id="lingxiOverlay"
         onClick={(e) => { if (e.target.id === 'lingxiOverlay') actions.closeLingxi(); }}>
      <div className="modal modal-wide">
        <div className="modal-title">添加 WPS 灵犀账号</div>
        <div className="modal-body settings-body">

          <div className="cfg-section">
            <div className="cfg-heading">方式一：浏览器登录（推荐）</div>
            <ol className="glm-steps">
              <li>点下方「浏览器登录」，本工具会打开一个<b>独立的浏览器窗口</b>并前往 WPS 官网
                  （不影响你日常浏览器的登录态）。</li>
              <li>在其中正常登录你的 WPS 账号（扫码 / 手机号 / 微信均可）。</li>
              <li>登录完成后无需操作，后端会通过 CDP 捕获 <code>wps_sid</code> 并验证灵犀侧是否已开通。</li>
            </ol>
            <button className="btn small primary" id="btnLingxiBrowser"
                    onClick={() => { actions.closeLingxi(); actions.startLogin('lingxi'); }}>
              浏览器登录
            </button>
          </div>

          <div className="cfg-section">
            <div className="cfg-heading">方式二：粘贴 wps_sid</div>
            <ol className="glm-steps">
              <li>用浏览器登录 <a href="https://lingxi.kdocs.cn/" target="_blank" rel="noopener noreferrer">lingxi.kdocs.cn</a>
                  （须为已开通灵犀的 WPS 账号，能看到智点余额）。</li>
              <li>按 <code>F12</code> → <code>Application</code>（应用）→ <code>Cookies</code> → <code>https://lingxi.kdocs.cn</code>。</li>
              <li>找到名为 <code>wps_sid</code> 的 Cookie，复制它的<b>值</b>粘贴到下面。</li>
            </ol>
            <input id="lingxiSidInput" className="input grow" spellCheck="false" autoComplete="off"
                   ref={sidRef} placeholder="粘贴 wps_sid Cookie 值"
                   style={{ width: '100%', fontFamily: 'ui-monospace,monospace' }}
                   value={lingxi.sid} onChange={(e) => lingxi.setSid(e.target.value)} />
            <div className="hint" style={{ marginTop: 8 }}>
              <button className="btn small primary" id="btnLingxiSubmit"
                      disabled={lingxi.busy} onClick={() => actions.submitLingxiSID(lingxi.sid)}>
                {lingxi.busy ? '验证中…' : '验证并添加'}
              </button>
            </div>
          </div>

          <div className="glm-warn">
            <div className="glm-warn-title">⚠️ 必须使用多个独立 WPS 账号各自的 wps_sid</div>
            <ol>
              <li><b>灵犀与 Comate 是同一 WPS 账号体系的两个独立产品</b>：同一份 wps_sid 在一侧开通，
                  不代表另一侧可用 —— 本渠道要求<b>灵犀侧已开通</b>且有智点余额。</li>
              <li><b>智点按 WPS 账号计</b>：同一个账号重复粘贴同一份 wps_sid <b>共享同一份额度</b>，
                  重复添加不会增加额度。本工具在检测到重复 sid 时会给出提示。</li>
              <li>想扩额度请<b>注册多个独立 WPS 账号</b>（各自开通灵犀），逐个粘贴添加。</li>
              <li><code>wps_sid</code> 是登录 Cookie，<b>不参与自动续期</b>：在官网主动退出或修改密码后可能失效；
                  失效后账号卡片会出现 ⟳ 入口，点它重新走一遍本流程即可恢复。</li>
            </ol>
          </div>

          <div className="hint">
            模型列表由灵犀侧动态下发（DeepSeek / Qwen / GLM / Kimi / MiniMax 等）；
            每日签到自动领取智点，余额与临期智点显示在账号卡片。
            凭据只保存在本机 <code>auths/</code> 目录，不会外传。
          </div>

          <div className="hint" id="lingxiErr"
               style={{ color: lingxi.busy ? 'var(--muted)' : 'var(--danger)' }}>
            {lingxi.busy ? '验证中…' : lingxi.err}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" id="btnLingxiCancel" onClick={actions.closeLingxi}>取消</button>
        </div>
      </div>
    </div>
  );
}
