import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { chLabel, chClass, UNKNOWN_TIP } from '../constants.js';
import { fmtTokens } from '../format.js';

// 能力/上下文来源（R119）：后端 cap_source 三态 + 未探测，逐处如实标注。
// 旧响应没有该字段时退回 hand_measured 二选一，保证旧产物仍能正常渲染。
const CAP_SRC_TEXT = {
  api: '上游接口返回',
  measured: '本工具实测值（仅供参考，非上游官方声明）',
  user: '面板手填值（非上游声明）',
};
function capSrcKey(m) {
  return (m && m.cap_source) || (m && m.hand_measured ? 'measured' : 'api');
}

// 能力图标：模型 ID 后的小标记，title 提供文字描述。
// 只展示上游明确声明的能力；未声明的（字段缺失或上游返回 false）不显示图标。
// tool_calls 不展示：几乎所有模型都支持，图标信息量低。
function CapIcons({ m }) {
  if (!m) return null;
  const caps = [];
  if (m.supports_images) caps.push(<span key="img" className="cap-icon cap-img" title="支持图像输入（多模态视觉）：可直接发送图片给该模型">👁</span>);
  if (m.supports_reasoning) caps.push(<span key="r" className="cap-icon cap-reason" title="支持思考/推理模式：回复前会进行推理（可能含 reasoning_content）">🧠</span>);
  if (!caps.length) return null;
  return <> <span className="cap-icons">{caps}</span></>;
}

// 上下文标记：有上下文才展示，且不拿估算值充数。
// 来源有三态，口径不同必须标出来：api = 上游接口返回；measured = 本工具实测；
// user = 面板手填。非上游声明一律带 * 并在 title 里写明来源——把实测/手填冒充成
// 官方声明正是 R46/issue #40 禁止的做法（R119 起统一由 cap_source 驱动）。
function CtxTag({ m }) {
  if (!m || !m.has_context || !m.context_window) return null;
  const srcKey = capSrcKey(m);
  const hand = srcKey !== 'api';
  const src = CAP_SRC_TEXT[srcKey] || CAP_SRC_TEXT.api;
  return (
    <> <span className={`ctx-tag${hand ? ' hand' : ''}`}
               title={`上下文窗口：${fmtTokens(m.context_window)} tokens（${src}）`}>
      ({fmtTokens(m.context_window)}{hand ? '*' : ''})
    </span></>
  );
}

// 思考档位小标（issue #96）：只在上游目录声明时展示，未声明就整个不出现。
// 把「未声明」显示成任何具体档位都是编造，与 ContextFromAPI 同一哲学。
function EffortTag({ m }) {
  if (!m || !m.reasoning_efforts || !m.reasoning_efforts.length) return null;
  const list = m.reasoning_efforts.join('·')
    + (m.default_reasoning_effort ? `（默认 ${m.default_reasoning_effort}）` : '');
  return (
    <> <span className="effort-tag"
              title={`思考档位（上游目录声明）：${list}；客户端传 reasoning_effort 即可调档`}>
      [{m.reasoning_efforts.join('·')}]
    </span></>
  );
}

// 能力文字摘要。措辞说明：来源决定「不支持」能不能说出口（R49/R119）——
// 上游未声明 ⇒ 只说「未声明」；实测/手填 ⇒ 说「实测不支持」/「手填未勾选」；
// 从未探测过 ⇒ 说「未探测」，绝不用默认值冒充结论。
function capText(m) {
  if (!m) return null;
  const srcKey = capSrcKey(m);
  const noText = { api: '上游未声明', measured: '实测不支持', user: '手填未勾选', unknown: '未探测' }[srcKey] || '上游未声明';
  const yes = [], no = [];
  (m.supports_images ? yes : no).push('图像输入');
  (m.supports_reasoning ? yes : no).push('思考模式');
  const parts = [];
  if (yes.length) parts.push(`支持：${yes.join('、')}`);
  if (no.length) parts.push(`${noText}：${no.join('、')}`);
  if (m.reasoning_efforts && m.reasoning_efforts.length) {
    parts.push(`思考档位：${m.reasoning_efforts.join('/')}${m.default_reasoning_effort ? `（默认 ${m.default_reasoning_effort}）` : ''}`);
  }
  if (srcKey === 'measured') parts.push('（能力与上下文为本工具实测值，仅供参考）');
  if (srcKey === 'user') parts.push('（能力与上下文为您在面板手填，本工具不核实其真实性）');
  if (srcKey === 'unknown') parts.push('（未探测过能力：可在「自定义渠道」里点「导入模型」拉一次上游 /models）');
  return parts.join('；');
}

