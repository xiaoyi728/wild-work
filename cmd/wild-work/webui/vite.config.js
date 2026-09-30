import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 产物目录 ../web-app 是 go:embed 的唯一目标；本目录（含 node_modules）绝不 embed。
// base 用 '/'：Go 静态挂在 /，资源以 /assets/* 取。
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../web-app',
    emptyOutDir: true,
    sourcemap: false,
  },
});
