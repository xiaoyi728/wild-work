// pet.js — 桌宠。形象严格用原图，拆成 5 张同坐标图层，只动两处：
//   黑色眼珠：平移 = 眼神，纵向压扁 = 眨眼；橙色腮红：不透明度/缩放 = 情绪。
// 数据源：/api/pulse（3s，请求计数）+ /api/state（30s，账号态）。开关存 localStorage，
// 不进 config.json —— 纯观感项，不该让 daemon 落盘。
"use strict";
const Pet = (() => {
  const LS = { on: "ww-pet-on", pos: "ww-pet-pos", mini: "ww-pet-mini" };
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

  let el, stage, pop, popBody;
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

  function build() {
    if (built) return;
    built = true;
    el = document.createElement("div");
    el.id = "pet";
    el.className = "pet";
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
        <div class="pp-actions">
          <button class="btn tiny" id="ppSide">换到左边</button>
          <button class="btn tiny" id="ppMini">收成角标</button>
          <button class="btn tiny" id="ppOff">隐藏</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    stage = el.querySelector(".pet-stage");
    pop = el.querySelector(".pet-pop");
    bindStage();
    el.querySelector("#ppMini").onclick = () => { setMini(!mini); refreshPop(); };
    el.querySelector("#ppSide").onclick = () => { dock(side === "left" ? "right" : "left", bottomPx); refreshPop(); };
    el.querySelector("#ppOff").onclick = () => setEnabled(false);
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
    if (!el || reduced()) return;

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
    const bs = b[1] + (state === "happy" ? Math.sin(ts / 120) * 0.04 : 0);
    const st = el.style;
    st.setProperty("--ex", ex.toFixed(2) + "px");
    st.setProperty("--ey", ey.toFixed(2) + "px");
    st.setProperty("--eb", eb.toFixed(3));
    st.setProperty("--bo", b[0].toFixed(2));
    st.setProperty("--bs", bs.toFixed(3));
    st.setProperty("--tilt", tilt.toFixed(2) + "deg");
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
        if (seenRequests !== null && pulse.requests > seenRequests) lastActivity = Date.now();
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
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { nextBlink = performance.now() + 1500; raf = requestAnimationFrame(frame); }
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
    if (open) refreshPop();
  }

  // 唯一实现：浮层里的「隐藏」按钮与设置弹窗都走这里，避免两处逻辑漂移。
  function setEnabled(on) {
    enabled = on;
    wls(LS.on, on ? "1" : "0");
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

  return {
    // app.js 在 loadState 之后调用；pet.js 未加载时调用方需自行判空
    init() {
      enabled = ls(LS.on, "1") === "1";
      if (!enabled) return;
      mini = ls(LS.mini, "0") === "1";
      build();
    },
    isEnabled: () => ls(LS.on, "1") === "1",
    setEnabled,
    sync,
  };
})();
// 顶层 const 不进 window，而 app.js 用 window.Pet 判空（pet.js 缺席时不得报错）——显式挂一次。
window.Pet = Pet;
