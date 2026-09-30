// 生成一个自校验页面：让浏览器自己把每个 hex 与对应 oklch 渲染成 RGB 并比对。
// 为什么不用 Node 里的矩阵做判据：CSS Color 4 的实现以浏览器为准，我手写的逆向矩阵
// 已经错过两次系数。浏览器说相等，才算相等。
// 用法：node tools/verify-tokens.mjs && 打开 /tmp/verify-tokens.html
import fs from "node:fs";
import { themes, oklch, fmt } from "./derive-tokens.mjs";

const seen = new Map();
for (const map of Object.values(themes)) {
  for (const hex of Object.values(map)) {
    const o = fmt(oklch(hex));
    if (!seen.has(hex)) seen.set(hex, o);
  }
}
const pairs = [...seen].map(([hex, ok]) => [hex, ok]);

const html = `<!doctype html>
<meta charset="utf-8">
<title>token oklch verify</title>
<style>
  body { font: 12px/1.6 ui-monospace, monospace; margin: 2em; }
  i { display:inline-block; width:20px; height:20px; border:1px solid #999; vertical-align:-4px; margin-right:6px; }
  .bad { color:#b3261e; font-weight:700; background:#ffecec; }
  #verdict { font-size:18px; font-weight:700; }
</style>
<h3 id="verdict">…</h3>
<div id="out"></div>
<script>
const P = ${JSON.stringify(pairs)};
// 三层都要对，缺一不可：
//  1) getComputedStyle 比不了 —— CSS Color 4 里 oklch 的计算值仍是 oklch，只到
//     used-value 才转 sRGB（第一版据此误判 51/51 FAIL）。
//  2) fillStyle 的 getter 也比不了 —— 这个浏览器原样回显 "oklch(...)" 字符串。
//  3) 只有真正画一个像素再读回来，才强迫它完成到 sRGB 的转换。
// 另外必须门禁 CSS.supports：若浏览器根本不支持 oklch，fillStyle 赋值会被静默忽略，
// 两侧都停在同一个兜底色上 ⇒ 假绿。不支持就判 FAIL，不判通过。
if (!CSS.supports("color", "oklch(0.5 0.1 120)")) {
  document.getElementById("verdict").textContent = "FAIL: 本浏览器不支持 oklch，比对无意义";
  window.__result = { total: 0, bad: [{ hex: "-", ok: "-", a: "unsupported", b: "unsupported" }] };
} else {
const c = document.createElement("canvas");
c.width = 1; c.height = 1;
const g = c.getContext("2d", { willReadFrequently: true });
function srgb(v) {
  g.fillStyle = "rgb(0,0,0)";
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = v;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
function delta(a, b) { return Math.max(...a.map((x, i) => Math.abs(x - b[i]))); }
const bad = [];
const rows = P.map(([hex, ok]) => {
  const a = srgb(hex), b = srgb(ok);
  const e = delta(a, b);
  if (e > 0) bad.push({ hex, ok, a: a.join(","), b: b.join(","), e });
  return '<p class="' + (e ? "bad" : "") + '"><i style="background:' + hex + '"></i>' +
    '<i style="background:' + ok + '"></i>' + hex.padEnd(8) + " rgb(" + a.join(",") + ")" +
    " vs " + ok.padEnd(30) + " rgb(" + b.join(",") + ")  " + (e ? "✗ 差 " + e : "✓") + "</p>";
});
document.getElementById("out").innerHTML = rows.join("");
document.getElementById("verdict").textContent = bad.length
  ? "FAIL: " + bad.length + "/" + P.length + " 像素不一致（最大通道差 " + Math.max(...bad.map(x => x.e)) + "）"
  : "PASS: 全部 " + P.length + " 对 hex/oklch 画出来的像素逐通道相等";
document.title = document.getElementById("verdict").textContent;
window.__result = { total: P.length, bad: bad };
}
</script>`;

fs.writeFileSync("/tmp/verify-tokens.html", html);
console.log(`唯一色值 ${pairs.length} 对 → /tmp/verify-tokens.html`);
