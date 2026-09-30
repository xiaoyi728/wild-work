// 一次性推导脚本：把现有色值重述为 OKLCH，供 tokens.css 使用。
// 只保留**正向**换算（hex → oklch）。反算（oklch → hex）不自己写矩阵：
// 交给浏览器，由它实现 CSS Color 4，再用 webui/tools/verify-tokens.mjs 比对渲染结果。
// 曾经在这里手写逆向矩阵，连着错了两处系数（LMS→RGB 用成 XYZ→RGB），
// 靠 round-trip 才暴露 —— 但真正可靠的判据是浏览器渲染出的 RGB 相等。
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// Björn Ottosson 的 sRGB → OKLab 正变换
export function oklch(hex) {
  const v = hexToRgb(hex).map((x) => srgbToLinear(x / 255));
  const l = 0.4122214708 * v[0] + 0.5363325363 * v[1] + 0.0514459929 * v[2];
  const m = 0.2119034982 * v[0] + 0.6806995451 * v[1] + 0.1073969566 * v[2];
  const s = 0.0883024619 * v[0] + 0.2817188376 * v[1] + 0.6299787005 * v[2];
  const L = Math.cbrt(l), M = Math.cbrt(m), S = Math.cbrt(s);
  const a = 1.9779984951 * L - 2.428592205 * M + 0.4505937099 * S;
  const b = 0.0259040371 * L + 0.7827717662 * M - 0.808675766 * S;
  const lc = 0.2104542553 * L + 0.793617785 * M - 0.0040720468 * S;
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: lc, C, H };
}

export function fmt(o) {
  const chroma = o.C < 0.0015 ? "none" : o.C.toFixed(4);
  const hue = o.C < 0.0015 ? "" : " " + o.H.toFixed(3);
  return `oklch(${o.L.toFixed(4)} ${chroma}${hue})`;
}

// 三套主题的全部色值 token（逐字取自 cmd/wild-work/web/style.css，未改动任何一个）
export const themes = {
  light: {
    "--bg": "#f5f5f7", "--text": "#1d1d1f", "--muted": "#6e6e73",
    "--accent": "#0071e3", "--accent-hover": "#0077ed", "--danger": "#d70015",
    "--ok": "#00884f", "--warn": "#b25000", "--green": "#30d158",
    "--wb": "#0071e3", "--trae": "#0891b2", "--qoder": "#7c3aed", "--wbai": "#0d9488",
    "--traecode": "#2563eb", "--qodercn": "#6d28d9", "--qodercom": "#b45309",
    "--qwenwork": "#0e7490", "--glm": "#1d4ed8", "--oczen": "#475569",
  },
  dark: {
    "--bg": "#000", "--text": "#f5f5f7", "--muted": "#a1a1a6",
    "--accent": "#2997ff", "--accent-hover": "#4aa8ff", "--danger": "#ff453a",
    "--ok": "#30d158", "--warn": "#ff9f0a",
    "--wb": "#2997ff", "--trae": "#32ade6", "--qoder": "#9d7bff", "--wbai": "#2dd4bf",
    "--traecode": "#60a5fa", "--qodercn": "#a78bfa", "--qodercom": "#f59e0b",
    "--qwenwork": "#22d3ee", "--glm": "#60a5fa", "--oczen": "#94a3b8",
  },
  paper: {
    "--bg": "#faf9f5", "--text": "#141413", "--muted": "#5e5d59",
    "--accent": "#141413", "--accent-hover": "#3d3d3a", "--danger": "#b0403a",
    "--ok": "#5f7f4f", "--warn": "#b25e10", "--green": "#788c5d",
    "--card-hairline": "#e8e6dc", "--hairline": "#dedcd1",
    "--wb": "#6a9bcc", "--trae": "#788c5d", "--qoder": "#918bd6", "--wbai": "#5f8c85",
    "--traecode": "#6a7fb8", "--qodercn": "#7d76c4", "--qodercom": "#a06a3c",
    "--qwenwork": "#5d8a99", "--glm": "#4a6fa5", "--oczen": "#8a8a84",
  },
};

// 基准自检：白必须是 L=1 且无彩，黑必须是 L=0
const w = oklch("#ffffff"), k = oklch("#000000");
if (Math.abs(w.L - 1) > 1e-3 || w.C > 0.002 || k.L > 1e-6) {
  console.error(`✗ 基准校验失败 white L=${w.L} C=${w.C} black L=${k.L}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = [];
  for (const [name, map] of Object.entries(themes)) {
    out.push("--- " + name);
    for (const [token, hex] of Object.entries(map)) {
      out.push(`  ${token.padEnd(16)} ${hex.padEnd(8)} ${fmt(oklch(hex))}`);
    }
  }
  console.log(out.join("\n"));
  console.log("\n✓ 基准自检通过（白 L=1 无彩 / 黑 L=0）；反算正确性由浏览器验证");
}
