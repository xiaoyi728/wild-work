// 格式化函数，逐条对账自 web/app.js。

export function shortUid(uid) {
  if (!uid) return '';
  return uid.length <= 12 ? uid : uid.slice(0, 6) + '…' + uid.slice(-4);
}

// fmtTokens 把 token 数格式化为 1M / 192k 形式。
export function fmtTokens(n) {
  if (!n) return '-';
  if (n >= 1000000 && n % 1000000 === 0) return `${n / 1000000}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function fmtCredits(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('zh-CN');
}

export function fmtTokensFull(n) {
  if (!n) return '0';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return Number(n).toLocaleString('zh-CN');
}

// fmtDay 时间戳 → "09-21"（与 token 图 X 轴口径一致）
export function fmtDay(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtEntryTime(ts) {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// isLoopbackHost 判定是否「仅本机可访问」：环回 IP / localhost。
// 对应后端 config.Listen.IsLoopback：**显式写环回才算安全**，空主机名视为对外暴露。
export function isLoopbackHost(h) {
  const s = (h || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (s === 'localhost') return true;
  return s === '127.0.0.1' || s === '::1' || /^127\./.test(s);
}

// 通配监听写法：与后端 config.Listen 归一化口径保持一致，
// 空/`::` 等通配写法按「全部网卡」看待（即对外暴露）。
export const isWildcardHost = (h) => h === '0.0.0.0' || h === '' || h === '::';

// parseTokens 解析自定义渠道模型容量输入里的 k/M 单位（"1M"→1000000、"64k"→64000），
// 纯数字原样返回；空/非法回落 fallback。与后端 custom 包的解析同源（R66）。
export function parseTokens(str, fallback = 0) {
  if (str === undefined || str === null || str === '') return fallback;
  if (typeof str === 'number') return str;
  const s = String(str).trim();
  if (!s) return fallback;
  const upper = s.toUpperCase();
  let mult = 1;
  let numStr = upper;
  if (upper.endsWith('M')) { mult = 1000000; numStr = upper.slice(0, -1).trim(); }
  else if (upper.endsWith('K')) { mult = 1000; numStr = upper.slice(0, -1).trim(); }
  const n = parseFloat(numStr);
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.round(n * mult);
}

// formatTokenCount 反向格式化：优先整数 k/M（1M、64k），非整除时保留一位小数。
export function formatTokenCount(num) {
  if (!num) return '—';
  if (num >= 1000000 && num % 100000 === 0) return `${num / 1000000}M`;
  if (num >= 1000 && num % 1000 === 0) return `${num / 1000}k`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(num);
}
