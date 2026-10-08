import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { chLabel, CH_SUMMARY_ORDER, STATS_POLL_MS, APPLOG_POLL_MS, APPLOG_MAX_LINES, STATS_LOGS_URL, STATS_TOAST_SEEN_KEY } from '../constants.js';
import { fmtTokensFull, shortUid } from '../format.js';

// 运行统计（上游 v2.5.5–v2.6.2 新增）：把服务端账本 internal/stats 的快照摊成人看的表。
// 数据全部由后端算好（platforms/models/expiry/rotation/abnormal），前端只负责排版，
// 不在前端做任何加减 —— 否则口径会和账本漂移，报表对不上就是必然。
//
// 轮询口径与上游一致：主快照 30s、请求日志 30s（限 15 条）、运行日志 15s。
// 只有 tab 激活时才轮询：/api/stats 会扫全部账本条目，不是能一直挂着打的端点。

// 小数积分：账本里 credit 是积分（1 积分 = 0.01 元），所以要保留一位小数才看得出量级。
function fmtCreditS(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '—'; // 0 值置灰：这里是「没花/没有」，不是「数据缺失」
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function fmtReqTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

// Trae 系渠道的积分是「折算值」（积分池按官方客户端口径折算），展示时标个 ≈，
// 免得拿它跟其它渠道的分一比一对比后以为口径错了。
function isTraeChannel(g) { return g === 'traework' || g === 'traecode'; }

function creditCell(g, n) {
  return <>{isTraeChannel(g) ? '≈' : ''}{fmtCreditS(n)}</>;
}

// 平台表排序：沿用渠道序，未登记渠道按字母序垫后。
function orderGroups(list) {
  const keys = list.map((r) => r.group);
  const known = CH_SUMMARY_ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !CH_SUMMARY_ORDER.includes(k)).sort();
  const pos = (k) => { const i = [...known, ...rest].indexOf(k); return i; };
  return [...list].sort((a, b) => pos(a.group) - pos(b.group));
}

// 异常等级：停用 / 冷却中 / 有错。上游用 level 三档映射颜色与文案。
const LEVEL_TEXT = { disabled: '已停用', cool: '冷却中', err: '有错误' };

function AppLog({ lines }) {
  if (!lines || !lines.length) return <div className="empty">暂无运行日志</div>;
  return (
    <pre className="st-applog" id="stApplog">
      {lines.slice(-APPLOG_MAX_LINES).map((l, i) => (
        <div key={i} className={`st-applog-line lvl-${(l.level || '').toLowerCase()}`}>
          <span className="st-applog-lvl">{l.level || ''}</span>
          <span className="st-applog-msg">{l.msg || ''}</span>
        </div>
      ))}
    </pre>
  );
}

