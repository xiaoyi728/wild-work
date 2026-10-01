import React, { useEffect, useRef, useState } from 'react';
import echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/line';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/grid';
import 'echarts/lib/component/legend';
// legend 的 type:'scroll'（图例多时翻页）在 echarts 4 是**独立组件**，不随 legend.js 一起注册。
// 现状走 CDN 全量包所以从来没暴露过这个缺口；按需引入时漏掉它的表现是运行期
// "Component legend.scroll not exists"，图例直接挂掉。
import 'echarts/lib/component/legendScroll';
import { api } from '../api.js';
import { CH_NAMES, RECENT_PAGE_SIZE, MODEL_TOP_N, ledgerKinds } from '../constants.js';
import { fmtCredits, fmtTokensFull, fmtDay, fmtEntryTime, shortUid } from '../format.js';
import { cssVar, channelColor } from '../channelColors.js';

// chartBase 返回通用配色段，调用方展开后再补自己的 type/data/series。
// echarts 4 默认文字色是深灰，在黑底暗色模式下坐标轴与图例几乎不可见，
// Paper 主题下又会与纸面撞色；因此一律从 CSS 变量显式取色，三套主题同源。
function chartBase() {
  const text = cssVar('--text') || '#1d1d1f';
  const muted = cssVar('--muted') || '#6e6e73';
  const hairline = cssVar('--hairline') || 'rgba(0, 0, 0, 0.1)';
  const lineStyle = { color: hairline };
  return {
    textStyle: { color: muted },
    tooltip: { backgroundColor: cssVar('--bg') || '#fff', borderColor: hairline, textStyle: { color: text } },
    legend: {
      type: 'scroll', textStyle: { color: muted }, pageTextStyle: { color: muted },
      pageIconColor: text, pageIconInactiveColor: hairline,
    },
    xAxis: { axisLine: { lineStyle }, axisTick: { lineStyle }, axisLabel: { color: muted } },
    yAxis: {
      axisLine: { lineStyle }, axisTick: { lineStyle },
      splitLine: { lineStyle }, axisLabel: { color: muted },
    },
  };
}

// echarts 4 的 axis tooltip 默认结构（model/Series.js formatTooltip）：
//   标题 encodeHTML(name)，每行 getTooltipMarker(color) + encodeHTML(seriesName) + ': ' + encodeHTML(addCommas(value))
// 行与标题之间用 <br/>。这里只把最后一段换成 fmtValue，其余逐字照抄，
// 否则行距/圆点尺寸一变，两张图的观感会跟着漂。
// ⚠️ 落地方式是 TooltipContent.js 的 el.innerHTML = content，所以默认实现里的 encodeHTML
// 不能省：积分图的系列名是账号备注（用户可编辑），不转义就是 XSS 入口。
const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const axisTooltip = (fmtValue) => (params) => {
  const rows = params.map((p) => (
    `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;`
    + `background-color:${escHtml(p.color)};"></span>${escHtml(p.seriesName)}: ${escHtml(fmtValue(p.value))}`
  ));
  return [escHtml(params[0] && params[0].name), ...rows].join('<br/>');
};

// 两条折线共用的骨架，只差数据与格式化器。
function buildOption(base, dates, series, fmtValue) {
  return {
    ...base,
    // valueFormatter 是 echarts 5.3+ 的选项，本仓精确锁 4.3.0，写了也不生效；
    // 4.x 要格式化数值只能接管整个 formatter（结构见上方 axisTooltip）。
    tooltip: { ...base.tooltip, trigger: 'axis', formatter: axisTooltip(fmtValue) },
    legend: { ...base.legend, data: series.map((s) => s.name) },
    grid: { left: 56, right: 20, top: 40, bottom: 28 },
    xAxis: { ...base.xAxis, type: 'category', data: dates },
    yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: fmtValue } },
    series,
  };
}

function tokenOption(st) {
  const byDay = st.token.by_day || [];
  const dates = byDay.map((d) => d.date);
  // 渠道系列：取所有出现过的渠道并集，线条颜色与该渠道徽章同源
  const chans = [...new Set(byDay.flatMap((d) => Object.keys(d.by_channel || {})))];
  const series = chans.map((ch) => {
    const c = channelColor(ch) || '#0071e3';
    return {
      name: CH_NAMES[ch] || ch, type: 'line', smooth: true,
      itemStyle: { color: c }, lineStyle: { color: c },
      data: byDay.map((d) => d.by_channel[ch] || 0),
    };
  });
  return buildOption(chartBase(), dates, series, fmtTokensFull);
}

