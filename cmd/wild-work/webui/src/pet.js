// pet.js — 桌宠。逐字 vendored 自 cmd/wild-work/web/pet.js（v2.5.4 融合后的弹簧/motif 引擎版），
// 仅改动两处：加底部 export，以及不动画内核。
//
// 为什么是 vendor 而不是"用 React 重写"：本文件是一套命令式 rAF 动画引擎
// （stepSpring 临界阻尼 + motif 随机轮换 + 手工 stepFrame 回归钩子），
// 把它塞进 React 的渲染周期只会引入重渲染与动画帧争用，而它没有任何界面数据绑定需求。
// 计划 §4 阶段 4 的判据是"逐项对账 8 键 8 态 + 内核常量"，重写会让这条对账失去基准。
//
// 原注释如下。形象严格用原图，拆成 5 张同坐标图层，只动两处：
//   黑色眼珠：平移 = 眼神，纵向压扁 = 眨眼；橙色腮红：不透明度/缩放 = 情绪。
// 两套动画引擎，localStorage ww-pet-engine 选择（改动要刷新页面才生效）：
//   legacy —— 逐帧直接写值 + CSS keyframes 出姿势（旧行为，回退用）
//   spring —— 动作只声明 target，值由临界阻尼弹簧收敛；同一状态内在若干 motif 微动作间随机轮换
// 数据源：/api/pulse（3s，请求计数）+ /api/state（30s，账号态）。开关存 localStorage，
// 不进 config.json —— 纯观感项，不该让 daemon 落盘。
"use strict";
const Pet = (() => {
  const LS = {
    on: "ww-pet-on", pos: "ww-pet-pos", mini: "ww-pet-mini",
    engine: "ww-pet-engine", motif: "ww-pet-motif", crescent: "ww-pet-crescent",
    burst: "ww-pet-burst", ring: "ww-pet-ring",
  };
  const PRIORITY = ["error", "urgent", "stale", "working", "happy", "hungry", "asleep", "idle"];
  const CN = {
    error: "生病", urgent: "临期", stale: "待刷新", working: "干活",
    happy: "开心", hungry: "缺粮", asleep: "沉睡", idle: "待机",
  };
  const PULSE_MS = 3000, STATE_MS = 30000, SLEEP_MS = 15 * 60 * 1000;
  const BLUSH = {
    idle: [.9, 1], working: [1, 1.08], happy: [1, 1.2], hungry: [.35, .98],
    urgent: [.15, .9], error: [0, .85], stale: [.8, 1], asleep: [.5, 1.02],
  };

  let el, stage, pop, popBody, eyeL, eyeR, ringSvg, ringBar, ringDots;
  let enabled = true, mini = false, built = false, open = false;
  let state = "idle", reason = "";
  let pulse = { requests: 0, lastMS: 0 };
  let seenRequests = null, lastActivity = Date.now();
  let happyUntil = 0, accounts = [];
  let gx = 0, gy = 0, tx = 0, ty = 0;
  let nextBlink = 0, blinkStart = -1, raf = 0, timers = [];
  let drag = null, suppressClick = false;
  let side = "right", bottomPx = 0;

  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const wls = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- 缓动（一次性动作与进出场用；连续量交给弹簧） ----------
  const Ease = {
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inOutCubic: (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    backOut: (p) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    smoothstep: (p) => p * p * (3 - 2 * p),
  };

  // ---------- 弹簧内核 ----------
  // 每帧把真实 delta 累加后按固定 1/120s 多次子步积分：掉帧时不失稳，慢设备上也保持同一时间感。
  const SUB = 1 / 120;
  const mk = (v) => ({ x: v, v: 0, t: v });
  function stepSpring(s, omega, zeta, dt) {
    s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - s.t)) * dt;
    s.x += s.v * dt;
    // 数值炸掉（大 delta / 非法 target）时直接吸附，宁可丢质感也不能让变量变 NaN 糊掉整只宠物
    if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = s.t; s.v = 0; }
  }
  // 各通道 (ω, ζ)：眼神要跟不上但不飘（略欠阻尼 → 急停有过冲）；身体浮动要有重量；
  // 眼睑用临界阻尼，免得回弹把眨眼变成抖眼。
  const TUNE = {
    ex: [26, .55], ey: [26, .55], tilt: [11, .8], bob: [9, .72], bx: [46, .9],
    bo: [7, 1], bs: [22, .7], eb: [30, 1], clip: [16, 1],
  };
  const spr = {};
  for (const k in TUNE) spr[k] = mk(0);
  // sqx/sqy 不进弹簧：挤压是一次性脚本，见 MOTIFS 与 pushShot
  let lastTs = 0, acc = 0, poseState = "", lastOut = {}, ringPose = "";

  // 每态静态基准（与 legacy switch 的静态值对齐，motif 只在此之上做加减法）
  const BASE = {
    idle: {}, working: { ey: 2.4, tilt: -3 }, happy: { ex: 0, ey: 0, eb: .6 },
    hungry: { ey: 3, tilt: -4 }, urgent: { ey: -2 }, error: { ex: 0, ey: 0, eb: 1.14 },
    stale: {}, asleep: { ex: 0, ey: 0, eb: .1, tilt: 8 },
  };
  // 同状态内的随机切换间隔（Q3：一个状态 ≠ 一副姿势）
  const GAP = {
    idle: [6000, 16000], working: [3000, 7000], urgent: [4000, 9000], error: [2000, 5000],
    stale: [5000, 10000], happy: [1200, 1200], hungry: [5000, 10000], asleep: [8000, 20000],
  };

  // ---------- 一次性动作脚本 ----------
  let shots = [];
  function pushShot(dur, apply) {
    if (reduced()) return;
    // t0 必须与帧循环同一时钟域：帧 ts 可能略早于本次 performance.now()，混用会让动作晚 1~2 帧
    shots.push({ t0: lastTs || performance.now(), dur, apply });
    if (shots.length > 12) shots.shift();
  }
  const blinkProfile = (p) => 1 - .92 * Math.sin(Math.PI * p);
  const doubleBlinkProfile = (p) => 1 - .92 * Math.abs(Math.sin(2 * Math.PI * p));
  // px 振幅要按画布比例折算：角标（46px）下若还用绝对像素会跳得比大图更凶
  const unit = () => (el ? (el.clientWidth || 128) / 128 : 1);
  const osc = (ms) => (2 * Math.PI) / ms;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- motif 表：一组「把各通道 target 打到哪里」的脚本 ----------
  // 定义本身无状态：每次选中时新建 st（画布比例、随机种子、航点都写在 st 上），
  // 所以同一个 motif 对象可以被多个状态安全复用。
  const BREATHE = {
    name: "breathe",
    fn: (t, s) => ({ bob: -1.6 * s.u * (1 - Math.cos(osc(4200) * t)) }),
  };
  const MOTIFS = {
    idle: [
      BREATHE,
      { name: "tilt-head", fn: (t) => ({ tilt: 8 * Ease.outCubic(Math.min(t / 700, 1)) }) },
      {
        name: "wink",
        init(s) { s.eye = Math.random() < .5 ? "L" : "R"; },
        fn(t, s) {
          if (!s.shot) { s.shot = 1; pushShot(240, (p, out) => { const v = 1 - .9 * Math.sin(Math.PI * p); if (s.eye === "L") out.ebL = v; else out.ebR = v; }); }
          return {};
        },
      },
      {
        name: "wander",
        init(s) { s.pts = [[rnd(-4, 4), rnd(-3, 3)], [rnd(-4, 4), rnd(-3, 3)]]; s.hold = rnd(900, 2000); },
        fn(t, s) { const k = Math.min(s.pts.length - 1, Math.floor(t / s.hold)); return { ex: s.pts[k][0], ey: s.pts[k][1] }; },
      },
    ],
    working: [
      { name: "focus", fn: () => ({ ex: 3, ey: -1 }) },
      { name: "scan", fn: (t) => ({ ex: 2.4 * Math.sin(osc(900) * t), ey: 2.4 + .8 * Math.cos(osc(1400) * t) }) },
      { name: "keystroke", fn: (t, s) => ({ bob: -1.2 * s.u * Math.abs(Math.sin(osc(320) * t)) }) },
    ],
    urgent: [
      { name: "plead", fn: () => ({ bo: .5, bs: 1.05, tilt: 0, ex: 2.5, ey: -1 }) },
      {
        name: "double-blink",
        fn(t, s) { if (!s.shot) { s.shot = 1; pushShot(360, (p, out) => { const v = doubleBlinkProfile(p); out.ebL = Math.min(out.ebL, v); out.ebR = Math.min(out.ebR, v); }); } return {}; },
      },
      { name: "dwell", init(s) { s.dir = Math.random() < .5 ? -1 : 1; }, fn: (t, s) => ({ ex: s.dir * 4 * Math.sin(osc(2000) * t) }) },
    ],
    error: [
      {
        name: "flinch",
        fn(t, s) { if (!s.shot) { s.shot = 1; pushShot(320, (p, out) => { const q = Math.sin(Math.PI * p); out.sqy -= .1 * q; out.sqx += .12 * q; out.bob += 1.5 * q; }); } return {}; },
      },
      { name: "tremor", fn: (t, s) => ({ bx: 1.4 * s.u * Math.sin(osc(260) * t), bo: 0 }) },
      { name: "peek", fn: () => ({ ex: 2.5, ey: 1.5, eb: .8 }) },
    ],
    stale: [
      { name: "look-around", fn: (t) => ({ ex: 4.4 * Math.sin(osc(3000) * t), ey: 1.2 * Math.cos(osc(3000) * t) }) },
      { name: "half", fn: () => ({ eb: .5, bob: -.6 }) },
      BREATHE,
    ],
    // happy 的姿势主体是一次性 hop（由 sync() 的 celebrate() 推进来），motif 只补腮红
    happy: [
      { name: "glow", fn: () => ({ bo: 1, bs: 1.2 }) },
    ],
    hungry: [
      { name: "look-down", fn: () => ({ ey: 3.2, tilt: -5 }) },
      { name: "slow-breathe", fn: (t, s) => ({ bob: -1.2 * s.u * (1 - Math.cos(osc(5200) * t)) }) },
      { name: "lookup", fn: (t) => ({ tilt: t < 600 ? -8 : -1, ey: t < 600 ? 3 : -1 }) },
    ],
    asleep: [
      { name: "deep-breathe", fn: (t, s) => ({ bob: -3 * s.u * (1 - Math.cos(osc(9000) * t)), eb: .12, tilt: 8 }) },
      {
        name: "lid-twitch",
        fn(t, s) {
          if (!s.shot) { s.shot = 1; pushShot(180, (p, out) => { const v = .1 + .3 * Math.sin(Math.PI * p); out.ebL = Math.min(out.ebL, v); out.ebR = Math.min(out.ebR, v); }); }
          return { bob: -3 * s.u * (1 - Math.cos(osc(9000) * t)), eb: .1, tilt: 8 };
        },
      },
      { name: "droop", fn: (t) => ({ tilt: 8 + 2 * Ease.outCubic(Math.min(t / 1200, 1)), eb: .08 }) },
    ],
  };

  // ---------- 引擎开关（表现层，不影响状态语义） ----------
  let engine = "spring", motifOn = true, crescentOn = false, burstOn = false, ringOn = false;
  let motif = null, motifSt = {}, motifAt = 0, motifNext = 0;

  function pickMotif(ts) {
    const list = MOTIFS[state] || MOTIFS.idle;
    let m = list[0];
    if (motifOn && list.length > 1) {
      do { m = list[Math.floor(Math.random() * list.length)]; } while (m === motif);
    }
    motif = m; motifAt = ts;
    motifSt = { u: unit(), shot: 0 };
    const g = GAP[state] || GAP.idle;
    motifNext = ts + rnd(g[0], g[1]);
    if (m.init) m.init(motifSt);
  }

  function celebrate() {
    // 与 legacy 的 CSS pet-hop 同一触发条件：状态机真把这一帧判成 happy 才弹（error/urgent 优先时不许弹）
    if (engine !== "spring" || reduced() || state !== "happy") return;
    const u = unit();
    // 弹起走抛物线、落地补一下挤压：backOut 的过冲留给弹簧通道，这里只要形状
    pushShot(1200, (p, out) => {
      out.bob -= 15 * u * 4 * p * (1 - p);
      if (p > .5) { const q = (p - .5) / .4; if (q < 1) { const s = Math.sin(Math.PI * q); out.sqy -= .1 * s; out.sqx += .1 * s; } }
    });
    if (burstOn) spawnBurst(u);
  }

  // ---------- happy 迸发粒子（默认关，D3）：纯色几何由代码生成，不新增美术资产 ----------
  let burst = [];
  function spawnBurst(u) {
    let box = el.querySelector(".pet-burst");
    if (!box) { box = document.createElement("div"); box.className = "pet-burst"; el.querySelector(".pet-art").appendChild(box); }
    for (let i = 0; i < 9; i++) {
      const sp = document.createElement("span");
      const a = rnd(0, Math.PI * 2), d = rnd(26, 46) * u;
      sp.style.opacity = "1";
      box.appendChild(sp);
      burst.push({ el: sp, t0: lastTs || performance.now(), dur: rnd(700, 1100), x: Math.cos(a) * d, y: Math.sin(a) * d * .8 - 6 * u });
    }
  }
  function tickBurst(ts) {
    for (let i = burst.length - 1; i >= 0; i--) {
      const b = burst[i], p = (ts - b.t0) / b.dur;
      if (p >= 1) { b.el.remove(); burst.splice(i, 1); continue; }
      const e = Ease.outCubic(p);
      // 只写 transform/opacity：位置靠 translate，重力用 p² 补，不碰任何布局属性
      b.el.style.transform = `translate(${(b.x * e).toFixed(1)}px, ${(b.y * e + 34 * p * p).toFixed(1)}px) scale(${(1 - .5 * p).toFixed(2)})`;
      b.el.style.opacity = (1 - Ease.smoothstep(p)).toFixed(2);
    }
    if (!burst.length) { const box = el.querySelector(".pet-burst"); if (box) box.remove(); }
  }

  // ---------- 数据环（默认关，D1 复议后补做）：签到进度弧 + 活跃账号轨道点 ----------
  // 角度是经过实测选的：body.png 在 art 坐标系里 145°~272°（左下出框那侧）被身体占住，
  // 所以只取 300°→130°（过正上方）这 190° 扇区，装饰绝不压到身上。
  // 挂在 .pet-art 内 → 靠右镜像时一起镜像，不必为两种停靠写两套角度。
  const RING = { r: 62, a0: 300, a1: 130, maxDots: 16 };
  const arcPt = (deg) => {
    const th = (deg - 90) * Math.PI / 180;
    return [64 + RING.r * Math.cos(th), 64 + RING.r * Math.sin(th)];
  };
  function arcD() {
    const p0 = arcPt(RING.a0), p1 = arcPt(RING.a1);
    const sweep = ((RING.a1 - RING.a0) + 360) % 360;
    return `M ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A ${RING.r} ${RING.r} 0 ${sweep > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  }
  // 签到日界按 UTC+8 墙钟（与不变量 18 同一口径），不能用浏览器本地时区，否则跨时区机器差一天
  const today8 = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  function checkinProgress() {
    const active = accounts.filter((a) => !a.disabled);
    const t = today8();
    const done = active.filter((a) => (a.last_checkin_at || "").slice(0, 10) === t).length;
    return { done, total: active.length };
  }
  // 只在 /api/state 更新时重绘（30s 一次），完全不进 rAF —— 环本身零逐帧开销
  function renderRing() {
    if (!ringSvg) return;
    const { done, total } = checkinProgress();
    const frac = total ? done / total : 0;
    ringBar.style.strokeDashoffset = (100 * (1 - frac)).toFixed(2);
    const live = accounts.filter((a) => !a.disabled && !a.cooling && (a.err_count || 0) < 3);
    const n = Math.min(live.length, RING.maxDots);
    while (ringDots.childNodes.length > n) ringDots.removeChild(ringDots.lastChild);
    while (ringDots.childNodes.length < n) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("class", "rk-dot");
      c.setAttribute("r", "1.9");
      ringDots.appendChild(c);
    }
    const span = ((RING.a1 - RING.a0) + 360) % 360;
    for (let i = 0; i < n; i++) {
      const p = arcPt(RING.a0 + span * ((i + 0.5) / n));
      const c = ringDots.childNodes[i];
      c.setAttribute("cx", p[0].toFixed(2));
      c.setAttribute("cy", p[1].toFixed(2));
    }
    ringSvg.dataset.tone = state === "error" ? "danger"
      : (total && done === total ? "ok" : (live.length ? "warn" : "danger"));
    if (open) refreshPop();
  }
  function buildRing() {
    if (ringSvg || !el) return;
    const d = arcD();
    el.querySelector(".pet-art").insertAdjacentHTML("beforeend",
      `<svg class="pet-ring" viewBox="0 0 128 128" aria-hidden="true">
        <path class="rk-track" d="${d}" pathLength="100"></path>
        <path class="rk-bar" d="${d}" pathLength="100" style="stroke-dasharray:100;stroke-dashoffset:100"></path>
        <g class="rk-dots"></g>
      </svg>`);
    ringSvg = el.querySelector(".pet-ring");
    ringBar = el.querySelector(".rk-bar");
    ringDots = el.querySelector(".rk-dots");
  }


  // ---------- 单一输出出口（P0）：两条引擎共用，观感差异只在上游计算 ----------
  function writeVars(o) {
    if (!el) return;
    lastOut = o;
    const st = el.style;
    st.setProperty("--ex", o.ex.toFixed(2) + "px");
    st.setProperty("--ey", o.ey.toFixed(2) + "px");
    st.setProperty("--eb", o.eb.toFixed(3));
    st.setProperty("--bo", o.bo.toFixed(2));
    st.setProperty("--bs", o.bs.toFixed(3));
    st.setProperty("--tilt", o.tilt.toFixed(2) + "deg");
    st.setProperty("--bob", o.bob.toFixed(2) + "px");
    st.setProperty("--bx", o.bx.toFixed(2) + "px");
    st.setProperty("--sq-x", o.sqx.toFixed(3));
    st.setProperty("--sq-y", o.sqy.toFixed(3));
    st.setProperty("--clip", o.clip.toFixed(3));
    // 眼睑按只写：wink/抽动的单眼脚本要能只压一只眼，容器上的 --eb 在 spring 下只是兜底
    if (eyeL) eyeL.style.setProperty("--eb", o.ebL.toFixed(3));
    if (eyeR) eyeR.style.setProperty("--eb", o.ebR.toFixed(3));
  }

  function baseVars() {
    const b = BLUSH[state] || BLUSH.idle;
    return { ex: 0, ey: 0, eb: 1, ebL: 1, ebR: 1, bo: b[0], bs: b[1], tilt: 0, bob: 0, bx: 0, sqx: 1, sqy: 1, clip: 0 };
  }

  // 降级姿态：只保留状态配色与静态姿势，motif/粒子/弹簧全停
  function staticPose() {
    const o = baseVars();
    Object.assign(o, BASE[state] || {});
    o.ebL = o.ebR = o.eb;
    return o;
  }

  function build() {
    if (built) return;
    built = true;
    el = document.createElement("div");
    el.id = "pet";
    el.className = "pet";
    if (engine === "spring") el.classList.add("eng-spring");
    if (crescentOn) el.classList.add("eng-crescent");
    if (ringOn) el.classList.add("eng-ring");
    el.setAttribute("aria-label", "桌宠");
    el.innerHTML = `
      <div class="pet-stage">
        <div class="pet-art">
          <img class="pet-layer" src="./pet/body.png" alt="" draggable="false">
          <img class="pet-layer pet-eye" id="petEyeL" src="./pet/eye-l.png" alt="" draggable="false">
          <img class="pet-layer pet-eye" id="petEyeR" src="./pet/eye-r.png" alt="" draggable="false">
          <img class="pet-layer pet-blush" id="petBlushL" src="./pet/blush-l.png" alt="" draggable="false">
          <img class="pet-layer pet-blush" id="petBlushR" src="./pet/blush-r.png" alt="" draggable="false">
        </div>
      </div>
      <div class="pet-pop hidden" id="petPop">
        <div class="pp-row"><span class="pp-k">状态</span><span class="pp-v"><b id="ppState"></b></span></div>
        <div class="pp-row"><span class="pp-k">累计请求</span><span class="pp-v" id="ppReqs">0</span></div>
        <div class="pp-row"><span class="pp-k">最近请求</span><span class="pp-v" id="ppLast">-</span></div>
        <div class="pp-row"><span class="pp-k">账号</span><span class="pp-v" id="ppAccts">-</span></div>
        <div class="pp-reason" id="ppReason"></div>
        <div class="pp-sep">动效</div>
        <div class="pp-sw"><span class="pp-k">微动作轮换</span><label class="switch"><input type="checkbox" id="swMotif"><span class="slider"></span></label></div>
        <div class="pp-sw"><span class="pp-k">笑眼</span><label class="switch"><input type="checkbox" id="swCrescent"><span class="slider"></span></label></div>
        <div class="pp-sw"><span class="pp-k">开心迸发</span><label class="switch"><input type="checkbox" id="swBurst"><span class="slider"></span></label></div>
        <div class="pp-sw"><span class="pp-k">签到数据环</span><label class="switch"><input type="checkbox" id="swRing"><span class="slider"></span></label></div>
        <div class="pp-row"><span class="pp-k">今日签到</span><span class="pp-v" id="ppCheckin">-</span></div>
        <div class="pp-actions">
          <button class="btn tiny" id="ppSide">换到左边</button>
          <button class="btn tiny" id="ppMini">收成角标</button>
          <button class="btn tiny" id="ppOff">隐藏</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    stage = el.querySelector(".pet-stage");
    pop = el.querySelector(".pet-pop");
    eyeL = el.querySelector("#petEyeL");
    eyeR = el.querySelector("#petEyeR");
    bindStage();
    el.querySelector("#ppMini").onclick = () => { setMini(!mini); refreshPop(); };
    el.querySelector("#ppSide").onclick = () => { dock(side === "left" ? "right" : "left", bottomPx); refreshPop(); };
    el.querySelector("#ppOff").onclick = () => setEnabled(false);
    // 开关只活在桌宠自己的浮层里：app.js 的触点必须仍是那 4 处 if (window.Pet)（计划 §8.7）
    const sw = { motif: "swMotif", crescent: "swCrescent", burst: "swBurst", ring: "swRing" };
    for (const k in sw) {
      el.querySelector("#" + sw[k]).onchange = (e) => { applyFlag(k, e.target.checked); };
    }
    if (ringOn) buildRing();
    loadDock();
    dock(side, bottomPx);
    if (mini) el.classList.add("mini");
    startLoops();
  }

  // ---------- 吸附到窗口左右边界 ----------
  // 原画是「从左下探进来」的构图（身体在左/下出框），所以贴哪一边就把哪一边的出框对齐：
  // 靠左 = 原图不翻转；靠右 = 水平镜像。默认靠右（与旧版位置一致）但必须镜像，
  // 否则出框边朝向屏幕内侧，看起来像从左边滑出来。
  function dock(s, b) {
    side = s === "left" ? "left" : "right";
    bottomPx = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, Math.round(b)));
    el.classList.toggle("dock-left", side === "left");
    el.classList.toggle("dock-right", side === "right");
    // 必须清掉拖拽时写上的行内 top：top/bottom 同时确定时 CSS 让 top 胜出、忽略 bottom，
    // 不清的话吸附后的高度就永远由拖拽残留值决定。
    el.style.top = "";
    el.style.left = side === "left" ? "0px" : "";
    el.style.right = side === "right" ? "0px" : "";
    el.style.bottom = bottomPx + "px";
    wls(LS.pos, JSON.stringify({ side, b: bottomPx }));
  }

  function loadDock() {
    try {
      const p = JSON.parse(ls(LS.pos, "") || "null");
      if (p) { side = p.side === "left" ? "left" : "right"; bottomPx = Number(p.b) || 0; return; }
    } catch (e) {}
    side = "right"; bottomPx = 0;
  }

  // ---------- 拖拽（自由移动，松手吸附到左右边界） ----------
  function bindStage() {
    stage.addEventListener("pointerdown", (e) => {
      const r = el.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, moved: false, left: r.left, top: r.top };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        stage.classList.add("dragging");
      }
      if (!drag.moved) return;
      drag.left += dx; drag.top += dy;
      drag.x = e.clientX; drag.y = e.clientY;
      el.style.left = Math.max(-8, Math.min(window.innerWidth - el.offsetWidth + 8, drag.left)) + "px";
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, drag.top)) + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
    });
    const end = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      stage.classList.remove("dragging");
      if (moved) {
        const r = el.getBoundingClientRect();
        // 吸附：按宠物中心离哪条竖边近来决定停靠侧
        dock(r.left + r.width / 2 < window.innerWidth / 2 ? "left" : "right",
             window.innerHeight - r.bottom);
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 200);
        return;
      }
      // 双击 = 戳一下；单击 = 开关详情浮层
      if (e.detail >= 2) { poke(); togglePop(false); return; }
      setTimeout(() => { if (!suppressClick) togglePop(); }, 220);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", () => {
      drag = null; stage.classList.remove("dragging");
    });
    window.addEventListener("pointermove", onGaze, { passive: true });
    window.addEventListener("resize", () => dock(side, bottomPx));
  }

  function poke() {
    if (reduced()) return;
    if (engine === "spring") {
      const u = unit();
      pushShot(420, (p, out) => {
        const q = Math.sin(Math.PI * p);
        if (p < .4) { out.sqx += .1 * q; out.sqy -= .12 * q; } else { out.sqx -= .06 * q; out.sqy += .08 * q; }
      });
      return;
    }
    el.classList.remove("poked");
    void el.offsetWidth;
    el.classList.add("poked");
    setTimeout(() => el.classList.remove("poked"), 420);
  }

  function togglePop(force) {
    open = force === undefined ? !open : force;
    pop.classList.toggle("hidden", !open);
    if (open) refreshPop();
  }

  function refreshPop() {
    if (!pop) return;
    el.querySelector("#ppState").textContent = CN[state] || state;
    el.querySelector("#ppReqs").textContent = pulse.requests.toLocaleString("zh-CN");
    el.querySelector("#ppLast").textContent = pulse.lastMS
      ? new Date(pulse.lastMS).toLocaleTimeString("zh-CN", { hour12: false }) : "无";
    const live = accounts.filter((a) => !a.disabled).length;
    el.querySelector("#ppAccts").textContent = `${live} 可用 / ${accounts.length} 总`;
    el.querySelector("#ppReason").textContent = reason;
    el.querySelector("#ppMini").textContent = mini ? "展开" : "收成角标";
    el.querySelector("#ppSide").textContent = side === "left" ? "换到右边" : "换到左边";
    const cp = checkinProgress();
    el.querySelector("#ppCheckin").textContent = cp.total ? `${cp.done} / ${cp.total}` : "无账号";
    el.querySelector("#swMotif").checked = motifOn;
    el.querySelector("#swCrescent").checked = crescentOn;
    el.querySelector("#swBurst").checked = burstOn;
    el.querySelector("#swRing").checked = ringOn;
  }

  // ---------- 眼神 ----------
  function onGaze(e) {
    if (!el || mini || state === "asleep") { tx = ty = 0; return; }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > 900) { tx = ty = 0; return; }
    const R = r.width * 0.035;                       // 眼珠最大行程
    const k = Math.min(1, d / 240) / d;
    // 靠右时整幅画做了 scaleX(-1)，层内正向位移在屏幕上变成反向，须取反才能盯住光标
    const flip = side === "right" ? -1 : 1;
    tx = dx * k * R * flip;
    ty = dy * k * R * 0.7;
  }

  // ---------- 状态机 ----------
  function resolve() {
    if (!el) return;
    const now = Date.now();
    const active = accounts.filter((a) => !a.disabled);
    let s = "idle", why = "";

    const cooling = active.filter((a) => a.cooling || (a.err_count || 0) >= 3);
    if (cooling.length) { s = "error"; why = `${cooling.length} 个账号在冷却或连续报错`; }
    if (s === "idle") {
      const exp = active.filter((a) => (a.expiring_credits || 0) > 0);
      if (exp.length) { s = "urgent"; why = `${exp[0].nickname || exp[0].uid} 有 ${exp[0].expiring_credits} 积分临期`; }
    }
    if (s === "idle" && active.some((a) => a.credits_stale)) { s = "stale"; why = "余额口径待刷新（旧状态文件）"; }
    // 「干活」= 最近 6 秒内有请求被派发。用时间窗而非计数差值，
    // 这样 resolve 的 1s tick 与 pulse 的 3s tick 相位不同步也不会漏判、也不会粘住不退。
    if (s === "idle" && now - lastActivity < 6000) { s = "working"; why = "有代理请求正在派发"; }
    if (s === "idle" && now < happyUntil) { s = "happy"; why = "刚完成签到/积分刷新"; }
    if (s === "idle" && active.some((a) => !a.credits_na && !a.credits_stale && (a.credits || 0) <= 0)) {
      s = "hungry"; why = "有账号余额已耗尽";
    }
    if (s === "idle" && now - lastActivity > SLEEP_MS) { s = "asleep"; why = "请求静默超过 15 分钟"; }

    if (s !== state) {
      state = s;
      reason = why;
      el.dataset.state = s;
      if (open) refreshPop();
    } else if (why !== reason) {
      reason = why;
      if (open) refreshPop();
    }
  }

  // ---------- 逐帧动画 ----------
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    tick(ts);
  }

  function tick(ts) {
    if (!el) return;
    // 环的色调跟着状态走（error→红、全签→绿）。放在 reduced 判断之前，降级时也一样更新。
    // 只在状态真的变化时重绘，不是逐帧写 DOM。
    if (ringOn && ringPose !== state) { ringPose = state; renderRing(); }
    if (reduced()) {
      // legacy 保持旧行为（降级下什么都不写，靠 CSS 默认值站成静态）；spring 给一套静态姿势
      if (engine !== "spring") return;
      if (poseState !== state) { poseState = state; writeVars(staticPose()); }
      return;
    }
    if (engine === "legacy") { tickLegacy(ts); return; }
    tickSpring(ts);
  }

  // legacy：逐帧直接赋值（旧实现，一字未改，只是把写值收敛到 writeVars）
  function tickLegacy(ts) {
    gx += (tx - gx) * 0.12;
    gy += (ty - gy) * 0.12;
    let ex = gx, ey = gy, eb = 1, tilt = 0;

    switch (state) {
      case "asleep": eb = 0.1; ex = ey = 0; tilt = 8; break;
      case "error": eb = 1.14; ex = ey = 0; break;
      case "happy": eb = 0.6; ex = ey = 0; break;
      case "hungry": ey = 3; tilt = -4; break;
      case "working":
        ex = Math.sin(ts / 70) * 2.2; ey = 2.4; tilt = -3;   // 眼珠左右快速扫动
        break;
      case "urgent":
        ex = Math.sin(ts / 90) * 4; ey = -2; tilt = Math.sin(ts / 300) * 2;
        break;
      case "stale":
        ex = Math.cos(ts / 420) * 3.2; ey = Math.sin(ts / 420) * 3.2;   // 转圈放空
        break;
    }

    if (state !== "asleep" && state !== "error") {
      if (ts >= nextBlink) { blinkStart = ts; nextBlink = ts + 2600 + Math.random() * 4600; }
      if (blinkStart > 0) {
        const p = (ts - blinkStart) / 140;
        if (p >= 1) blinkStart = -1;
        else eb = Math.min(eb, 1 - 0.92 * Math.sin(Math.PI * p));
      }
    }

    const b = BLUSH[state] || BLUSH.idle;
    const o = baseVars();
    o.ex = ex; o.ey = ey; o.eb = eb; o.tilt = tilt;
    o.bo = b[0];
    o.bs = b[1] + (state === "happy" ? Math.sin(ts / 120) * 0.04 : 0);
    o.ebL = o.ebR = o.eb;
    writeVars(o);
  }

  // spring：motif 给 target，真实值由弹簧积分；一次性脚本在积分之后覆写输出
  function tickSpring(ts) {
    // dt 必须有下限：时钟倒退（手工驱动帧、某些引擎对同帧给相同/更早的 ts）会让累加器变负，
    // 之后要跑好几秒真实时间才重新开始积分 —— 表现为「宠物突然冻住」。
    const dt = lastTs ? Math.max(0, Math.min(0.1, (ts - lastTs) / 1000)) : 0;
    lastTs = ts;

    if (state !== poseState || !motif) { poseState = state; pickMotif(ts); }
    else if (motifOn && ts >= motifNext) pickMotif(ts);
    const t = Math.max(0, ts - motifAt);

    const T = baseVars();
    T.ex = tx; T.ey = ty;                       // 未经弹簧平滑的原始视线 target，弹簧负责跟手
    Object.assign(T, BASE[state] || {});
    if (motif && motif.fn) Object.assign(T, motif.fn(t, motifSt));
    T.clip = (state === "happy" && crescentOn) ? 1 : 0;

    for (const k in TUNE) spr[k].t = T[k];
    acc += dt;
    let guard = 0;
    while (acc >= SUB && guard++ < 24) { for (const k in TUNE) stepSpring(spr[k], TUNE[k][0], TUNE[k][1], SUB); acc -= SUB; }
    if (acc >= SUB) acc = 0;

    const out = {
      ex: spr.ex.x, ey: spr.ey.x, tilt: spr.tilt.x, bob: spr.bob.x, bx: spr.bx.x,
      bo: spr.bo.x, bs: spr.bs.x, eb: spr.eb.x, clip: spr.clip.x,
      sqx: T.sqx, sqy: T.sqy,
    };
    out.eb = Math.max(0.02, out.eb);
    out.ebL = out.eb; out.ebR = out.eb;
    if (state === "happy") out.bs += 0.04 * Math.sin(ts / 120);

    if (state !== "asleep" && state !== "error" && ts >= nextBlink) {
      pushShot(140, (p, o) => { const v = blinkProfile(p); o.ebL = Math.min(o.ebL, v); o.ebR = Math.min(o.ebR, v); });
      nextBlink = ts + 2600 + Math.random() * 4600;
    }
    for (const s of shots) {
      const p = (ts - s.t0) / s.dur;
      if (p < 0) continue;
      if (p >= 1) continue;
      s.apply(p, out);
    }
    shots = shots.filter((s) => (ts - s.t0) < s.dur);

    if (burst.length) tickBurst(ts);
    writeVars(out);
  }

  // ---------- 轮询 ----------
  // 自带取数：不复用 app.js 的 api()。后者遇 401 会弹管理面板登录层并抢输入框焦点，
  // 桌宠是 3s/30s 的观感层轮询，未登录/会话失效时只该安静跳过，等登录完成后自愈。
  async function petGet(path) {
    try {
      const r = await fetch(path, { method: "GET", credentials: "same-origin" });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }

  async function pollPulse() {
    try {
      const d = await petGet("/api/pulse");
      if (d) {
        pulse.requests = d.requests || 0;
        pulse.lastMS = d.last_request_ms || 0;
        if (seenRequests !== null && pulse.requests > seenRequests) {
          lastActivity = Date.now();
          // 「干活」的点头踩在真实请求增量上，不看时间窗（判据仍归 resolve，P7）
          if (engine === "spring" && state === "working") {
            const u = unit();
            pushShot(340, (p, out) => { const q = Math.sin(Math.PI * p); out.bob += 2.6 * u * q; out.tilt += 3 * q; });
          }
        }
        seenRequests = pulse.requests;
        if (open) refreshPop();
      }
    } catch (e) { /* 后台重启等瞬时失败，下一轮自愈 */ }
    resolve();
  }

  async function pollState() {
    const d = await petGet("/api/state");
    if (d) sync(d.accounts);
  }

  function startLoops() {
    nextBlink = performance.now() + 2000;
    raf = requestAnimationFrame(frame);
    timers.push(setInterval(() => { if (!document.hidden) pollPulse(); }, PULSE_MS));
    timers.push(setInterval(() => { if (!document.hidden) pollState(); }, STATE_MS));
    timers.push(setInterval(resolve, 1000));
    pollPulse(); pollState();
    if (reduced()) writeVars(staticPose());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { nextBlink = performance.now() + 1500; lastTs = 0; acc = 0; raf = requestAnimationFrame(frame); }
    });
  }

  // ---------- 对外 ----------
  // 账号快照由 app.js 在每次 loadState 后推进来。happy 靠自行比对快照触发，
  // 这样调度器的自动签到（用户没点任何按钮）也能让桌宠有反应。
  function sync(list) {
    const next = list || [];
    const prev = {};
    accounts.forEach((a) => { prev[a.uid] = a; });
    let good = false;
    for (const a of next) {
      const p = prev[a.uid];
      if (!p) continue;
      if (a.last_checkin_ok && (a.last_checkin_at || "") > (p.last_checkin_at || "")) good = true;
      if ((a.credits || 0) > (p.credits || 0)) good = true;
    }
    accounts = next;
    if (good) happyUntil = Date.now() + 1600;
    resolve();
    if (good) celebrate();
    renderRing();
    if (open) refreshPop();
  }

  // 唯一实现：浮层里的「隐藏」按钮与设置弹窗都走这里，避免两处逻辑漂移。
  function setEnabled(on) {
    enabled = on;
    wls(LS.on, on ? "1" : "0");
    // 广播给设置弹层：那里的 chkPet 是受控输入，不通知就停在旧值（浮层「隐藏」走的是这里）。
    window.dispatchEvent(new CustomEvent("ww-pet-toggle", { detail: { on: !!on } }));
    if (on) {
      mini = ls(LS.mini, "0") === "1";
      build();
      el.classList.remove("hidden");
    } else if (el) {
      el.classList.add("hidden");
      togglePop(false);
      timers.forEach(clearInterval);
      timers = [];
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
  }

  function setMini(m) {
    mini = m;
    wls(LS.mini, m ? "1" : "0");
    if (el) el.classList.toggle("mini", m);
  }

  function readFlags() {
    engine = ls(LS.engine, "spring") === "legacy" ? "legacy" : "spring";
    motifOn = ls(LS.motif, "on") !== "off";
    crescentOn = ls(LS.crescent, "off") === "on";
    burstOn = ls(LS.burst, "off") === "on";
    ringOn = ls(LS.ring, "off") === "on";
  }

  // 浮层开关即时生效（除引擎外的四项都不用刷新）
  function applyFlag(k, on) {
    wls(LS[k], on ? "on" : "off");
    if (k === "crescent") { crescentOn = on; if (el) el.classList.toggle("eng-crescent", on); }
    else if (k === "burst") burstOn = on;
    else if (k === "motif") { motifOn = on; motifNext = 0; }
    else if (k === "ring") {
      ringOn = on;
      if (el) el.classList.toggle("eng-ring", on);
      if (on) { buildRing(); renderRing(); }
    }
  }

  return {
    // app.js 在 loadState 之后调用；pet.js 未加载时调用方需自行判空
    init() {
      readFlags();
      enabled = ls(LS.on, "1") === "1";
      if (!enabled) return;
      mini = ls(LS.mini, "0") === "1";
      build();
    },
    isEnabled: () => ls(LS.on, "1") === "1",
    setEnabled,
    sync,
    // 观感开关（ww-pet-engine / -motif / -crescent / -burst）：只写 localStorage 后刷新，
    // 桌宠零后端配置，面板不为它加控件。k 传 engine 时值取 "legacy"|"spring"，其余 "on"|"off"。
    flags: () => ({ engine, motif: motifOn, crescent: crescentOn, burst: burstOn, ring: ringOn }),
    setFlag(k, v) {
      if (k === "engine") { wls(LS.engine, v === "legacy" ? "legacy" : "spring"); location.reload(); return true; }
      const key = { motif: LS.motif, crescent: LS.crescent, burst: LS.burst, ring: LS.ring }[k];
      if (!key) return false;
      if (!built) { wls(key, v ? "on" : "off"); return true; }   // 桌宠被关掉时只落盘，下次启动生效
      applyFlag(k, !!v);
      if (open) refreshPop();
      return true;
    },
    // 回归测试钩子：本环境 document.hidden 恒 true 会冻结 rAF，只能手工驱动帧
    stepFrame: (ts) => tick(ts),
    poll: () => pollPulse(),
    channels: () => Object.assign({}, lastOut),
    motifName: () => (motif ? motif.name : ""),
    pose: () => state,
  };
})();
// 顶层 const 不进 window，而 app.js 用 window.Pet 判空（pet.js 缺席时不得报错）——显式挂一次。
window.Pet = Pet;

export default Pet;
