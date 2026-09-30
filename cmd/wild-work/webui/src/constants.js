// 前端侧常量与枚举。这些值编码的是后端语义，改错等于改协议，逐条对账自 web/app.js。

// 渠道显示名与 CSS 短类名（后端 group / 费率 channel 均为 provider.Kind）。
export const CH_LABEL = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  traecode: 'TraeCode', qoder: 'Qoder', qodercn: 'QoderCN', qodercom: 'QoderCOM',
  qwenwork: '千问办公', glm: '智谱清言', oczen: 'OpenCodeZen',
};
export const CH_CLASS = {
  workbuddy: 'wb', workbuddyai: 'wbai', traework: 'trae', traecode: 'traecode',
  qoder: 'qoder', qodercn: 'qodercn', qodercom: 'qodercom', qwenwork: 'qwenwork',
  glm: 'glm', oczen: 'oczen',
};
export const chLabel = (k) => CH_LABEL[k] || 'WorkBuddy';
export const chClass = (k) => CH_CLASS[k] || 'wb';

// 不支持显式签到（手动按钮）的渠道：国际版是自动对话保活领日活；千问办公无签到活动；
// OpenCodeZen 匿名通道无账号概念（也无积分）。
export const NO_EXPLICIT_CHECKIN = new Set(['workbuddyai', 'qwenwork', 'oczen']);
export const noExplicitCheckin = (g) => NO_EXPLICIT_CHECKIN.has(g);

// 无手动签到渠道的状态文案：国际版是「自动领日活奖励」，千问办公为「无签到」。
export const NO_CHECKIN_TAG = { workbuddyai: '自动领日活奖励', oczen: '不支持' };
export const noCheckinText = (g) => NO_CHECKIN_TAG[g] || '无签到';

// 无积分概念的渠道（匿名通道）：积分区显示「不适用」，并隐藏刷新积分/明细入口。
export const NO_CREDITS = new Set(['oczen']);

// 无手动签到渠道的登录提示差异文案。
export const NO_CHECKIN_LOGIN_HINT = {
  workbuddyai: '（无需手动签到，定时自动对话保活并领取日活奖励）',
  qwenwork: '（每日积分服务端 00:00 自动发放；若浏览器已登录千问办公则全自动完成，否则需扫码一次）',
  glm: '（登录后请按下方指引复制 refresh_token 粘贴回来）',
};

// 渠道上游代理列表（顺序与面板渠道序一致；旧 qoder 已下线不提供代理配置）。
export const PROXY_CHANNELS = ['oczen', 'workbuddy', 'workbuddyai', 'qodercn', 'qodercom', 'traework', 'qwenwork', 'glm'];
export const PROXY_HINT = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  qodercn: 'QoderCN', qodercom: 'QoderCOM', qwenwork: '千问办公', glm: '智谱清言', oczen: 'OpenCodeZen',
};

// 用量面板的渠道显示名（与 CH_LABEL 略有出入：不含 traecode，保持与现状一致）。
export const CH_NAMES = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  qoder: 'Qoder', qodercn: 'QoderCN', qodercom: 'QoderCOM', qwenwork: '千问办公',
  glm: '智谱清言', oczen: 'OpenCodeZen',
};

// 各渠道的缺省建议映射：未绑定该渠道账号、或不知道该渠道有哪些模型时给个起点。
export const CHANNEL_PRESETS = {
  workbuddy: { label: 'Claude Code → workbuddy', items: ['claude-* = workbuddy/glm-5.2', 'claude-sonnet-* = workbuddy/kimi-k2.7'] },
  traework: { label: 'Codex → traework', items: ['gpt-5* = traework/glm-5.2', 'codex-* = traework/DeepSeek-V4-Pro'] },
  // TraeCode 与 TraeWork 共用账号，预设沿用 Codex 语义（面向代码场景的新版模型）。
  traecode: { label: 'Codex → traecode', items: ['gpt-5* = traecode/deepseek-v4.1-flash', 'codex-* = traecode/glm-5.3-flash'] },
  workbuddyai: { label: 'Claude Code → workbuddyai', items: ['claude-* = workbuddyai/deepseek-v4.1-flash'] },
  qodercn: { label: '→ qodercn', items: ['gpt-* = qodercn/glm-5.3'] },
  qodercom: { label: '→ qodercom', items: ['gpt-* = qodercom/glm-5.3'] },
  qwenwork: { label: '→ qwenwork', items: ['gpt-* = qwenwork/flash', 'claude-* = qwenwork/pro'] },
  glm: { label: '→ glm (智谱清言)', items: ['gpt-* = glm/chatglm', 'claude-* = glm/chatglm-think'] },
  oczen: { label: '→ oczen (匿名免费)', items: ['claude-* = oczen/mimo-v2.6-flash-free', 'gpt-* = oczen/big-pickle'] },
};

export const DETAIL_PAGE_SIZE = 8;
export const RECENT_PAGE_SIZE = 20;
export const MODEL_TOP_N = 20; // 模型榜只保留前 N 名

export const ledgerKinds = { earn: '↑签到/发放', spend: '↓消耗', expire: '✖过期' };

// 脱敏哨兵：后端回显形如 sk-xxx…尾4位，含省略号即代表「用户未改动」。
export const MASK_SENTINEL = '…';

// OpenCodeZen 匿名通道的固定 uid（后端硬拒其改名/停用/删除）。
export const OCZEN_ANON_UID = 'oczen-anon';

export const UNKNOWN_TIP = '上游未返回，请在客户端自行确认';
