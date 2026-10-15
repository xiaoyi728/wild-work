// constants.go OpenCodeZen 匿名免费通道的常量与静态模型目录。
//
// 渠道特性（2026-09 实测，见 docs/opencodezen渠道接入备忘.md）：
//   - 匿名凭证是字面量 "public"（Authorization: Bearer public），无需登录、无 token 轮换；
//   - 上游免费档有五道校验，缺一即 403 FreeTierError（2026-10-15 单变量实测复核）：
//     ① 对话端点须是 **/inference/v1**，/zen/v1 即便其余全对也 403
//     （模型目录两个前缀都仍返回 200，故面板看起来是好的）；
//     ② 会话头须匹配官方外形 ses_<12位小写hex><14位Base62>，且 12 位 hex 段是官方
//     Identifier.descending() 编码（~(unix_ms<<12|counter) 取低 48 位，末三位
//     0xFFF-counter）；摘要段/随机 hex 即便外形正确也被拒；
//     ③ **不得携带 x-session-affinity / X-Session-Id**（2026-10-15 起带了就 403，
//     与 2026-09 的实测相反——那时缺它们反而降概率）；
//     ④ 回合头 x-opencode-request 须是铸造形状 msg_<12位小写hex><14位Base62>
//     （`req_`+hex 或 `msg_`+随机串一律 403）；
//     ⑤ 请求体须为「智能体形态」：stream=true 且 tools 内同时含 bash 与 read 两个
//     function，且各自 parameters 至少声明一个 property（空 properties 被拒）；
//     另有 User-Agent 须含 `opencode/<version>` 记号（`dsh/…` 实测被拒）。
//   - 匿名通道未观测到请求数配额（1900+ 次、峰值 230 req/min、64 并发均无 429），
//     唯一约束是并发升高时的延迟背压（排队不拒绝）。
package oczen

import (
	"time"

	"wild-work/internal/provider"
)

const (
	// Kind 渠道标识，同时是模型名前缀。
	Kind = provider.Oczen

	// DefaultBase 上游 OpenCode Zen 免费档的基址。
	// 2026-10-15 起对话必须在推理 API 前缀下：/zen/v1/chat/completions 即使请求与
	// 官方客户端逐字相同也回 403 FreeTierError。模型目录两个前缀都仍可用
	// （实测 /zen/v1/models 与 /inference/v1/models 均 200 / 86 条），故统一走后者。
	DefaultBase = "https://opencode.ai/inference/v1"

	// AnonymousKey 匿名免费凭证：字面量 "public"，无需注册。
	// 来源：opencode2api gateway.go anonymousZenKey。
	AnonymousKey = "public"

	// AnonymousUID 虚拟账号 UID。仅有一个，不可增删停用。
	AnonymousUID = "oczen-anonymous"

	// AnonymousName 面板展示名：仅凭证形态（匿名/私有Key），
	// 渠道名由前端 badge 渲染（避免重复「OpenCodeZen OpenCodeZen」）。
	AnonymousName = "匿名"

	// userAgent 伪装 OpenCode CLI 的 UA（上游 1.18.x 实测可通过）。
	// 免费档只要求串内含 `opencode/<version>` 记号即可（2026-10-15 实测：`dsh/1.0`
	// 一类无该记号的 UA 一律 403），故这里保持真实客户端的版本串。
	userAgent = "opencode/1.18.31 (windows amd64; node22)"

	// noExpiry 虚拟账号的过期时刻（2100-01-01）。
	// 必须设成远期值：auth.NeedsRefresh 对 ExpiresAt<=0 恒返回 true，
	// 会让 server/定价刷新路径反复调用 RefreshToken 并冷却账号（匿名通道无 token 可刷）。
	noExpiry int64 = 4102444800

	// requestTimeout 单次对话请求超时上限。
	requestTimeout = 10 * time.Minute
)

// stubToolName 免费档校验要求的两个 function 工具名（大小写敏感，实测仅小写可通过）。
var stubToolNames = [2]string{"bash", "read"}
