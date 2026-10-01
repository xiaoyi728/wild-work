// 静态自查：组件「声明的 props」与「调用点实际传的 props」是否对不上。
// 起因是一个真实崩溃：CreditValue 声明 { account } 却被调用成 <CreditValue a={...}/>，
// 运行期报 "Cannot read properties of undefined (reading 'credits')"。
// 这类错 vite/esbuild 都不报（JSX 无类型），且当时测试环境只有匿名账号（走 credits_na
// 提前 return 分支）所以一直没暴露。
//
// 判据：调用点传了某 prop，但组件签名里没有 ⇒ 组件内读到 undefined ⇒ 报错。
// 只报「传了但没声明」这一方向；「声明了但没传」多为可选 props，噪音大，忽略。
import fs from 'node:fs';
import path from 'node:path';

const root = 'src';
const files = [];
for (const d of [root, path.join(root, 'components')]) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.jsx')) files.push(path.join(d, f));
}

// 收集每个组件的签名 props：function X({ a, b }) 或 X = ({ a, b }) =>
const sigs = {};
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /(?:function\s+([A-Z]\w*)\s*\(\s*\{([^}]*)\}|const\s+([A-Z]\w*)\s*=\s*\(\s*\{([^}]*)\})/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1] || m[3];
    const body = m[2] || m[4];
    const props = body.split(',').map((p) => p.split(':')[0].trim()).filter((p) => /^[a-zA-Z]\w*$/.test(p));
    if (name && props.length) sigs[name] = new Set(props);
  }
}

// 收集调用点：<Xxx a={} b="v" ...>（含跨行）
const problems = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /<([A-Z]\w*)((?:\s+[a-zA-Z][\w:]*(?:=(?:"[^"]*"|\{[^}]*\}|'[^']*'))?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1];
    if (!sigs[name]) continue;
    const attrRe = /([a-zA-Z]\w*)=/g;
    let a;
    while ((a = attrRe.exec(m[2]))) {
      if (!sigs[name].has(a[1]) && a[1] !== 'key') {
        const line = s.slice(0, m.index).split('\n').length;
        problems.push(`${f}:${line}  <${name} ${a[1]}=...>  但 ${name} 只接收 {${[...sigs[name]].join(', ')}}`);
      }
    }
  }
}

if (problems.length) {
  console.error('✗ props 对不上：');
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ ${Object.keys(sigs).length} 个组件的调用点 props 全部对得上`);
