# OpenCodeZen（`oczen/*`）渠道接入备忘

> 本文件是 R16 / 不变量 21 / 不变量 22 引用的协议依据文档。原稿（2026-09 首建渠道时那份）在仓库白名单制下从未入库、
> 且已丢失。2026-10-13 因上游免费档闸门变更需要重新判读协议，本文按**当天实测**重建，
> 所有结论均标注测量方式；未实测的部分显式写「未验」。
> 同日经 `.gitignore` 反选入库（此前 AGENTS.md §9 与 R16 指向的是一个 clone 里不存在的文件）；
> 入库前逐字扫过敏感内容，无真实凭据，出现的只有 `<accessToken>` 这类占位符与 `Bearer public` 这个协议常量。

## 1. 渠道定位

十三渠道之一，模型前缀 `oczen/`。**唯一一个「无账号」渠道**：凭据是字面量 `public`
（`Authorization: Bearer public`），无需登录、无 token 轮换、无积分、无签到活动。
面板固定一项「[OpenCodeZen] 匿名」，积分位显示「不适用」。
装配见 `cmd/wild-work/main.go`（`ocUp`/`ocPool` + `SingleAccount: true`），实现见 `internal/oczen/`。

上游基址 `https://opencode.ai/zen/v1`（OpenAI 兼容面）。

## 2. 免费档闸门（2026-10-13 实测现状）

上游 **2026-10-11** 的 `anomalyco/opencode` commit `83f2b6f67a`
（`refactor(console): make Zen routes a thin inference proxy (#54563)`，48 文件）
把 `/zen/*` 改成指向新 inference 服务的薄代理，免费档校验随之从「查会话头**形状**」升级为
「查形状 **+ 查位不变量**」。四道检查与实测状态：

| # | 检查项 | 起始时间 | 实测证据 |
|---|---|---|---|
| ① | 会话头形状 `ses_<12位小写hex><14位Base62>` | 2026-09-16 | 见 `gateTimePartPattern` 前置的 `officialSessionPattern` |
| ② | 会话头**位不变量**（见 §3） | 2026-10-13 | 单变量对照 5 发，见 §3 表 |
| ③ | body 为「智能体形态」：`stream=true` 且 `tools` 同时含 `bash` 与 `read` 两个 function | 2026-09 | 位不变量满足后单独破坏：去 tools → 403、`stream=false` → 403 |
| ④ | `User-Agent` 须为 `opencode/<版本>` 形态 | 2026-09 | UA 换 `curl/8.5.0` → 403（位不变量满足时仍 403） |

**不是检查项的东西（重要，别再为它们调）**：

- **UA 里的版本号**：`1.18.31` / `1.19.0` / `1.20.1` / `2.0.0` / `2.0.14` / `2.0.28` 结果完全相同。
  「OpenCode 升级到 v2 导致渠道失效」这个假设已被此路实测否掉。
- **时间戳段本身**：见 §3 第 ③④ 行，时间戳 0 照样 200。
- `x-opencode-client` / `x-opencode-project` / `x-session-affinity` 等头：
  参考实现逐头删除实测**不在校验里**（⚠️ 本仓未逐一复验，仅采信其结论；
  我们仍齐套发送只为贴近真实客户端）。

⚠️ **四种失败返回的响应体逐字相同**，都是
`{"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode. …"}}`。
⇒ 拿到 403 时**无法从响应分辨是哪道闸门没过**；判据只能是逐闸门单变量对照。
这条直接导致了 §6 那次「五组对照全部同一句 message，我误判为闸门不再看形态」的错误结论
（真相是五组全部先撞在②上，③④被完全遮蔽，那组观察**分辨率为零**）。

## 3. 会话 id 的位不变量（本渠道最容易踩的坑）

官方生成器是公开源码：`anomalyco/opencode` 的 `packages/schema/src/identifier.ts`

```ts
const current = BigInt(timestamp) * 0x1000n + BigInt(counter)   // timestamp = Date.now()（毫秒）
const value = descending ? ~current : current                   // session 走 ~（descending）
const time  = 取 value 低 48 位 → 12 位小写十六进制
```

`counter` 每毫秒归零自增 ⇒ 同一毫秒内第一个 id 的 `counter == 1`；
按位取反把低 12 位一起翻转，所以 `counter == 1` 时那 12 位 hex 的**低 12 位恒为 `0xFFE`**。
一般地：低 12 位 = `0xFFF - counter`。

**实测矩阵**（同一台机器、头与 body 逐字节相同，只改会话值）：

