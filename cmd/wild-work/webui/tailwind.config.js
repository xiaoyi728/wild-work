/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // 阶段 2 才做设计 token；此处先保证 dark 不与现有 data-theme 机制并存。
  darkMode: 'class',
  theme: { extend: {} },
  corePlugins: { preflight: false },
  plugins: [],
};
