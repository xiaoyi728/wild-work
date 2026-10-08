// 前端侧常量与枚举。这些值编码的是后端语义，改错等于改协议，逐条对账自 web/app.js。

// 渠道显示名与 CSS 短类名（后端 group / 费率 channel 均为 provider.Kind）。
export const CH_LABEL = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  traecode: 'TraeCode', qoder: 'Qoder', qodercn: 'QoderCN', qodercom: 'QoderCOM',
  qwenwork: '千问办公', glm: '智谱清言', monkeycode: 'MonkeyCode', raccoon: '小浣熊',
  loomy: 'Loomy', oczen: 'OpenCodeZen',
};
export const CH_CLASS = {
  workbuddy: 'wb', workbuddyai: 'wbai', traework: 'trae', traecode: 'traecode',
  qoder: 'qoder', qodercn: 'qodercn', qodercom: 'qodercom', qwenwork: 'qwenwork',
  glm: 'glm', monkeycode: 'monkeycode', raccoon: 'raccoon', loomy: 'loomy',
  oczen: 'oczen',
};
export const chLabel = (k) => CH_LABEL[k] || 'WorkBuddy';
export const chClass = (k) => CH_CLASS[k] || 'wb';

// 不支持显式签到（手动按钮）的渠道：国际版是自动对话保活领日活；千问办公无签到活动；
// MonkeyCode / 小浣熊 / Loomy 上游无签到端点；OpenCodeZen 匿名通道无账号概念（也无积分）。
export const NO_EXPLICIT_CHECKIN = new Set(['workbuddyai', 'qwenwork', 'monkeycode', 'raccoon', 'loomy', 'oczen']);
export const noExplicitCheckin = (g) => NO_EXPLICIT_CHECKIN.has(g);

// 导入型渠道：凭据只来自本机已登录的官方客户端，没有浏览器登录流程
// （后端 internal/app/import_local.go 读本机客户端配置文件）。
export const IMPORT_LOCAL_CHANNELS = new Set(['monkeycode', 'raccoon', 'loomy']);
export const isImportLocal = (ch) => IMPORT_LOCAL_CHANNELS.has(ch);

// 支持「浏览器授权登录」的渠道：登录期间临时把该渠道的自定义协议回调指向本工具
// 以接住授权码（AGENTS.md R41）。小浣熊同时命中导入型 —— 弹窗里给两个动作。
export const PROTOCOL_LOGIN_CHANNELS = new Set(['raccoon']);
export const hasProtocolLogin = (ch) => PROTOCOL_LOGIN_CHANNELS.has(ch);

// 积分汇总条的固定渠道顺序（与添加按钮布局一致；traecode 是别名池不单独出现，
// qoder 已下线仅存量兜底）。不在表里的渠道按字母序垫后，保证不丢行。
export const CH_SUMMARY_ORDER = ['workbuddy', 'workbuddyai', 'traework', 'qodercn', 'qodercom', 'qwenwork', 'glm', 'monkeycode', 'raccoon', 'loomy', 'oczen', 'qoder'];

// 无手动签到渠道的状态文案：国际版是「自动领日活奖励」，千问办公为「无签到」。
export const NO_CHECKIN_TAG = { workbuddyai: '自动领日活奖励', oczen: '不支持' };
export const noCheckinText = (g) => NO_CHECKIN_TAG[g] || '无签到';

// 无积分概念的渠道（匿名通道）：积分区显示「不适用」，并隐藏刷新积分/明细入口。
export const NO_CREDITS = new Set(['oczen']);

// 无手动签到渠道的登录提示差异文案。
export const NO_CHECKIN_LOGIN_HINT = {
  workbuddyai: '（无需手动签到，定时自动对话保活并领取日活奖励）',
  qwenwork: '（每日积分服务端 00:00 自动发放；若浏览器已登录千问办公则全自动完成，否则需扫码一次）',
  monkeycode: '（凭据来自本机已登录的 MonkeyCode 客户端；上游无续期接口，客户端重新登录后需再次导入）',
  raccoon: '（凭据来自本机已登录的小浣熊客户端；access_token 约 2 小时，本工具会自动续期）',
  loomy: '（凭据来自本机已登录的 Loomy 客户端；上游无续期接口，约 14 天后需重新登录并再次导入）',
  glm: '（登录后请按下方指引复制 refresh_token 粘贴回来）',
};

// 渠道上游代理列表（顺序与面板渠道序一致；旧 qoder 已下线不提供代理配置）。
export const PROXY_CHANNELS = ['oczen', 'workbuddy', 'workbuddyai', 'qodercn', 'qodercom', 'traework', 'qwenwork', 'glm', 'monkeycode', 'raccoon', 'loomy'];
export const PROXY_HINT = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  qodercn: 'QoderCN', qodercom: 'QoderCOM', qwenwork: '千问办公', glm: '智谱清言',
  monkeycode: 'MonkeyCode', raccoon: '小浣熊', loomy: 'Loomy', oczen: 'OpenCodeZen',
};

// 用量面板的渠道显示名（与 CH_LABEL 略有出入：不含 traecode，保持与现状一致）。
export const CH_NAMES = {
  workbuddy: 'WorkBuddyCN', workbuddyai: 'WorkBuddyAI', traework: 'TraeWork',
  qoder: 'Qoder', qodercn: 'QoderCN', qodercom: 'QoderCOM', qwenwork: '千问办公',
  glm: '智谱清言', monkeycode: 'MonkeyCode', raccoon: '小浣熊', loomy: 'Loomy',
  oczen: 'OpenCodeZen',
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
  monkeycode: { label: '→ monkeycode', items: ['gpt-* = monkeycode/gpt-5.2', 'claude-* = monkeycode/claude-opus-4.5'] },
  raccoon: { label: '→ raccoon (小浣熊)', items: ['gpt-* = raccoon/GLM-4.6', 'claude-* = raccoon/DeepSeek-V3.2'] },
  loomy: { label: '→ loomy', items: ['gpt-* = loomy/gpt-5.2', 'claude-* = loomy/claude-sonnet-4.5'] },
  oczen: { label: '→ oczen (匿名免费)', items: ['claude-* = oczen/mimo-v2.6-flash-free', 'gpt-* = oczen/big-pickle'] },
};

export const DETAIL_PAGE_SIZE = 8;
export const RECENT_PAGE_SIZE = 20;
export const MODEL_TOP_N = 20; // 模型榜只保留前 N 名

// 运行统计 tab 的轮询节奏（对齐上游 web/app.js）。
export const STATS_POLL_MS = 30000;  // /api/stats + /api/stats/logs
export const APPLOG_POLL_MS = 15000; // 运行日志（/api/logs）
export const APPLOG_MAX_LINES = 200; // 渲染上限（后端最多回 300 行）
export const STATS_LOGS_URL = '/api/stats/logs?limit=15';
export const STATS_TOAST_SEEN_KEY = 'stats-toast-seen'; // 里程碑 toast 已读去重

export const ledgerKinds = { earn: '↑签到/发放', spend: '↓消耗', expire: '✖过期' };

// 脱敏哨兵：后端回显形如 sk-xxx…尾4位，含省略号即代表「用户未改动」。
export const MASK_SENTINEL = '…';

// OpenCodeZen 匿名通道的固定 uid（后端硬拒其改名/停用/删除）。
export const OCZEN_ANON_UID = 'oczen-anon';

export const UNKNOWN_TIP = '上游未返回，请在客户端自行确认';
