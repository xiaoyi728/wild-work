// 渠道 → 主题色变量。逐渠道必须与 tokens.css 里三套主题各自的 --<ch> 对上。
//
// 修的是一个现存缺陷：vanilla 的 web/app.js:1423 CH_VAR 只映射了 8 个渠道、**漏了 glm**，
// 于是智谱清言的折线一直走 `cssVar(CH_VAR[ch] || "--accent")` 兜底，画出来是主色而非 --glm。
// 按计划 §4 阶段 2 那句「移植时补进映射表」，修正落在 React 侧，vanilla 不动
// （它是要留作上游融合 diff 基准的功能层）。
//
// qoder 仍在表里：旧 Qoder 渠道已从界面下线但路由保留（AGENTS.md R10），
// 存量账号的用量仍会出现在流水里，缺映射同样会掉进兜底。
export const CH_VAR = {
  workbuddy: '--wb',
  workbuddyai: '--wbai',
  traework: '--trae',
  traecode: '--traecode',
  qoder: '--qoder',
  qodercn: '--qodercn',
  qodercom: '--qodercom',
  qwenwork: '--qwenwork',
  glm: '--glm',
  monkeycode: '--monkeycode',
  raccoon: '--raccoon',
  loomy: '--loomy',
  oczen: '--oczen',
  cline: '--cline',
};

// 把 CSS 变量名解析成实际色值：echarts 只吃具体颜色，不吃 var()。
// 这是 vanilla cssVar() 的等价物，canvas 绘制与 DOM 共用同一来源，三主题自动同步。
export function cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || undefined;
}

// 未登记渠道（R66 的自定义渠道）回落 --custom：原先回落 --accent 会让自定义渠道
// 与主色混在一起，`--custom` 才是它的专色（三套主题各一值，与 CH_VAR 同源）。
export function channelColor(channel) {
  return cssVar(CH_VAR[channel] || '--custom');
}
