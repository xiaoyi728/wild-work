// constants.go OpenCodeZen 匿名免费通道的常量与静态模型目录。
//
// 渠道特性（见 docs/opencodezen渠道接入备忘.md）：
//   - 匿名凭证是字面量 "public"（Authorization: Bearer public），无需登录、无 token 轮换；
//   - 上游免费档有四道校验，缺一即 403 FreeTierError（**响应体四者逐字相同，不看请求无从分辨**）：
//     ① 会话头形状 ses_<12位小写hex><14位Base62>（2026-09-16 起）；
//     ② 会话头位不变量：那 12 位 hex 的低 12 位须落在 0xFC0-0xFFF，即官方
//     `~(ts_ms*0x1000+counter)` 布局里 counter∈1..63（2026-10-13 起，见 client.go
//     descendingTimePart）。⚠️ 时间戳段本身**不校验**（时间戳 0 也 200）。
//     ③ 请求体须为「智能体形态」：stream=true 且 tools 内同时含 bash 与 read 两个 function；
//     ④ User-Agent 须是 opencode/<版本> 形态（实测换成 curl/8.5.0 即 403）。
//     版本号本身不是检查项（1.18.31 / 1.19.0 / 2.0.x 同样通过）。
//     注：x-opencode-client / x-opencode-project / x-session-affinity 等头按参考实现
//     逐头删除实测**不在校验里**（本仓未逐一复验），仍齐套发送只为贴近真实客户端。
//   - 请求数配额确实存在：2026-09 的「1900+ 次无 429」已被 2026-10-10 单日 64 次
//     429（kind=soft_rate，可自行恢复）推翻；429 属背压，与上面的 403 是两回事。
package oczen

import (
	"time"

	"wild-work/internal/provider"
)

const (
	// Kind 渠道标识，同时是模型名前缀。
	Kind = provider.Oczen

	// DefaultBase 上游 OpenCode Zen 基址（OpenAI 兼容面）。
	DefaultBase = "https://opencode.ai/zen/v1"

	// AnonymousKey 匿名免费凭证：字面量 "public"，无需注册。
	// 来源：opencode2api gateway.go anonymousZenKey。
	AnonymousKey = "public"

	// AnonymousUID 虚拟账号 UID。仅有一个，不可增删停用。
	AnonymousUID = "oczen-anonymous"

	// AnonymousName 面板展示名：仅凭证形态（匿名/私有Key），
	// 渠道名由前端 badge 渲染（避免重复「OpenCodeZen OpenCodeZen」）。
	AnonymousName = "匿名"

	// userAgent 伪装 OpenCode CLI 的 UA（上游 1.18.x 实测可通过）。
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
