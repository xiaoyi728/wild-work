import React, { useEffect, useRef, useState } from 'react';
// echarts 4 的按需形态：没有 echarts/core，也没有 use()，靠副作用 import 自行注册。
// 版本精确锁 4.3.0 —— 与现状 CDN 同版，阶段 3 那 8 项图表交互才是在同一行为上对账，
// 不是"升级到 4.x 最新再回归"。echarts 的 package.json 无 main/module/exports 字段，
// 所以必须走 lib/ 子路径，裸 "echarts/core" 解析不到。
import echarts from 'echarts/lib/echarts';
import 'echarts/lib/chart/line';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/grid';
import 'echarts/lib/component/legend';
import { api } from './api';

// 骨架阶段就挂一张真图：体积判据要求 echarts 真的进产物，否则阶段 1 的数是假的。
function Probe({ state }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current) return;
    const chart = echarts.init(box.current);
    chart.setOption({
      xAxis: { type: 'category', data: state.accounts.map((_, i) => `#${i + 1}`) },
      yAxis: { type: 'value' },
      series: [{ type: 'line', smooth: true, data: state.accounts.map((a) => a.credits) }],
    });
    return () => chart.dispose();
  }, [state]);
  return <div ref={box} style={{ width: '100%', height: 180 }} />;
}

export default function App() {
  const [probe, setProbe] = useState(null);
  const [state, setState] = useState(null);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/auth/state').then(setProbe).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!probe) return;
    if (probe.auth_enabled && !probe.auth_session) return; // 等登录
    api('/api/state').then(setState).catch((e) => setErr(e.message));
  }, [probe]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      await api('/api/auth/login', { password: pass });
      setProbe({ ...probe, auth_session: 'ok', auth_enabled: true });
    } catch (ex) {
      setErr(ex.message);
    }
  }

  if (err && !state) return <p className="err">{err}</p>;
  if (probe && probe.auth_enabled && !probe.auth_session) {
    return (
      <form onSubmit={submit} className="login">
        <p>面板已启用管理密码（R4）</p>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button type="submit">登录</button>
        {err ? <p className="err">{err}</p> : null}
      </form>
    );
  }
  if (!state) return <p>加载中…</p>;
  return (
    <div className="shell">
      <h1>wild-work {state.version}</h1>
      <p>
        账号 {state.accounts.length} · 监听 {state.listen_host}:{state.listen_port} ·{' '}
        临期阈值 {state.expiring_days} 天 · 渠道 {state.compat.channels.length}
      </p>
      <Probe state={state} />
    </div>
  );
}