function modelTip(m) {
  const parts = [`模型：${m.model}`];
  const srcKey = capSrcKey(m);
  if (m.has_context && m.context_window) {
    const src = srcKey === 'api' ? '' : `（${CAP_SRC_TEXT[srcKey] || '非上游官方值'}）`;
    parts.push(`上下文窗口：${fmtTokens(m.context_window)}${src}`);
    if (m.max_tokens) parts.push(`最大输出：${fmtTokens(m.max_tokens)}`);
  } else {
    parts.push('上下文窗口：未知');
    parts.push('最大输出：未知');
    parts.push(srcKey === 'unknown' ? '（尚未探测上游，本工具不编造默认值）' : '（上游未提供该信息）');
  }
  const ct = capText(m);
  if (ct) parts.push(ct);
  return parts.join('\n');
}

// 倍率三态：!priced → unknown（上游没返回，不等于免费）、free → ✦ Free、否则 x率。
// 「缺字段」与「值为 0」必须分开，这是现状里刻意做出来的判据。
function RateCell({ m }) {
  if (!m) return null;
  if (!m.priced) return <span className="rate-unknown" title={UNKNOWN_TIP}>unknown</span>;
  if (m.free) return <span className="rate-free" title="上游标注为免费（x0.00）">✦ Free</span>;
  return <span className="rate-paid">x{m.rate.toFixed(2)}</span>;
}

// ChannelAccess 自定义渠道的接入点一行（R119）：面板被当成「模型接入点总表」用，
// 需要一眼看到每个渠道走哪条线、用哪把 key。内建渠道没有 base_url ⇒ 不渲染。
// key 只展示后端下发的脱敏值；明文只在用户点「复制」那一刻按需取，不进 DOM。
function ChannelAccess({ ch, onCopy, onCopyKey }) {
  if (!ch || !ch.base_url) return null;
  return (
    <div className="fee-access">
      <span className="fee-access-k">接入点</span>
      <code className="fee-access-v fee-copy-url" role="button" tabIndex={0}
            title={`点击复制接入点：${ch.base_url}`}
            onClick={() => onCopy && onCopy(ch.base_url, '接入点')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy && onCopy(ch.base_url, '接入点'); } }}>
        {ch.base_url}
      </code>
      <span className="fee-access-k">api-key</span>
      <code className="fee-access-v fee-copy-key" role="button" tabIndex={0}
            title="点击复制完整 api-key（此时才向后端取明文，不随费率接口批量下发）"
            onClick={() => onCopyKey && onCopyKey(ch.channel)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopyKey && onCopyKey(ch.channel); } }}>
        {ch.api_key_masked || '（未配置 key）'}
      </code>
    </div>
  );
}

// 费率行 / 查找行的「短名 + 完整 ID」拆分。
// 完整 ID 的**唯一真源是 /api/fees 行的 `id`**（Go 侧 provider.PublicModelID 的产物）：
// 普通渠道是 `<渠道>/<模型>`，而上游 ID 自带命名空间的渠道（Cline 免费池的 `cline-free/*`）
// 就是上游原名（R59）—— 服务端与 /v1/models、runtimeForModel、降级链解析器同源，
// 前端不再自己拼前缀。拼接规则散在多处必漏，这是 R52 那条教训的收敛。
//
// 仅在响应缺 `id`（旧产物/异常）时回落到本地拼接，并保留 R52 的 startsWith 护栏：
// 「裸名自己就以渠道前缀开头」时原样保留，防重复拼接（否则会拼出 `cline/cline-free/*` 之外
// 更糟的 `cline/cline/cline-free/*`）。⚠️ 仍不得用「名里含 / 就当作已带前缀」那个判据
// （上游 330ee79 的写法）：runtimeForModel 用 SplitN(model, "/", 2) 切**第一个**斜杠，
// 按那个判据会把 `cline-free/grok-4` 误当完整 ID，路由时渠道被解析成 "cline-free" ⇒
// `provider "cline-free" is not configured`。
export function modelIds(ch, raw, id) {
  if (id) return { short: raw, full: id };
  return { short: raw, full: ch && !raw.startsWith(`${ch}/`) ? `${ch}/${raw}` : raw };
}

