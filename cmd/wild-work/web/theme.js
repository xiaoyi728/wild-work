// theme.js — Paper 主题切换（纯 UI，选择记忆在 localStorage，不触碰任何业务逻辑）
"use strict";
(() => {
  const KEY = "ww-theme";
  const btn = document.getElementById("btnTheme");
  if (!btn) return;

  function paint(t) {
    if (t === "paper") document.documentElement.dataset.theme = "paper";
    else delete document.documentElement.dataset.theme;
    btn.textContent = t === "paper" ? "原" : "纸";
    btn.title = t === "paper" ? "恢复默认主题" : "切换 Paper（象牙纸感）主题";
  }

  let cur = "auto";
  try { cur = localStorage.getItem(KEY) || "auto"; } catch (e) {}
  paint(cur);

  btn.addEventListener("click", () => {
    cur = document.documentElement.dataset.theme === "paper" ? "auto" : "paper";
    try { localStorage.setItem(KEY, cur); } catch (e) {}
    paint(cur);
    // 图表取色来自 CSS 变量，需 app.js 重画（首屏无监听者，故只在手动切换时派发）
    window.dispatchEvent(new Event("ww-theme-change"));
  });
})();
