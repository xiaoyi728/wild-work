import React, { useEffect, useRef, useState } from 'react';
import { chLabel, chClass, UNKNOWN_TIP, MODEL_SEARCH_MAX } from '../constants.js';
import { fmtTokens } from '../format.js';

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
// 来源有两种，口径不同必须标出来：context_from_api = 上游接口返回；
// hand_measured = 本工具手工实测（cline 免费池上游根本不返回，只能实测）。
// 实测值一律带 * 并在 title 里写明来源——把实测冒充成官方声明正是 R46/issue #40 禁止的做法。
function CtxTag({ m }) {
  if (!m || !m.has_context || !m.context_window) return null;
  const src = m.hand_measured ? '本工具实测值（仅供参考，非上游官方声明）' : '上游接口返回';
  return (
    <> <span className={`ctx-tag${m.hand_measured ? ' hand' : ''}`}
               title={`上下文窗口：${fmtTokens(m.context_window)} tokens（${src}）`}>
      ({fmtTokens(m.context_window)}{m.hand_measured ? '*' : ''})
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

// 能力文字摘要。措辞说明：上游未声明某能力时不自行断言其「不支持」，只说「未声明」
// ——避免把缺失信息当成否定结论。hand_measured 时改说「实测不支持」，如实标出来源。
function capText(m) {
  if (!m) return null;
  const yes = [], unknown = [];
  (m.supports_images ? yes : unknown).push('图像输入');
  (m.supports_reasoning ? yes : unknown).push('思考模式');
  const parts = [];
  if (yes.length) parts.push(`支持：${yes.join('、')}`);
  if (unknown.length) parts.push(`${m.hand_measured ? '实测不支持' : '上游未声明'}：${unknown.join('、')}`);
  if (m.reasoning_efforts && m.reasoning_efforts.length) {
    parts.push(`思考档位：${m.reasoning_efforts.join('/')}${m.default_reasoning_effort ? `（默认 ${m.default_reasoning_effort}）` : ''}`);
  }
  if (m.hand_measured) parts.push('（能力与上下文为本工具实测值，仅供参考）');
  return parts.join('；');
}

function modelTip(m) {
  const parts = [`模型：${m.model}`];
  if (m.has_context && m.context_window) {
    const src = m.hand_measured ? '（本工具实测，非上游官方值）' : '';
    parts.push(`上下文窗口：${fmtTokens(m.context_window)}${src}`);
    if (m.max_tokens) parts.push(`最大输出：${fmtTokens(m.max_tokens)}`);
  } else {
    parts.push('上下文窗口：未知');
    parts.push('最大输出：未知');
    parts.push('（上游未提供该信息）');
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

// 费率行 / 查找行的「短名 + 完整 ID」拆分。
// ⚠️ 不能用「模型名里含 / 就当作已带渠道前缀」这个判据（上游 330ee79 的写法）：
// internal/server/handler.go:runtimeForModel 用 SplitN(model, "/", 2) 切**第一个**斜杠，
// 所以 Cline 的 `cline-free/grok-4` 必须写成 `cline/cline-free/grok-4` 才路由得到；
// 按上游那判据复制出来的是 `cline-free/grok-4` ⇒ 渠道被解析成 "cline-free"，
// 直接 `provider "cline-free" is not configured`，正是本页注释警告的那个坑。
// 而 m.model 来自 /api/fees，本就是「该渠道内的模型名」，渠道由 ch.channel 给出，
// 故前缀一律补上、短名一律不剥。
// 唯一的例外是「裸名自己就以渠道前缀开头」——上游 R52 定的契约，防重复拼接
// （否则已带双层路径的名字会被拼成 `cline/cline/cline-free/*`）。
export function modelIds(ch, raw) {
  return { short: raw, full: ch && !raw.startsWith(`${ch}/`) ? `${ch}/${raw}` : raw };
}

function ModelId({ m, ch, onCopy }) {
  if (!m) return null;
  // 点击复制的是「渠道/模型」完整标识（路由前缀 + 模型名），而不是裸模型名 ——
  // 光复制模型名粘到客户端里是调不通的，这是本页最容易踩的坑。
  const { short, full } = modelIds(ch, m.model);
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
      const { short, full } = modelIds(ch.channel, m.model);
      out.push({ ch: ch.channel, m, short, full });
    }
  }
  return out;
}

// 模型查找弹层：按关键字（模型名 / 渠道 / 完整 ID）即时过滤，点击复制完整模型 ID。
// 关键字同时匹配裸名与完整 ID —— 两处都含渠道名，故搜渠道亦可。
// 结果限量、超出只提示不纵向滚动，配合固定高度的 .modal-search，避免对话框随结果跳变。
function ModelSearch({ fees, onClose, onCopy }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const all = collectAllModels(fees);
  const kw = String(q || '').trim().toLowerCase();
  const hit = kw ? all.filter((x) => x.full.toLowerCase().includes(kw) || x.short.toLowerCase().includes(kw)) : all;
  const shown = hit.slice(0, MODEL_SEARCH_MAX);
  const hidden = hit.length - shown.length;

  const foot = !all.length ? ''
    : hit.length === 0 ? '无匹配'
      : hidden > 0
        ? (kw ? `命中 ${hit.length} 个，仅显示前 ${shown.length} 个，还有 ${hidden} 个未显示，请细化关键字`
              : `共 ${hit.length} 个模型，仅显示前 ${shown.length} 个，输入关键字可缩小范围`)
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
export default function Fees({ fees, state, refreshBusy, onRefresh, onCopy, onClose }) {
  const channels = (fees && fees.channels) || [];
  // 记住上次选中的渠道，重渲染后自动恢复（后台刷新不打断用户浏览）。
  const [lastCh, setLastCh] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const boxRef = useRef(null);

  const active = channels.some((c) => c.channel === lastCh) ? lastCh : (channels[0] && channels[0].channel);

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