function ModelId({ m, ch, onCopy }) {
  if (!m) return null;
  // 点击复制的是「渠道/模型」完整标识（路由前缀 + 模型名），而不是裸模型名 ——
  // 光复制模型名粘到客户端里是调不通的，这是本页最容易踩的坑。
  const { short, full } = modelIds(ch, m.model, m.id);
  const copyTip = `点击复制：${full}`;
  return (
    <div className="mcell">
      <span className="mline">
        <code className="fee-model-copy" data-mid={full} role="button" tabIndex={0}
              title={`${modelTip(m)}\n${copyTip}`}
              onClick={() => onCopy && onCopy(full)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy && onCopy(full); } }}>{short}</code>
        <CtxTag m={m} />
        <EffortTag m={m} />
        <CapIcons m={m} />
        {m.note ? <span className="rate-note" style={m.color ? { color: m.color } : undefined}> {m.note}</span> : null}
      </span>
      {/* 完整 ID 单独一行：客户端实际要填的名字。仅在与短名不同才出，避免裸名重复。 */}
      {full !== short ? (
        <span className="full-id" data-mid={full} title={`点击复制完整模型 ID：${full}`}
              onClick={() => onCopy && onCopy(full)}>{full}</span>
      ) : null}
    </div>
  );
}

// 渠道余额角标：该渠道全部账号的可用积分合计。匿名渠道（无积分概念）与
// 余额尚未刷新（credits_stale）的账号都不计入 —— 否则角标会是个假数字。
function channelCredits(state, ch) {
  const accs = (state && state.accounts) || [];
  let sum = 0, any = false;
  for (const a of accs) {
    if (a.group !== ch || a.credits_na || a.credits_stale) continue;
    sum += Number(a.credits) || 0;
    any = true;
  }
  return any ? sum : null;
}

// collectAllModels 展平全渠道模型，附带裸名 short 与完整 ID full（= 渠道/模型，客户端该填的名字）。
// 数据源就是费率弹层已经在用的那份 /api/fees 响应 —— 查找面板纯前端，不新增后端接口。
export function collectAllModels(fees) {
  const out = [];
  for (const ch of (fees && fees.channels) || []) {
    for (const m of ch.models || []) {
      const { short, full } = modelIds(ch.channel, m.model, m.id);
      out.push({ ch: ch.channel, m, short, full });
    }
  }
  return out;
}

// 模型查找弹层：按关键字（模型名 / 渠道 / 完整 ID）即时过滤，点击复制完整模型 ID。
// 关键字同时匹配裸名与完整 ID —— 两处都含渠道名，故搜渠道亦可。
// 结果限量、超出只提示不纵向滚动，配合固定高度的 .modal-search，避免对话框随结果跳变。
export function ModelSearch({ fees, onClose, onCopy }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const all = collectAllModels(fees);
  const kw = String(q || '').trim().toLowerCase();
  const hit = kw ? all.filter((x) => x.full.toLowerCase().includes(kw) || x.short.toLowerCase().includes(kw)) : all;
  // 全量渲染、由 .ms-list 纵向滚动（不再截断前 12 条：渠道多时想找的模型看不到）。
  const shown = hit;
  const foot = !all.length ? ''
    : hit.length === 0 ? '无匹配'
      : `共 ${hit.length} 个匹配`;

  return (
    <div className="overlay" id="modelSearchOverlay"
         onClick={(e) => { if (e.target.id === 'modelSearchOverlay') onClose(); }}>
      <div className="modal modal-search">
        <div className="modal-title">查找模型</div>
        <input id="modelSearchInput" className="input ms-input" type="text" spellCheck="false" autoComplete="off"
               ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="输入关键字过滤（模型名 / 渠道 / 完整 ID）" />
        <div className="ms-list" id="modelSearchList">
          {shown.length === 0 ? (
            <div className="ms-empty">{all.length ? '无匹配模型' : '费率数据尚未加载，请点「刷新费率」后再试'}</div>
          ) : shown.map(({ ch, m, short, full }) => (
            <div key={`${ch}-${full}`} className="ms-row" data-mid={full} role="button" tabIndex={0}
                 title={`点击复制完整模型 ID：${full}`}
                 onClick={() => onCopy(full)}
                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy(full); } }}>
              <span className={`badge ${chClass(ch)}`}>{chLabel(ch)}</span>
              <span className="ms-name">{short}</span>
              <span className="ms-tags">
                {(m.has_context && m.context_window) ? `(${fmtTokens(m.context_window)})` : ''}
                {m.supports_images ? '👁' : ''}{m.supports_reasoning ? '🧠' : ''}
              </span>
              {m.reasoning_efforts && m.reasoning_efforts.length ? (
                <span className="ms-eff"
                      title={`思考档位：${m.reasoning_efforts.join('·')}${m.default_reasoning_effort ? `（默认 ${m.default_reasoning_effort}）` : ''}`}>
                  {m.reasoning_efforts.join('·')}
                </span>
              ) : null}
              <span className="ms-rate">{m.free ? 'Free' : (m.priced ? `x${m.rate.toFixed(2)}` : 'unknown')}</span>
            </div>
          ))}
        </div>
        <div className="ms-foot" id="modelSearchFoot">{foot}</div>
      </div>
    </div>
  );
}

