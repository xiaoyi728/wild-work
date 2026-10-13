import { fmtTokensFull } from '../format.js';

// cacheRate 把后端约定换算成三态，Usage（Token 用量表/汇总卡）与 Stats（模型消耗表）
// 共用同一个实现，避免「哪一侧把『不知道』画成 0%」这种分叉。
//   cr_cov > 0 → 有上报样本，返回百分比（0% 是「真没命中」，如实显示）
//   cr_cov = 0 → 上游不提供该维度（glm / raccoon / loomy 等），返回 null → 调用方画「—」
// 依据见 internal/server/cacheusage.go：reported=false 与 cached=0 是两种结果，
// 混同会误导用户去优化一个上游根本不回报的指标。
export function cacheRate(row) {
  const cov = Number(row && row.cr_cov) || 0;
  if (cov <= 0) return null;
  const hit = Number(row.cr) || 0;
  const pct = (hit / cov) * 100;
  return {
    pct,
    // 样本量少时刻意多给一位小数：单次请求的命中率很可能不代表稳态
    shown: (pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)) + '%',
    title: `命中 ${fmtTokensFull(hit)} / 上报请求 prompt ${fmtTokensFull(cov)}`
      + `（${Number(row.cr_reqs) || 0} 次上报请求）；未上报的渠道不计入分母`,
  };
}

// 无样本时的统一措辞：不说 0%，也不留空白让人以为数据还在加载。
export const cacheNoneTitle = '上游不提供缓存命中字段（本工具不做估算）';