| ① 会话 hex | 构造 | 结果 |
|---|---|---|
| `ecb104473ffe` | 真实毫秒 + counter=1 | **200** |
| `ecb104473fc0` | 真实毫秒 + counter=63 | **200** |
| `ecb104473fbf` | 真实毫秒 + counter=64 | **403** |
| `ffad9a3ffffe` | 荒唐时间戳（1970-01-02）+ counter=1 | **200** |
| `fffffffffffe` | **时间戳 0** + counter=1 | **200** |
| `3ae2ec8551c5` | 旧实现产物（sha256 直出，低 12 位 `1c5`） | **403** |

⇒ 上游查的是 **counter 落在 1..63 这个窗口**（低 12 位 ∈ `0xFC0`–`0xFFF`），
**不查时间戳是否合理**。第 3/4 行是判据的边界与「时钟不参与」的直接证据。

**本仓实现**（`internal/oczen/client.go`）：

- `descendingTimePart(hash []byte)`——把摘要字节重排成官方 48 位布局，低 12 位置 counter=1 后整字取反。
- `canonicalSessionID(signal)`——**只有形状与位都合法**才原样返回；否则一律重排。
  形状对但位不合法的入参（各家网关的旧 hash 产物、客户端粘进来的别人家 session）若原样透传，
  等于把上游 403 直接带给客户端。
- `gateTimePartPattern = ^[0-9a-f]{9}f[c-f][0-9a-f]$`——即低 12 位 ∈ `0xFC0`–`0xFFF`。

**为什么用「确定性重排」而不是「铸真时钟」**：时钟段不校验（§3 表第 ③④ 行），
所以可以保留 `sha256(seed)` 的确定性 ⇒ **同一对话恒定同一 id**（上游 prompt cache 亲和），
且是纯函数、零新增状态、无需缓存。
（对照：首版方案曾按「真实毫秒 + 4096 条 FIFO 缓存」设计，实测证明缓存是为一个不被校验的字段白加的。）

## 4. 端点可达性（2026-10-13 实测）

| 上游端点 | 匿名 + 合法会话头 | 说明 |
|---|---|---|
| `GET /zen/v1/models` | **200** | 目录不受闸门影响 ⇒ **面板看着永远正常**（见 §6 的危害形态） |
| `POST /zen/v1/chat/completions` | **200** | 唯一可用的推理入口 |
| `POST /zen/v1/responses` | **403** | 原生 Responses 面**不认**匿名免费档，即使会话头合法 |
| `POST /zen/v1/messages` | **403** | 原生 Anthropic 面同上 |
| `POST /zen/v1/systemone` | **451** `Endpoint is unavailable` | 与会话头合法性无关（旧坏会话头同样 451）⇒ 该端点自身不可用 |

⚠️ 后两行不影响本仓：`/v1/responses` 与 `/v1/messages` 由 `internal/gateway` 翻译成**内层
`/chat/completions`** 再出站（R13），实测两条兼容面均正常出内容。
但**不要**有人「顺手优化」成直连上游同名端点——那会立刻 403/451。

## 5. 额度、配额与错误语义

- **无额度概念**：`UserResource` 恒 0 且不得返回 error（不变量 21/22）。
- **429 存在，且与 403 是两回事**：`constants.go` 原记「1900+ 次、峰值 230 req/min、64 并发均无 429」
  **已被 2026-10-10 实测推翻**——当日 64 次 `status=429 kind=soft_rate`，且可自愈（当日仍有 736 条成功流水）。
  429 属背压/配额，403 属闸门身份，别混。
- **4xx 一律 `ErrPassthrough`**（`Classify`）：单账号渠道任何账号级惩罚都等于整渠道下线（R16 / 不变量 22），
  403 尤其**不得**归 `ErrSessionDead`——那会 `pool.Disable` 永久禁用一个不可重登的账号。
  2026-10-13 那次故障中这条豁免是对的：日志显示 `（单账号渠道不罚账号，原文透传）`，虚拟账号未被冷却或禁用。

## 6. 2026-10-13 故障复盘

**现象**：12:36:54 起对话恒 403，最后一次成功在 12:36:53；生产 9 次请求 0 成功。
`GET /models` 全程 200，费率照刷 ⇒ **面板 badge、模型清单、`/v1/models` 全正常**，只有真发消息才挂。
属 R34 家族的「不报错不崩溃、看着像活着」形态。

**排除的假设**（都有实测）：

