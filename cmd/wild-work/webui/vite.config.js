import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 产物目录 ../web-app 是 go:embed 的唯一目标；本目录（含 node_modules）绝不 embed。
// base 用 '/next/'：迁移期 vanilla 仍占 '/'（生产在用），React 挂 /next/，
// 产物里的资源引用必须带同一前缀，否则 /assets/* 会落到 vanilla 的 FS 上 404。
// 阶段 3 收尾把 React 提到根路径时，这里改回 '/'。
const keepPlaceholder = {
  name: 'keep-embed-placeholder',
  closeBundle() {
    // emptyOutDir 会连仓库里那个 tracked 的 .gitkeep 一起清掉，
    // 而 //go:embed all:web-app 要求目录存在，否则新克隆直接编译失败。
    writeFileSync(resolve(import.meta.dirname, '../web-app/.gitkeep'), '');
  },
};

export default defineConfig({
  plugins: [react(), keepPlaceholder],
  base: '/next/',
  build: {
    outDir: '../web-app',
    emptyOutDir: true,
    sourcemap: false,
  },
});