// 渠道费率弹层内部。L1 约束：本地是弹层、上游是页内多标签 ——
// 保留本地 feesOverlay 外壳，内部承载上游 .fees-tabs 渲染，渲染目标仍是 feesBox。
export default function Fees({ fees, state, refreshBusy, onRefresh, onCopy, onToast, onClose }) {
  const channels = (fees && fees.channels) || [];
  // 记住上次选中的渠道，重渲染后自动恢复（后台刷新不打断用户浏览）。
  const [lastCh, setLastCh] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const boxRef = useRef(null);

  const active = channels.some((c) => c.channel === lastCh) ? lastCh : (channels[0] && channels[0].channel);

  // 复制某个自定义渠道的完整 api-key（R119）：明文按需单条取，只进剪贴板、不进 DOM。
  async function copyCustomKey(name) {
    try {
      const res = await api('/api/config/custom_channel_key', { name });
      if (!res || !res.api_key) { if (onToast) onToast(`${name} 未配置 api-key`); return; }
      if (onCopy) onCopy(res.api_key, 'api-key');
    } catch (e) {
      if (onToast) onToast(`取 api-key 失败：${e.message}`);
    }
  }

  // 滚动位置：现状是「渲染只改 active 类与面板可见性，不重建 DOM，避免滚动位置跳动」。
  // React 重渲染同一棵树同样不会重建，故无需额外处理，但弹层打开时容器需存在。
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; }, [active]);

  return (
    <>
    <div className="overlay" id="feesOverlay" onClick={(e) => { if (e.target.id === 'feesOverlay') onClose(); }}>
      <div className="modal" style={{ width: '920px', maxWidth: '94vw' }}>
        <div className="modal-head">
          <div className="modal-title shiny" style={{ marginBottom: 0 }}>渠道费率</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn small" id="btnModelSearch"
                    title="按关键字快速定位全渠道模型，结果点击即复制完整模型 ID"
                    onClick={() => setSearchOpen(true)}>查找模型</button>
            <button className="btn small" id="btnRefreshFees" disabled={refreshBusy} onClick={onRefresh}>刷新费率</button>
          </div>
        </div>
        <div className="modal-body fees" id="feesBox" ref={boxRef}>
          {channels.length === 0 ? (
            <>
              <div className="note">{(fees && fees.note) || ''}</div>
              <div className="note">{(fees && fees.disclaimer) || ''}</div>
            </>
          ) : (
            <>
              <div className="note">{fees.note || ''}</div>
              {fees.cached_at ? <div className="note">费率上次更新：{fees.cached_at}</div> : null}
              {fees.error ? <div className="note" style={{ color: 'var(--danger)' }}>{fees.error}</div> : null}

              <div className="fees-tabs">
                {channels.map((ch) => (
                  <button key={ch.channel}
                          className={`fees-tab${ch.channel === active ? ' active' : ''}`}
                          data-feech={ch.channel}
                          title={chLabel(ch.channel)}
                          onClick={() => setLastCh(ch.channel)}>
                    {chLabel(ch.channel)}<span className="fees-tab-n">{(ch.models || []).length}</span>
                    {channelCredits(state, ch.channel) != null
                      ? <span className="fees-tab-bal">{`余额 ${channelCredits(state, ch.channel)} 分`}</span>
                      : null}
                  </button>
                ))}
              </div>

              {channels.map((ch) => {
                const models = ch.models || [];
                const rows = [];
                for (let i = 0; i < models.length; i += 2) rows.push([models[i], models[i + 1]]);
                return (
                  <div key={ch.channel}
                       className={`fees-panel${ch.channel === active ? '' : ' hidden'}`}
                       data-feepanel={ch.channel}>
                    <ChannelAccess ch={ch} onCopy={onCopy} onCopyKey={copyCustomKey} />
                    <table>
                      <thead><tr><th>模型</th><th>倍率</th><th>模型</th><th>倍率</th></tr></thead>
                      <tbody>
                        {rows.map(([m1, m2], i) => (
                          <tr key={i}>
                            <td><ModelId m={m1} ch={ch.channel} onCopy={onCopy} /></td>
                            <td><RateCell m={m1} /></td>
                            <td><ModelId m={m2} ch={ch.channel} onCopy={onCopy} /></td>
                            <td><RateCell m={m2} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              <div className="note" style={{ marginTop: '8px' }}>{fees.disclaimer || ''}</div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn small primary" id="btnFeesClose" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
    {searchOpen ? <ModelSearch fees={fees} onClose={() => setSearchOpen(false)} onCopy={onCopy} /> : null}
    </>
  );
}
