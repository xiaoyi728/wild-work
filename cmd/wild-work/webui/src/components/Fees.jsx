import React, { useEffect, useRef, useState } from 'react';
import { chLabel, chClass, UNKNOWN_TIP } from '../constants.js';
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

// 上下文标记：只在上游接口真实返回时展示（has_context），不拿估算值充数。
function CtxTag({ m }) {
  if (!m || !m.has_context || !m.context_window) return null;
  return <> <span className="ctx-tag" title={`上下文窗口：${fmtTokens(m.context_window)} tokens`}>({fmtTokens(m.context_window)})</span></>;
}

// 能力文字摘要。措辞说明：上游未声明某能力时不自行断言其「不支持」，只说「未声明」
// ——避免把缺失信息当成否定结论。
function capText(m) {
  if (!m) return null;
  const yes = [], unknown = [];
  (m.supports_images ? yes : unknown).push('图像输入');
  (m.supports_reasoning ? yes : unknown).push('思考模式');
  const parts = [];
  if (yes.length) parts.push(`支持：${yes.join('、')}`);
  if (unknown.length) parts.push(`上游未声明：${unknown.join('、')}`);
  return parts.join('；');
}

function modelTip(m) {
  const parts = [`模型：${m.model}`];
  if (m.has_context && m.context_window) {
    parts.push(`上下文窗口：${fmtTokens(m.context_window)}`);
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

function ModelId({ m, ch, onCopy }) {
  if (!m) return null;
  // 点击复制的是「渠道/模型」完整标识（路由前缀 + 模型名），而不是裸模型名 ——
  // 光复制模型名粘到客户端里是调不通的，这是本页最容易踩的坑。
  const full = `${ch}/${m.model}`;
  return (
    <>
      <code className="fee-model-copy" title={`${modelTip(m)}\n\n点击复制：${full}`} onClick={() => onCopy && onCopy(full)}>{m.model}</code>
      <CtxTag m={m} />
      <CapIcons m={m} />
      {m.note ? <span className="rate-note" style={m.color ? { color: m.color } : undefined}> {m.note}</span> : null}
    </>
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

// 渠道费率弹层内部。L1 约束：本地是弹层、上游是页内多标签 ——
// 保留本地 feesOverlay 外壳，内部承载上游 .fees-tabs 渲染，渲染目标仍是 feesBox。
export default function Fees({ fees, state, refreshBusy, onRefresh, onCopy, onClose }) {
  const channels = (fees && fees.channels) || [];
  // 记住上次选中的渠道，重渲染后自动恢复（后台刷新不打断用户浏览）。
  const [lastCh, setLastCh] = useState(null);
  const boxRef = useRef(null);

  const active = channels.some((c) => c.channel === lastCh) ? lastCh : (channels[0] && channels[0].channel);

  // 滚动位置：现状是「渲染只改 active 类与面板可见性，不重建 DOM，避免滚动位置跳动」。
  // React 重渲染同一棵树同样不会重建，故无需额外处理，但弹层打开时容器需存在。
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; }, [active]);

  return (
    <div className="overlay" id="feesOverlay" onClick={(e) => { if (e.target.id === 'feesOverlay') onClose(); }}>
      <div className="modal" style={{ width: '920px', maxWidth: '94vw' }}>
        <div className="modal-head">
          <div className="modal-title shiny" style={{ marginBottom: 0 }}>渠道费率</div>
          <button className="btn small" id="btnRefreshFees" disabled={refreshBusy} onClick={onRefresh}>刷新费率</button>
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
  );
}