export default function Stats({ active, onToast }) {
  const [snap, setSnap] = useState(null);
  const [rows, setRows] = useState([]);
  const [logLines, setLogLines] = useState([]);
  const seenRef = useRef(null); // 已弹过的里程碑 toast id（跨刷新持久化）

  useEffect(() => {
    if (seenRef.current === null) {
      try {
        seenRef.current = new Set(JSON.parse(localStorage.getItem(STATS_TOAST_SEEN_KEY) || '[]'));
      } catch (e) { seenRef.current = new Set(); }
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;

    const load = async () => {
      try {
        const d = await api('/api/stats');
        if (!alive) return;
        setSnap(d || null);
        // 里程碑 toast：后端每达到一个档位推一条，同一条不重复弹（localStorage 去重，
        // 换机器/清缓存后会重弹一次，属可接受）。
        const toasts = (d && d.toasts) || [];
        if (toasts.length) {
          const fresh = toasts.filter((t) => !seenRef.current.has(t.id));
          if (fresh.length) {
            fresh.forEach((t) => seenRef.current.add(t.id));
            try { localStorage.setItem(STATS_TOAST_SEEN_KEY, JSON.stringify([...seenRef.current])); } catch (e) { /* 隐私模式忽略 */ }
            const last = fresh[fresh.length - 1];
            if (onToast) onToast(`${last.title}${last.body ? '：' + last.body : ''}`);
          }
        }
      } catch (e) { /* 未登录/统计未启用：保持上一帧，不打断面板 */ }
    };
    const loadLogs = async () => {
      try {
        const d = await api(STATS_LOGS_URL);
        if (alive) setRows((d && d.rows) || []);
      } catch (e) { /* 同上 */ }
    };
    const loadAppLog = async () => {
      try {
        const d = await api('/api/logs');
        if (alive) setLogLines((d && d.lines) || []);
      } catch (e) { /* 同上 */ }
    };

    load(); loadLogs(); loadAppLog();
    const t1 = setInterval(load, STATS_POLL_MS);
    const t2 = setInterval(loadLogs, STATS_POLL_MS);
    const t3 = setInterval(loadAppLog, APPLOG_POLL_MS);
    return () => { alive = false; clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [active, onToast]);

  if (snap && snap.disabled) {
    return <div className="empty" id="stDisabled">运行统计未启用（账本数据不足，服务端未开启统计引擎）</div>;
  }
  if (!snap) return <div className="empty" id="stLoading">加载运行统计…</div>;

  const plats = orderGroups(snap.platforms || []);

  return (
    <div className="st-wrap">
      {/* 汇总：一眼看今天的量级 */}
      <div className="st-sum" id="stSum">
        <div className="ucard"><div className="ucard-label">账号</div><div className="ucard-value">{snap.total_accounts}</div></div>
        <div className="ucard"><div className="ucard-label">可用积分</div><div className="ucard-value">{fmtCreditS(snap.total_credits)}</div></div>
        <div className="ucard"><div className="ucard-label">今日消耗</div><div className="ucard-value warn">{fmtCreditS(snap.credit_out)}</div></div>
        <div className="ucard"><div className="ucard-label">累计消耗</div><div className="ucard-value">{fmtCreditS(snap.credit_out_exact)}</div></div>
        <div className="ucard"><div className="ucard-label">今日 tokens</div><div className="ucard-value">{fmtTokensFull(snap.tokens)}</div></div>
        <div className="ucard"><div className="ucard-label">今日请求</div><div className="ucard-value">{snap.reqs}</div></div>
        <div className="ucard">
          <div className="ucard-label">近 7 天临期</div>
          <div className={`ucard-value${snap.expiring_7d > 0 ? ' warn' : ''}`}>{snap.expiring_7d_accts} 个</div>
        </div>
      </div>

      {/* 平台概览：各渠道的钱与量 */}
      <div className="ucard st-card">
        <div className="ucard-label">平台概览</div>
        <table className="table" id="stPlat">
          <thead><tr>
            <th>平台</th><th className="num">账号</th><th className="num">可用积分</th>
            <th className="num">今日消耗</th><th className="num">累计消耗</th><th className="num">tokens</th>
            <th className="num">7 天内到期</th>
          </tr></thead>
          <tbody>
            {plats.map((r) => (
              <tr key={r.group}>
                <td>{chLabel(r.group)}</td>
                <td className="num">{r.accounts}</td>
                <td className={`num${r.credits ? '' : ' zero'}`}>{creditCell(r.group, r.credits)}</td>
                <td className={`num${r.credit_out ? '' : ' zero'}`}>{creditCell(r.group, r.credit_out)}</td>
                <td className={`num${r.credit_out_exact ? '' : ' zero'}`}>{creditCell(r.group, r.credit_out_exact)}</td>
                <td className={`num${r.tokens ? '' : ' zero'}`}>{fmtTokensFull(r.tokens)}</td>
                <td className={`num${r.expire_7d ? ' warn' : ' zero'}`}>{r.expire_7d || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!plats.length ? <div className="empty">暂无平台数据</div> : null}
      </div>

      {/* 使用中 / 接棒：同渠道换号链路一眼可见 */}
      <div className="ucard st-card">
        <div className="ucard-label">使用中 / 接棒</div>
        <div className="st-rot" id="stRotation">
          {(snap.rotation || []).length ? (snap.rotation || []).map((rv) => (
            <div key={rv.group} className="st-rot-row">
              <span className={`badge ${rv.group}`}>{chLabel(rv.group)}</span>
              {rv.current ? (
                <span className="st-rot-cur" title="当前正在消耗的账号">{rv.current.nickname || shortUid(rv.current.uid)}</span>
              ) : <span className="muted">当前无账号可用</span>}
              {rv.next && rv.next.length ? (
                <span className="st-rot-next" title="按积分/临期顺序排出的接棒候选">
                  {'接棒：'}{rv.next.map((n) => n.nickname || shortUid(n.uid)).join(' → ')}
                </span>
              ) : null}
            </div>
          )) : <div className="empty">暂无轮换信息</div>}
        </div>
      </div>

      {/* 最近临期：到期前先动手，不然过期即归零 */}
      <div className="ucard st-card">
        <div className="ucard-label">最近临期</div>
        <table className="table" id="stExpiry">
          <thead><tr>
            <th>账号</th><th>平台</th><th className="num">余额</th><th className="num">临期</th>
            <th>到期</th><th className="num">今日已耗</th><th className="num">可用天数</th>
          </tr></thead>
          <tbody>
            {(snap.expiry || []).map((r) => (
              <tr key={r.uid}>
                <td title={r.uid}>{r.nickname || shortUid(r.uid)}</td>
                <td>{chLabel(r.group)}</td>
                <td className="num">{creditCell(r.group, r.credits != null ? r.credits : r.amount)}</td>
                <td className="num">{fmtCreditS(r.amount)}</td>
                <td>{r.expire_at || '—'}</td>
                <td className="num">{fmtCreditS(r.today_out)}</td>
                <td className={`num${r.days_left <= 3 ? ' warn' : ''}`}>
                  {r.days_left != null ? `${r.days_left} 天` : '—'}
                  {r.burn_forecast ? <span className="muted">{` · ${r.burn_forecast}`}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!(snap.expiry || []).length ? <div className="empty">7 天内无临期账号</div> : null}
      </div>

      {/* 模型消耗：钱花在哪些模型上 */}
      <div className="ucard st-card">
        <div className="ucard-label">模型消耗</div>
        <table className="table" id="stModels">
          <thead><tr>
            <th>模型</th><th className="num">请求</th><th className="num">tokens</th><th className="num">消耗积分</th>
            <th className="num">首字延迟</th><th className="num">tok/s</th>
          </tr></thead>
          <tbody>
            {(snap.models || []).map((m) => (
              <tr key={m.model}>
                <td>{m.model}</td>
                <td className="num">{m.reqs}</td>
                <td className="num">{fmtTokensFull(m.tokens)}</td>
                <td className={`num${m.credit ? '' : ' zero'}`}>{fmtCreditS(m.credit)}</td>
                <td className={`num${m.avg_ttfb_ms ? '' : ' zero'}`}>{m.avg_ttfb_ms ? `${m.avg_ttfb_ms} ms` : '—'}</td>
                <td className={`num${m.avg_tok_per_sec ? '' : ' zero'}`}>
                  {m.avg_tok_per_sec ? `${m.avg_tok_per_sec.toFixed(1)} tok/s` : '—'}
                  {m.perf_samples ? <span className="muted">{` (${m.perf_samples})`}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!(snap.models || []).length ? <div className="empty">暂无模型用量</div> : null}
      </div>

      {/* 异常账号：被停用/冷却/报错的，单独点名 */}
      {(snap.abnormal || []).length ? (
        <div className="ucard st-card">
          <div className="ucard-label">异常账号</div>
          <table className="table" id="stAbnormal">
            <thead><tr>
              <th>账号</th><th>平台</th><th>状态</th><th>原因</th><th>恢复</th>
              <th className="num">错误数</th><th className="num">余额</th>
            </tr></thead>
            <tbody>
              {(snap.abnormal || []).map((r) => (
                <tr key={r.uid}>
                  <td title={r.uid}>{r.nickname || shortUid(r.uid)}</td>
                  <td>{chLabel(r.group)}</td>
                  <td><span className={`tag ${r.level === 'err' ? 'bad' : 'neutral'}`}>{LEVEL_TEXT[r.level] || r.level}</span></td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.until || '—'}</td>
                  <td className="num">{r.err_count || 0}</td>
                  <td className="num">{fmtCreditS(r.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 请求流水：最近 15 条，能对上「刚才那次为什么慢/为什么换号」 */}
      <div className="ucard st-card">
        <div className="ucard-label">最近请求</div>
        <table className="table" id="stLogs">
          <thead><tr>
            <th className="num">#</th><th>时间</th><th>模型</th><th>模式</th><th className="num">状态</th>
            <th className="num">首字</th><th className="num">tok/s</th><th className="num">耗时</th><th className="num">积分</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq}>
                <td className="num">{r.seq}</td>
                <td>{fmtReqTime(r.time)}</td>
                <td>{r.model || '—'}</td>
                <td>{r.mode || '—'}</td>
                <td className={`num${r.status && r.status >= 400 ? ' warn' : ''}`}>{r.status}</td>
                <td className={`num${r.ttfb_ms ? '' : ' zero'}`}>{r.ttfb_ms ? `${r.ttfb_ms} ms` : '—'}</td>
                <td className={`num${r.tok_per_sec ? '' : ' zero'}`}>{r.tok_per_sec ? r.tok_per_sec.toFixed(1) : '—'}</td>
                <td className={`num${r.total_sec ? '' : ' zero'}`}>{r.total_sec ? `${r.total_sec.toFixed(1)}s` : '—'}</td>
                <td className={`num${r.credit ? '' : ' zero'}`}>{fmtCreditS(r.credit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length ? <div className="muted" style={{ marginTop: '6px' }}>共 {rows.length} 条（上限 15）</div> : null}
        {!rows.length ? <div className="empty">暂无请求记录</div> : null}
      </div>

      {/* 运行日志：只做排版，级别配色在 style.css */}
      <div className="ucard st-card">
        <div className="ucard-label">运行日志</div>
        <AppLog lines={logLines} />
      </div>
    </div>
  );
}