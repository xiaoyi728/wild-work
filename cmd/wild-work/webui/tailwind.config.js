/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // 主题**只由 tokens.css 的自定义属性驱动**（:root + prefers-color-scheme + data-theme=paper）。
  // 这里显式关掉 tailwind 的 dark 变体：它要么按 class 要么按 media，两套机制并存时
  // paper 主题无法映射，会出现「dark: 生效但 paper 不跟」的静默错位。
  // 计划 §4 阶段 2 的「二选一，不并存」取后者。
  darkMode: false,
  theme: { extend: {} },
  // preflight 关掉：它会重置本项目已有的 Apple/Paper 视觉层元素默认样式
  corePlugins: { preflight: false },
  plugins: [],
};