// 积分消耗折线图：按日聚合各账号 spend（原始条目自算），
// 只画消耗总量前 10 的账号；不含入项/过期。返回 null 表示没有 spend 条目。
function creditOption(entries, names) {
  const spends = entries.filter((e) => e.kind === 'spend');
  if (!spends.length) return null;
  const dates = [...new Set(spends.map((e) => fmtDay(e.ts)))].sort();
  const byAcct = {}; // uid -> {date: spend}
  const totals = {}; // uid -> 总消耗
  for (const e of spends) {
    const d = fmtDay(e.ts);
    (byAcct[e.uid] ||= {})[d] = (byAcct[e.uid][d] || 0) + -e.amount;
    totals[e.uid] = (totals[e.uid] || 0) + -e.amount;
  }
  const top10 = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 10);
  const series = top10.map((uid) => ({
    name: names[uid] || shortUid(uid), type: 'line', smooth: true,
    data: dates.map((d) => (byAcct[uid] || {})[d] || 0),
  }));
  return buildOption(chartBase(), dates, series, fmtCredits);
}

// 一个 echarts 实例的生命周期：懒建、无数据时隐藏并 dispose、卸载时释放。
function useChart(boxRef, option) {
  const inst = useRef(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (!option) {
      // 无 spend 条目时：容器整个隐藏，并释放实例（不留着占内存与 resize 监听）
      box.style.display = 'none';
      if (inst.current) { inst.current.dispose(); inst.current = null; }
      return;
    }
    box.style.display = '';
    if (!inst.current) {
      // echarts 只追加自己的容器、不清子节点，占位文案会与画布叠在一起
      box.textContent = '';
      inst.current = echarts.init(box);
    }
    inst.current.setOption(option, true);
    inst.current.resize();
  });
  useEffect(() => () => { if (inst.current) { inst.current.dispose(); inst.current = null; } }, []);
  return inst;
}

// /api/usage 的 disabled 来自 app.ledger == nil（app.go:2263），根因是启动期 ledger.New
// 失败（main.go:248-250 只记日志、不拦启动）。**面板侧没有开关**，所以提示语不能写
// 「去设置里开启」——那是假指引。这里给一份可渲染的空骨架，让版面照常立着：
// 只把内容整块换成一句提示，会让今日/7日/30 日、刷新、四张卡、子 tab 全部消失。
const EMPTY_ST = {
  token: { total: 0, requests: 0, by_day: [], by_model: [] },
  credit: { spend: 0, earn: 0, entries: [], name_map: {} },
};

