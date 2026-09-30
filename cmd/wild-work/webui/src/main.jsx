import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import Pet from './pet.js';

// 样式顺序即层叠顺序：tokens（主题变量）→ 视觉层（style/anim/pet）→ 局部覆盖。
// style.css/anim.css/pet.css 逐字取自 vanilla，它们读的就是 tokens.css 定义的那批变量名，
// 所以 /next/ 与 / 的观感是同一套规则算出来的，不是「照着重画一遍」。
import './tokens.css';
import './styles/style.css';
import './styles/anim.css';
import './styles/pet.css';
import './index.css';

window.Pet = Pet;

// AGENTS.md L2 的第二条硬约束，逐字落到这里：
//   Pet.init() 绝不能挂在面板主流程的初始化末尾。上游 R4 会话探针在未登录时是
//   `showLogin(); return;`，挂在它后面等于「启用面板鉴权后桌宠永不挂载」——这个坑踩过。
// React 下的等价做法是：与 App 的渲染完全分开，在自己的 microtask 里启动，
// 不共享 App 的渲染路径，也不读 App 的任何状态。未登录时 Pet 自己会安静地拿不到数据。
queueMicrotask(() => {
  try { Pet.init(); } catch (e) { console.error('pet init', e); }
});

// D2：HashRouter。BrowserRouter 的深链刷新会打到 Go 的 404，修它就得加 SPA fallback，
// 那就动了后端 —— 本重构的 Go 侧改动只有 main.go 的 embed 与一段静态挂载。
createRoot(document.getElementById('root')).render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />} />
    </Routes>
  </HashRouter>,
);
