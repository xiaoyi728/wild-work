import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { chLabel, chClass, noExplicitCheckin, noCheckinText, NO_CREDITS, CH_SUMMARY_ORDER, DETAIL_PAGE_SIZE } from '../constants.js';
import { shortUid } from '../format.js';
import { countUp } from '../anim.js';

// 积分文案：拆「可用 / 不可用 / 临期」三个数字。
// 渠道（如 TraeWork）会下发官方客户端专用的额度池，对本工具是看得见用不了的，
// 混进一个数字会让人误判可用余额；临期是可消耗余额中阈值内到期的部分，提示优先消耗。
// 不可用仅在 >0 时显示；临期同理——凭空多个灰/红 0 很吵。
// 旧版本 state 文件（无 unusable 字段）读入后 credits_stale=true，此时不把旧值当真值，
// 改显示「待刷新」。
function Credits({ a, shownRef }) {
  if (a.credits_na) return <span className="credit-na" title="匿名通道无积分概念">不适用</span>;
  if (a.credits_stale) return <span className="credit-stale" title="余额口径已过期（旧版本状态文件），正在自动刷新…">待刷新</span>;
  const meta = [];
  if ((a.expiring_credits || 0) > 0) {
    meta.push(<span key="e" className="credit-expiring" title="临期部分在此期限内到期，调度器优先消耗">临期 {a.expiring_credits}</span>);
  }
  if ((a.unusable_credits || 0) > 0) {
    meta.push(<span key="u" className="credit-unusable" title="专用池额度，本工具无法消耗，仅用于与官网总量对账">不可用 {a.unusable_credits}</span>);
  }
  return (
    <>
      <span className="credit-main">
        <CreditValue a={a} shownRef={shownRef} />
        <span className="credit-unit">可用积分</span>
      </span>
      {meta.length ? <span className="credit-meta">{meta}</span> : null}
    </>
  );
}

// 积分数字的 Count-Up：起点为上次显示值，未变化时直接落值；「待刷新/不适用」不参与计数。
function CreditValue({ a, shownRef }) {
  const numRef = useRef(null);
  useLayoutEffect(() => {
    if (a.credits_stale || a.credits_na || !numRef.current) return;
    const target = Number(a.credits) || 0;
    numRef.current.dataset.shown = (shownRef.current[a.uid] !== undefined) ? shownRef.current[a.uid] : 0;
    countUp(numRef.current, target);
    shownRef.current[a.uid] = target;
  }, [a.credits, a.credits_stale, a.credits_na, a.uid, shownRef]);
  return <span className="credit-num" ref={numRef}>{a.credits}</span>;
}