export default function Usage({ active, usageDays, setUsageDays, bump, sinceSink }) {
  // 所有 hook 必须在任何提前 return 之前调用，否则切 tab 时 hook 数量变化会崩。
  const [st, setSt] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const [subTab, setSubTab] = useState('token');
  const tokenBox = useRef(null);
  const creditBox = useRef(null);
  const tokenInst = useRef(null);
  const creditInst = useRef(null);

  // 外部（主 tab 切回用量、主题变更）也能触发重拉
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => { if (active) reload(); }, [bump, active]);
  useEffect(() => { sinceSink && sinceSink(null); }, []);

  useEffect(() => {
    let alive = true;
    api(`/api/usage?days=${usageDays}`)
      .then((d) => { if (alive) setSt(d.disabled ? { disabled: true, ...EMPTY_ST } : d); })
      .catch(() => { /* 统计加载失败不阻塞 */ });
    return () => { alive = false; };
  }, [usageDays, nonce]);

  const entries = (st && st.credit && st.credit.entries) || [];
  const names = (st && st.credit && st.credit.name_map) || {};
  const ready = st && !st.disabled;
  const tokenOpt = ready ? tokenOption(st) : null;
  const creditOpt = ready ? creditOption(entries, names) : null;

  // 无 spend 条目时容器隐藏 + dispose；有则懒建实例并 setOption
  const tI = useChart(tokenBox, tokenOpt);
  const cI = useChart(creditBox, creditOpt);
  tokenInst.current = tI.current;
  creditInst.current = cI.current;

  // 主 tab 切换 / 用量子 tab 切换 / 窗口尺寸变化 —— 四种时机都要 resize：
  // echarts 在容器 width:0（hidden）时初始化会得到空白画布，必须在它变可见后重算。
  useEffect(() => {
    if (!active) return;
    if (tI.current) tI.current.resize();
    if (cI.current) cI.current.resize();
  }, [active, subTab, st]);
  useEffect(() => {
    const on = () => { if (tI.current) tI.current.resize(); if (cI.current) cI.current.resize(); };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [tI, cI]);

  // CSS 变量变了但 echarts option 不会自动跟色，主题切换后必须重画
  useEffect(() => {
    const repaint = () => reload();
    window.addEventListener('ww-theme-change', repaint);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', repaint);
    return () => {
      window.removeEventListener('ww-theme-change', repaint);
      if (mq.removeEventListener) mq.removeEventListener('change', repaint);
    };
  }, []);

  if (!st) return <div className="muted" style={{ padding: 8 }}>加载中…</div>;

  // 角标：已记录起始日 → 天数（本地零点，避免时区漂一天）
  if (st.disabled) {
    sinceSink && sinceSink('（统计不可用）');
  } else if (st.recorded_since) {
    const d = Math.max(1, Math.round((Date.now() - new Date(st.recorded_since + 'T00:00:00')) / 86400000) + 1);
    sinceSink && sinceSink(`已记录 ${d} 天`);
  } else {
    sinceSink && sinceSink('暂无记录');
  }

  const rows = st.token.by_model || [];
  const top = rows.slice(0, MODEL_TOP_N); // 前 20 名，已按 token 降序
  const pages = Math.max(1, Math.ceil(entries.length / RECENT_PAGE_SIZE));
  const cur = Math.min(recentPage, pages - 1);
  // 倒序展示（最新在前）：从尾部往前取当前页
  const end = entries.length - cur * RECENT_PAGE_SIZE;
  const start = Math.max(0, end - RECENT_PAGE_SIZE);
  const slice = entries.slice(start, end).reverse();

  return (
    <>
      <div className="panel-head">
        <div className="pa-group">
          <div className="seg" id="usageRange">
            {[1, 7, 30].map((d) => (
              <button key={d} className={`seg-btn${usageDays === d ? ' active' : ''}`} onClick={() => setUsageDays(d)}>
                {d === 1 ? '今日' : `${d}日`}
              </button>
            ))}
          </div>
          <button className="btn small" id="btnRefreshUsage" onClick={reload}>刷新</button>
        </div>
      </div>
      {st.disabled && (
        <div className="risk-tip" style={{ marginTop: 0, marginBottom: 12 }}>
          用量统计不可用：记账目录在启动时初始化失败，因此没有流水可汇总（原因见启动日志的 ledger init failed）。
          下面各表在这一状态下始终为空。
        </div>
      )}
      <div className="usage-cards">
        <div className="ucard"><div className="ucard-label">Token 总量</div><div className="ucard-value" id="ucTokens">{fmtTokensFull(st.token.total)}</div></div>
        <div className="ucard"><div className="ucard-label">请求数</div><div className="ucard-value" id="ucReqs">{fmtCredits(st.token.requests)}</div></div>
        <div className="ucard"><div className="ucard-label">积分消耗</div><div className="ucard-value warn" id="ucSpend">{fmtCredits(st.credit.spend)}</div></div>
        <div className="ucard"><div className="ucard-label">积分入项</div><div className="ucard-value ok" id="ucEarn">{fmtCredits(st.credit.earn)}</div></div>
      </div>
      <div className="tabs">
        <button className={`tab${subTab === 'token' ? ' active' : ''}`} onClick={() => setSubTab('token')}>Token 用量</button>
        <button className={`tab${subTab === 'credit' ? ' active' : ''}`} onClick={() => setSubTab('credit')}>积分流水</button>
      </div>
      <div className={`tab-body${subTab === 'token' ? '' : ' hidden'}`} id="tabToken">
        <div id="usageChart" className="chart-box" ref={tokenBox}>图表库加载中…</div>
        <table className="table" id="tblModels">
          <thead><tr><th>模型</th><th>渠道</th><th className="num">请求数</th><th className="num">Token</th><th className="num">日均</th></tr></thead>
          <tbody>
            {top.length === 0 ? (
              <tr><td colSpan={5} className="empty-cell">暂无数据（流水自本功能上线后开始记录）</td></tr>
            ) : top.map((r, i) => {
              const avg = usageDays > 1 ? Math.round((r.pt + r.ct) / usageDays) : (r.pt + r.ct);
              return (
                <tr key={i}>
                  <td>{r.model}</td><td>{CH_NAMES[r.channel] || r.channel}</td>
                  <td className="num">{fmtCredits(r.requests)}</td>
                  <td className="num">{fmtTokensFull(r.pt + r.ct)}</td>
                  <td className="num">{fmtTokensFull(avg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={`tab-body${subTab === 'credit' ? '' : ' hidden'}`} id="tabCredit">
        <div id="creditChart" className="chart-box" ref={creditBox}>图表库加载中…</div>
        <div className="pager" id="recentPager">
          <button className="btn small" id="pgPrev" disabled={cur === 0} onClick={() => setRecentPage(cur - 1)}>‹ 上一页</button>
          <span className="pg-info" id="pgInfo">{cur + 1} / {pages}</span>
          <button className="btn small" id="pgNext" disabled={cur >= pages - 1} onClick={() => setRecentPage(cur + 1)}>下一页 ›</button>
        </div>
        <div id="recentList" className="recent">
          {slice.length ? slice.map((r, i) => (
            <div key={i} className={`rline ${r.kind}`}>
              <span className="rtime">{fmtEntryTime(r.ts)}</span>
              <span className="rkind">{ledgerKinds[r.kind] || r.kind}</span>
              <span className="ramount">{fmtCredits(r.amount)}</span>
              <span className="racct">{names[r.uid] || shortUid(r.uid)}<span className="muted"> · {CH_NAMES[r.channel] || r.channel}</span></span>
              <span className="rname">{r.note || ''}</span>
              <span className="rbal">余额 {fmtCredits(r.balance)}</span>
            </div>
          )) : <div className="muted" style={{ padding: '8px' }}>暂无流水</div>}
        </div>
      </div>
    </>
  );
}
