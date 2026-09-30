/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // 主题**只由 tokens.css 的自定义变量驱动**（:root + prefers-color-scheme + data-theme=paper），
  // 因此不写 darkMode 键、不使用任何 dark: 变体：tailwind 的 dark 要么按 class 要么按 media，
  // 与本仓三主题机制并存时 paper 无法映射，会出现「dark: 生效但 paper 不跟」的静默错位。
  // （试过 darkMode:false，tailwind 明确警告它已等同 media，起不到关闭作用；
  //   真正的约束由 internal/app/web_theme_tokens_test.go 扫源码里不得出现 dark: 来兜。）
  theme: { extend: {} },
  // preflight 关掉：它会重置本项目已有的 Apple/Paper 视觉层元素默认样式
  corePlugins: { preflight: false },
  plugins: [],
};
