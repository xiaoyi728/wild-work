import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import './index.css';

// D2：HashRouter。BrowserRouter 的深链刷新会打到 Go 的 404，修它就得加 SPA fallback，
// 那就动了后端 —— 本重构的唯一 Go 侧改动是 main.go 那行 embed。
createRoot(document.getElementById('root')).render(
  <HashRouter>
    <Routes>
      <Route path="/" element={<App />} />
    </Routes>
  </HashRouter>,
);