// hover 积分区弹出的明细浮窗。条数可能很多（TraeWork 每个签到奖励都是独立条目，常见 30+），
// 故分页；翻页不重新请求（detailCache 已缓存该账号的完整响应）。
function CreditTip({ data, uid, anchorRect, onClose }) {
  const [page, setPage] = useState(0);
  const tipRef = useRef(null);
  const items = (data && data.items) || [];
  if (!items.length) return null;

  const pages = Math.max(1, Math.ceil(items.length / DETAIL_PAGE_SIZE));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(cur * DETAIL_PAGE_SIZE, (cur + 1) * DETAIL_PAGE_SIZE);

  // 有效期列仅当上游确实下发了到期时间时才出现——渠道未返回则不显示该列，
  // 避免一列全空或把「无到期信息」误读成「永不过期」。
  const hasExpiry = items.some((it) => it.expire_at);

  const usable = (data.usable_remain || 0);
  const unusable = (data.unusable_remain || 0);

  // 定位：先渲染再量尺寸，才能决定向上还是向下弹出。
  useEffect(() => {
    const tip = tipRef.current;
    if (!tip || !anchorRect) return;
    const h = tip.offsetHeight, w = tip.offsetWidth;
    let top = anchorRect.bottom + 4;
    if (top + h > window.innerHeight) top = Math.max(4, anchorRect.top - h - 4);
    let left = anchorRect.left;
    if (left + w > window.innerWidth) left = Math.max(4, window.innerWidth - w - 10);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }, [anchorRect, cur, uid]);

  // ⚠️ 两处都得显式处理，缺一处就是「不报错的界面坏掉」：
  // ① display:block —— style.css 的 .credit-tip 基础规则带 `display:none`，vanilla 靠
  //    app.js:229 的 tip.style.display="block" 点亮。移植时这个浮窗从「运行期 createElement
  //    + 手工点亮」变成「有数据才挂载的 JSX 节点」，于是按「渲染出来＝可见」的直觉把那句丢了
  //    ——节点在 DOM 里、数据也渲染了，但永久不可见，量到的 offsetHeight 也是 0。
  // ② 用 portal 挂到 document.body —— 本组件位于 `section.section` 内，而该 section 带
  //    `.reveal.revealed { transform: translateY(0) }`：入场动画的**末态仍是 transform 而非 none**
  //    （prefers-reduced-motion 下那条 .reveal{transform:none} 又被更高优先级的 .reveal.revealed 盖掉）。
  //    transform 非 none 的祖先会成为 position:fixed 后代的**包含块**，于是上面按视口坐标算出的
  //    left/top 被当作相对 section 原点使用——实测整体偏 (22, 87)、垂直方向漂 329px。
  //    vanilla 的 document.body.appendChild 恰好天然绕开这点，故这里同样落到 body。
  return createPortal(
    <div className="credit-tip" id="creditTip" ref={tipRef} style={{ display: 'block' }}
         onMouseEnter={onClose.cancel} onMouseLeave={onClose.now}>
      <div className="detail-head">
        <span className="detail-count">共 {items.length} 条</span>
        {pages > 1 ? (
          <span className="detail-pager">
            <span className={`detail-pg${cur === 0 ? ' off' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (cur > 0) { setPage(cur - 1); onClose.cancel(); } }}>‹</span>
            <span className="detail-pg-info">{cur + 1} / {pages}</span>
            <span className={`detail-pg${cur >= pages - 1 ? ' off' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (cur < pages - 1) { setPage(cur + 1); onClose.cancel(); } }}>›</span>
          </span>
        ) : null}
        <span className="detail-title">积分明细</span>
      </div>
      <table className="detail-table">
        <thead>
          <tr><th>套餐</th><th>总额</th><th>已用</th><th>剩余</th>{hasExpiry ? <th>有效期</th> : null}</tr>
        </thead>
        <tbody>
          {slice.map((it, i) => (
            <tr key={i} className={it.usable ? '' : 'detail-unusable'}>
              <td>{it.name}{it.usable ? null : <span className="detail-tag" title="该额度仅供官方客户端使用，本工具无法消耗">不可用</span>}</td>
              <td>{it.total}</td><td>{it.used}</td><td>{it.remain}</td>
              {hasExpiry ? <td>{it.expire_at || '-'}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="detail-sum">
        <span>可用 <b>{usable}</b></span>
        {/* 只在确实存在不可用额度时才拆开展示，否则保持单数字（不制造无意义的 0）。 */}
        {unusable > 0 ? <span className="detail-sum-unusable">不可用 <b>{unusable}</b></span> : null}
      </div>
    </div>,
    document.body
  );
}

function Card({ a, state, knownUids, onRename, onCheckin, onRefresh, onToggleDisable, onRemove, onDetail, onDetailLeave }) {
  const group = chClass(a.group);
  const groupName = chLabel(a.group);
  const noCheckin = noExplicitCheckin(a.group);
  const noCheckinTitle = a.group === 'workbuddyai'
    ? '无需手动签到：定时自动对话保活并领取日活奖励'
    : `${groupName} 不支持手动签到`;
  const noCredits = NO_CREDITS.has(a.group);
  const checkinFail = !!a.last_checkin_at && !a.last_checkin_ok;
  const isNew = !knownUids.has(a.uid);

  const shownRef = useRef({});
  useEffect(() => { shownRef.current = {}; }, []);

  let tag;
  if (a.last_checkin_at) {
    tag = <span className={`tag ${a.last_checkin_ok ? 'ok' : 'bad'}`}>{a.last_checkin_ok ? '签到成功' : '签到失败'}</span>;
  } else if (noCheckin) {
    tag = <span className="tag neutral" title={noCheckinTitle}>{noCheckinText(a.group)}</span>;
  } else {
    tag = <span className="tag neutral">未签到</span>;
  }

  const name = a.nickname || shortUid(a.uid);
  const oczenName = ((state && state.oczen_api_key) || '') ? '私有Key' : '匿名';

  return (
    <div className={`acct-card${a.disabled ? ' disabled' : ''}${(a.disabled || checkinFail) ? ' glow-alert' : ''}${isNew ? ' card-enter' : ''}`}
         style={isNew ? { animationDelay: (Array.from(knownUids).length % 12) * 0.06 + 's' } : undefined}>
      <div className="acct-top">
        <div>
          <span className={`badge ${group}`}>{groupName}</span>
          {noCredits
            ? <span className="acct-name">{oczenName}</span>
            : <span className="acct-name editable" title="点击修改显示名" onClick={() => onRename(a.uid, name)}>{name}</span>}
        </div>
        <div className="acct-ops">
          {noCredits ? (
            <>
              {/* 问号图标：hover 展示 oczen 通道说明。title 内换行用 &#10;，
                  字面 \n 会被部分浏览器吞掉导致无 tooltip。 */}
              <span className="icon-op help"
                    title={'关于 OpenCodeZen 通道：\n1. 本工具仅反代其免费模型（绕过官方客户端限制）；付费账号可直接使用官方端点，无需经此通道\n2. 在 OpenCodeZen 获取的 API-Key 可在设置中配置，避免匿名账号共享限额超限\n3. 配置代理后可使用有地域限制的模型，可用性取决于上游通道'}>?</span>
              <span className="icon-op off" title="固定账号，不可停用/删除">🔒</span>
            </>
          ) : (
            <>
              {noCheckin
                ? <span className="icon-op off" title={noCheckinTitle}>✓</span>
                : <span className="icon-op" title="签到" onClick={() => onCheckin(a.uid)}>✓</span>}
              <span className="icon-op" title="刷新积分" onClick={() => onRefresh(a.uid)}>↻</span>
              <span className="icon-op warn" title={a.disabled ? '启用' : '停用'}
                    onClick={() => onToggleDisable(a.uid, a.disabled)}>{a.disabled ? '▶' : '⏸'}</span>
              <span className="icon-op danger" title="删除账号" onClick={() => onRemove(a.uid)}>✕</span>
            </>
          )}
        </div>
      </div>
      <div className="acct-uid">UID: {shortUid(a.uid)}</div>
      <div className="acct-mid">
        <div className="acct-credits" data-uid={a.uid}
             onMouseEnter={noCredits ? undefined : (e) => onDetail(a.uid, e.currentTarget.getBoundingClientRect())}
             onMouseLeave={noCredits ? undefined : onDetailLeave}>
          {<Credits a={a} shownRef={shownRef} />}
        </div>
        <div className="acct-checkin">{tag}</div>
      </div>
    </div>
  );
}

// state 允许为 null（未登录 / 首帧加载中）。此时照 vanilla 的样子把整幅操作区渲染出来：
// vanilla 的面板 DOM 是静态 HTML，未登录只是不填数据、不跑 renderAccounts，
// 标签页与所有按钮都在场且可点（点了会 401 → 弹登录层，与现状一致）。
// 「还没有账号」提示则不渲染 —— 它由 renderAccounts 摘掉 hidden 才出现，未登录时不该有。
// 积分汇总条（PR #68）：按渠道把账号数 / 可用积分 / 临期 / 不可用 压成一行，
// 点渠道 chip 即筛选下方卡片，再点一次取消 —— 一眼看出「哪个渠道的钱多、哪个快过期」，
// 省得逐张卡片去扫。不计入筛选的：匿名通道（credits_na 无积分概念）与
// credits_stale（余额口径已过期，数字不可信，故单列 stale 计数而不是并进 num）。
function channelSummary(acc) {
  const map = new Map();
  for (const a of acc) {
    if (NO_CREDITS.has(a.group)) continue; // 匿名通道无积分概念，不占汇总条
    if (!map.has(a.group)) {
      map.set(a.group, { group: a.group, n: 0, num: 0, exp: 0, unu: 0, stale: 0, off: 0 });
    }
    const s = map.get(a.group);
    s.n++;
    if (a.disabled) s.off++;
    if (a.credits_na || a.credits_stale) { if (a.credits_stale) s.stale++; continue; }
    s.num += Number(a.credits) || 0;
    s.exp += Number(a.expiring_credits) || 0;
    s.unu += Number(a.unusable_credits) || 0;
  }
  const keys = [...map.keys()];
  const known = CH_SUMMARY_ORDER.filter((k) => map.has(k));
  const rest = keys.filter((k) => !CH_SUMMARY_ORDER.includes(k)).sort();
  return [...known, ...rest].map((k) => map.get(k));
}

export default function Accounts({ state, actions, knownUids }) {
  const [tipState, setTipState] = useState(null); // {uid, rect, data}
  const [filter, setFilter] = useState(null); // null = 全部；否则为渠道 key
  const cache = useRef({});
  const hideTimer = useRef(null);

  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTipState(null), 300);
  };
  const cancelHide = () => { clearTimeout(hideTimer.current); };
  hide.cancel = cancelHide;
  hide.now = () => { clearTimeout(hideTimer.current); setTipState(null); };

  const show = async (uid, rect) => {
    cancelHide();
    if (cache.current[uid]) { setTipState({ uid, rect, data: cache.current[uid] }); return; }
    try {
      const d = await api('/api/account/resource_detail', { uid });
      if (!d || !d.items || !d.items.length) return;
      cache.current[uid] = d;
      setTipState({ uid, rect, data: d });
    } catch (e) { /* 明细失败不影响卡片 */ }
  };

  const acc = state ? (state.accounts || []) : [];
  const rows = channelSummary(acc); // state 为 null 时是空数组 ⇒ 汇总条不渲染（未登录）
  const shown = filter ? acc.filter((a) => a.group === filter) : acc;
  const totals = rows.reduce((t, s) => ({ n: t.n + s.n, num: t.num + s.num }), { n: 0, num: 0 });

  return (
    <>
      <div className="panel-head">
        <div className="panel-actions-wrap">
          <div className="pa-group pa-left">
            <button className="btn primary" id="btnRefreshAll" disabled={actions.busy.refreshAll} onClick={actions.refreshAll}>刷新积分</button>
            <button className="btn" id="btnCheckinAll" disabled={actions.busy.checkinAll} onClick={actions.checkinAll}>全部签到</button>
          </div>
          <div className="pa-group pa-right">
            <button className="btn primary" id="btnAddWB" onClick={() => actions.promptLogin('workbuddy')}>＋ WorkBuddyCN</button>
            <button className="btn primary alt qodercn" id="btnAddQoderCN" onClick={() => actions.promptLogin('qodercn')}>＋ QoderCN</button>
            <button className="btn primary alt" id="btnAddTrae" onClick={() => actions.promptLogin('traework')}>＋ TraeWork</button>
            <button className="btn primary alt wbai" id="btnAddWBAI" onClick={() => actions.promptLogin('workbuddyai')}>＋ WorkBuddyAI</button>
            <button className="btn primary alt qodercom" id="btnAddQoderCOM" onClick={() => actions.promptLogin('qodercom')}>＋ QoderCOM</button>
            <button className="btn primary alt qwenwork" id="btnAddQwen" onClick={() => actions.promptLogin('qwenwork')}>＋ 千问办公</button>
            <button className="btn primary alt glm" id="btnAddGLM" title="体验渠道：仅文本对话，不支持工具调用/多模态" onClick={actions.startGLMLogin}>＋ 智谱清言</button>
            {/* 导入型渠道：凭据来自本机已登录的官方客户端，没有浏览器授权流 */}
            <button className="btn primary alt monkeycode" id="btnAddMonkeyCode" title="从本机已登录的 MonkeyCode 客户端导入凭据"
                    onClick={() => actions.promptLogin('monkeycode')}>＋ MonkeyCode</button>
            <button className="btn primary alt raccoon" id="btnAddRaccoon" title="小浣熊：可浏览器授权登录，也可从本机客户端导入"
                    onClick={() => actions.promptLogin('raccoon')}>＋ 小浣熊</button>
            <button className="btn primary alt loomy" id="btnAddLoomy" title="从本机已登录的 Loomy 客户端导入凭据"
                    onClick={() => actions.promptLogin('loomy')}>＋ Loomy</button>
          </div>
        </div>
      </div>
      {rows.length ? (
        <div className="cs-bar" id="creditSummaryBar">
          <span className="cs-title">积分汇总</span>
          <button className={`cs-chip${filter === null ? ' active' : ''}`} id="csAll"
                  onClick={() => setFilter(null)}>全部{` · ${totals.n} 个 · ${totals.num} 分`}</button>
          {rows.map((s) => (
            <button key={s.group}
                    className={`cs-chip clickable ${chClass(s.group)}${filter === s.group ? ' active' : ''}`}
                    data-wg={s.group}
                    title={[`${chLabel(s.group)}：${s.n} 个账号${s.off ? `（停用 ${s.off}）` : ''}`,
                            `可用 ${s.num} 分`,
                            s.exp ? `临期 ${s.exp} 分（优先消耗）` : null,
                            s.unu ? `不可用 ${s.unu} 分（官方客户端专用）` : null,
                            s.stale ? `${s.stale} 个余额待刷新（不计入合计）` : null].filter(Boolean).join('\n')}
                    onClick={() => setFilter(filter === s.group ? null : s.group)}>
              {`${chLabel(s.group)} · ${s.num} 分`}
              {s.exp ? <span className="cs-exp">{`临期 ${s.exp}`}</span> : null}
              {s.stale ? <span className="cs-stale">{`待刷新 ${s.stale}`}</span> : null}
            </button>
          ))}
          <span className="cs-total">{`合计 ${totals.num} 分`}</span>
        </div>
      ) : null}
      <div id="acctList" className="acct-grid">
        {shown.map((a) => (
          <Card key={a.uid} a={a} state={state} knownUids={knownUids}
                onRename={actions.openRename} onCheckin={actions.checkin} onRefresh={actions.refreshOne}
                onToggleDisable={actions.toggleDisable} onRemove={actions.removeAcct}
                onDetail={show} onDetailLeave={hide} />
        ))}
      </div>
      {/* 提示语只在该账号列表真的加载过之后才出现：vanilla 未登录时 renderAccounts
          根本不执行，#acctEmpty 一直带着 hidden 类。所以判据是「state 存在且为空」，
          不是「数组为空」——后者会让未登录页面凭空多出一行提示。 */}
      {state && !acc.length ? <div id="acctEmpty" className="empty">还没有账号，点击上方按钮添加</div> : null}
      {tipState ? <CreditTip data={tipState.data} uid={tipState.uid} anchorRect={tipState.rect} onClose={hide} /> : null}
    </>
  );
}