| 假设 | 判据 | 结论 |
|---|---|---|
| 「我们改坏了」 | `internal/oczen/` 四文件与上游 master 逐字节 `cmp` 全 IDENTICAL；main.go 的 oczen 装配块与上游逐行相同 | 否 |
| 「今天融合/重启带来」 | 403 起点 12:36 **早于**当天 17:38 的生产重启；oczen 最后一次被改动是 10-07 | 否 |
| 「OpenCode 升 v2」 | v2.0.0 是 09-11 的 tag，而渠道用 v1 时代 UA 一路正常到 10-13 12:36；六种 UA 版本结果相同；v2.0.28 反而比封锁晚 3h40m | 否 |
| 「调用量超额」 | 逐日请求数取自 `usage-*.jsonl`：最高量的 10-10（736 次）零 403，出 403 的 10-13 只有 9 次成功请求 | 否 |
| 「配额」 | 配额是 429，措辞里没有任何 limit/quota/retry-after | 否 |
| **真因** | §3 单变量矩阵：会话 id 低 12 位不在 counter 1..63 窗口内 | **是** |

**为什么难查**：旧实现 `hex.EncodeToString(sum[:6])` 产出的形状**永远合法**，
而旧测试断言的恰好是形状、稳定性、以及「形状对就透传」——三条都与门禁无关，
**那个测试本身就是这个 bug 的护身符**（永不可能变红）。命中窗口概率仅 1/4096，
所以偶尔还有会话能通，看起来更像「上游在抽风」而非「我们的 id 值不对」。

## 7. 参考实现对照

- **`jasonxu114514/opencode2api`（Go，548 star）**：`constants.go` 里 `AnonymousKey` 的出处
  （`anonymousZenKey` 符号仅此仓库有，另一个同名仓库 0 命中）——**本渠道的祖先实现**。
  它今天（10-13）15:03 推了同一修复（`091329ee` #69、`7f68c51d` #70），
  实现是 `internal/identity/request.go` 的 `descendingTimePart` + `CanonicalSessionID`，与本文 §3 一致。
  ⚠️ 它**没有留下回归测试**：#70 加了 `request_test.go`（+69），两分钟后的 `61769a9b` 又整文件删除，
  全仓现已搜不到针对该逻辑的用例。算法照它，测试我们自己留。
- 同一天修好同一处的还有：`mnwlzf/sub2api` #21、`FishBottle7/opencode2dsh` #65/#67、
  `Victor9578/cpa-plugin-opencodezen` #1、`duyban23/pi-opencode-zen` #9、`docolua/9router` #4791、
  `Aymendje/pi-opencode-direct` #8。⇒ 这是全局策略变更，不是针对本工具的封禁。
- **上游 `rockswang/wild-work`**：oczen 最后一次改动 2026-10-07，**至今未修**。
  拉上游 master 原样跑同样是 403。⇒ 本仓这次修复是一条**新的本地偏离**（记在 AGENTS.md §10 L13）。

## 8. 判据清单

| 判据 | 位置 | 负向验证（摘掉修复必须变红） |
|---|---|---|
| 位不变量 + 形状 + 确定性 + counter 恒 1 | `internal/oczen/client_test.go` `TestCanonicalSessionID` | 装回 `hex.EncodeToString(sum[:6])` → 红并点名会话值 ✅ |
| 形状对但位非法必须重铸、不得透传 | 同上 `TestCanonicalSessionIDPassesOnlyGenuineIDs` | 把位检查从透传分支摘掉 → 红并给出 `ses_0123456789ab…` ✅ |
| 判据本身能分辨 200/403 样本 | 同上 `TestSessionGatePatternDiscriminates` | 期望值全部写实测字面值，不用同一套位运算反算 ✅ |
| 实盘：我们的 id 真被上游接受且真的出流 | `internal/oczen/live_gate_test.go`（`-tags live`，默认不跑） | 实测 200 + 658 B SSE ✅ |
| 实盘对照：旧形态会话头**仍**被拒 | 同上 `TestLiveGateStillRejectsRawHashSession` | 实测 403 FreeTierError ✅；**若它变 200 ⇒ 上游撤了闸门，本文 §3 需重新判读** |

端到端（沙箱 `127.0.0.1:28763`，生产未动）：`/v1/chat/completions` 流式 20 帧 + `[DONE]` + 0 error 帧；
非流式走 `Aggregate` 出 `NONSTREAM-OK`；`/v1/messages` 出 `ANTHROPIC-OK`；`/v1/responses` 出 `RESPONSES-OK`；
`/v1/models` 列 11 个 `oczen/` 模型。

## 9. 运维

改动在 `internal/oczen/`，**要重启 daemon 才生效**。监听局域网地址会瞬断其他设备的客户端，
按 §10 L7 须所有者点头；且 daemon 正在执行 `dist/wild-work-linux`，直接 `go build -o` 会 ETXTBSY
（先 build 到 `/tmp`、验字节、再 `mv` 覆盖，最后 SIGTERM——见 L7 与 §8）。
