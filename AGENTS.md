# Wild-Work 项目提示词（AGENTS.md）

> 本文件面向 AI Agent 与开发者，记录**工具设计、架构选型、决议项**与开发约定。
> **项目渊源**：原始上游为 3 个分离的 xxx2api 仓库 → workbuddy-wild v0.1.x（wails GUI 包装器）→ v0.2.x（增加 traework 集成）→ v2.0.x（大改版弃用 wails，改用系统托盘 daemon + Web UI，增加 qoder 渠道）。
> 当前 `master` 分支为 v2.0.x 版本；v0.2.x 已迁移至 `legacy-wails` 分支。

---

## 0. 项目渊源

Wild-Work 是 WorkBuddy（国内版+国际版）/TraeWork/Qoder 多渠道账号聚合工具，演进历程：

1. **上游 API 仓库**：3 个独立仓库 (`wild-work-buddy-api`, `wild-work-traework-api`, `wild-work-qoder-api`) → 提供各渠道基础 API 封装
2. **v0.1.x (workbuddy-wild)**：Wails GUI 包装器，仅支持 WorkBuddy 单渠道
3. **v0.2.x**：增加 TraeWork 集成，仍用 Wails
4. **v2.0.x (当前 master)**：大改版弃用 Wails，改用**系统托盘 daemon + 浏览器 Web UI**；新增 Qoder 渠道
5. **v2.1.x**：新增 **WorkBuddy 国际版**（`www.workbuddy.ai`）渠道，与国内版 `workbuddy` 完全独立

> ⚠️ v0.2.x 代码已迁移至 `legacy-wails` 分支，不再维护。

## 0. 项目一句话

去掉 wails/WebView2，改为 **系统托盘 daemon + 系统浏览器 Web UI** 的多平台（Win/mac）多渠道账号聚合工具。

## 1. 已定决议项（不要推翻，除非有强理由并更新本节）

| # | 决议 | 说明 |
|---|------|------|
| R1 | **托盘菜单固定，不做动态内容、不做定时/事件刷新** | 用户在自己客户端操作无法捕捉，动态展示无意义 |
| R2 | ~~托盘提供「刷新积分」菜单~~ **已移除**。刷新积分改为 Web UI 面板操作 | 托盘菜单精简为：打开主界面 / 查看日志 / 退出 |
| R3 | 托盘固定菜单项：**打开主界面 / 查看日志 / 退出** | 双击托盘 = 打开主界面；不再弹"已启动"提示框 |
| R4 | **管理 API 采用 cookie 会话鉴权**（2026-09-24 修订原「不设鉴权」） | 新增 `config.admin_password`（默认缺失 = 不鉴权，向前兼容）；**监听非环回地址时强制要求设置**（启动层 fatal + `SetListen` 拒绝），否则局域网任何设备可无凭据访问面板/退出程序。会话实现见 `internal/app/session.go`：token 随机 + 内存态（只存 SHA-256），HttpOnly + SameSite=Lax cookie，7 天滑动续期，改密码即失效，登录失败 5 次/IP 锁定 5 分钟。`/api/auth/*` 不鉴权，其余 `/api/*` 走守卫；OpenAI 侧 `api_key` 不受影响。**2026-10-01 加固：`/api/auth/login`、`/api/auth/logout` 这两个不鉴权的 POST 也套 `http.NewCrossOriginProtection()`**——login 用 `json.Decoder` 直接解析、不看 Content-Type，故跨站 `text/plain` 简单请求（不触发 CORS 预检）能打到它，恶意页面可故意连错 5 次把管理员自己的 IP 锁 5 分钟（`allowLogin` 按 `RemoteAddr` 计）。该保护只拒「非安全方法 + 跨源」，`GET/HEAD/OPTIONS` 与无 `Origin`/`Sec-Fetch-Site` 头的请求一律放行 ⇒ 面板同源调用、curl、既有 httptest 用例均不受影响（四种形态沙箱实测 + `TestAuthRoutesRejectCrossOriginPOST` 已负向验证）。⚠️ 用 `mux.Handle(...)` 注册时，`web_contract_test.go` 的路由扫描正则必须同时认 `Handle`/`HandleFunc`，否则这两条会**静默脱离契约**（实测：路由数 33→31 并报「前端引用了 Go 未注册的端点」） |
| R5 | **Web UI 用 Vite+React 编译，产物 `go:embed` 进单文件**（**2026-09-30 所有者签核推翻原「纯静态、无前端编译链」**） | 原决议全文：「Web UI 用纯静态 HTML/CSS/JS（无前端编译链），go:embed 打进单文件」。推翻理由与签核记录见 `docs/前端React重构架构计划.md` §0；同次签核还定了「echarts 内置、不再走 CDN」。**源码在 `cmd/wild-work/webui/`（不 embed），产物在 `cmd/wild-work/web-app/`（embed 目标）** —— 混用会把 107 MB 的 node_modules 打进 exe，有测试兜底。上游 vanilla 代码留在 `cmd/wild-work/web/` 不参与 embed，作为下次融合的 diff 基准。**迁移期两份同时 embed**：根路径 `/` 服务 vanilla（生产在用），React 挂 `/next/`；阶段 3 收尾后把 React 提到 `/` 并移除 vanilla 引用（见 §10 L6）。 |
| R6 | 托盘库：**保留 energye/systray**（已跨平台 Win/mac/Linux） | 各菜单项使用不同颜色纯 Go 生成图标，无需外部图标文件 |
| R7 | **移除 wails / WebView2 全部依赖** | 省内存与运行时；平台能力封装进 `internal/platform`（build tag 拆分） |
| R8 | daemon 单进程：一个 `http.Server` 同时服务 OpenAI 端点 + 管理 API + 静态 UI | 沿用 server 现有 ServeMux 扩展 |
| R9 | 核心业务（pool/scheduler/upstream/traework/server/login/config/auth/provider）**整体复用**，格式零迁移 | config.json / auths/ / data/state.json 兼容旧版；旧 state.json 自动迁移到 state-workbuddy.json |
| R10 | 新增渠道扩展方式：实现 `provider.Upstream` 接口 + auth 加载器 + 注册 Runtime | 模型前缀 `channel/<model>` 路由；已实现 WorkBuddyCN(国内) + WorkBuddyAI(国际) + TraeWork + TraeCode(与 TraeWork 共账号，function=solo_agent) + QoderCN + QoderCOM(国际) + 千问办公(qwenwork) + MonkeyCode(monkeycode，平台托管模型) + 小浣熊(raccoon) + Loomy(loomy) + 智谱清言(glm) + OpenCodeZen(oczen 匿名) + Cline(cline，官方 sk_ Key 免费池) 十三渠道 + 用户自定义 OpenAI 兼容渠道（custom，R66，面板配置不限个数；名称不得与内建渠道同名）；旧 Qoder（`qoder/*`，QoderWork）已从界面下线但路由保留 |
| R11 | Windows 产物在 WSL 交叉编译（`GOOS=windows CGO_ENABLED=0`，已验证可行）；macOS 产物走 GitHub Actions macos-latest（cgo 必需） | WSL 无法编 darwin cgo；CI 增加 darwin job |
| R12 | **无桌面 Linux 使用 `--no-tray` 参数** | 无参启动在无 DBus 环境托盘 panic 直接 exit 并提示；`--no-tray` 跳过托盘打印信息阻塞等待 Ctrl+C |
| R13 | **三接口兼容采用两层结构：内层 handler 不动，新增 `internal/gateway` 边缘层**，经 **in-process 调用**（`io.Pipe` + ResponseWriter 形状）复用内层 | 代码量比内联重构多 20%，但改动面小一个数量级（主链路仅 2 处调用点 + 1 个访问器），回归风险低、可脱离 pool 单测。**不得用 HTTP 自环**（`0.0.0.0` 监听不可作目标、鉴权双份、启动竞态） |
| R14 | **`Stream`/`Aggregate` 的 model 由调用方显式传入**，渠道不得用实例字段记忆「上次请求的模型名」 | 旧实现 qoder 用全局 `lastModel`，多账号并发会串号；traework 恒为空串。详见 `docs/三接口兼容改造备忘.md` §3 |
| R15 | **Responses 的 `function_call` 必须是独立 output item**（带 `call_id`），Anthropic 的 tool_use 参数必须走 `input_json_delta` | 参考实现 `tokligence-gateway` 两处写法不合规范（塞进 `message.content`、start 里一次性给完整 input），Codex/Claude Code 会解析失败 |
| R16 | **无账号渠道（oczen）不建 auth 文件、不进 `reloadAccounts`、不参与禁用/冷却惩罚** | 匿名凭证是常量 `public`；`SyncToDir` 会剔除磁盘上不存在的虚拟账号，故只在装配时注入一次。单账号 + 不可重登 ⇒ 任何账号级惩罚都等于整渠道下线，故 4xx 一律走 `ErrPassthrough`（原文透传、不计错不冷却）。**2026-09-24 修订：429 也不再冷却**——原「429 短冷却是唯一需要的背压」经实测证伪：单账号无号可轮换，冷却后后续请求在挑号阶段被挡成 `503 no_healthy_account`，反而不如透传 429 让客户端按 `Retry-After` 自行退避；同理**传输层错误也不再累计 `errCount`**（默认 3 次网络抖动即冷却唯一账号）。两者由新增的 `server.Runtime.SingleAccount` 统一豁免（结构属性，不硬编码渠道名），启动时另调 `Pool.ClearPenalty` 自愈旧版遗留的冷却。详见 `docs/opencodezen渠道接入备忘.md` |
| R17 | **用量/积分双流水分口径统计，不强关联、不折算** | `internal/ledger` 双 JSONL（usage 按渠道×模型 / credit 按账号 earn·spend·expire）；写入仅 append 缓冲句柄（30s AutoFlush），读取仅在 UI 请求 `/api/usage` 时按月分段扫描聚合，常驻内存 ≈0。`Upstream.Stream` 返回末帧 usage（R14 同款显式传参哲学）。首见账号只记一条「存量额度」baseline，不逐条展开。**同 key 重复条目（WorkBuddy 伪键一对多）先聚合求和再差分**，每 key 每次刷新最多一条事件；升级首启将旧错误流水一次性归档为 `old-credit-*.jsonl` 并删快照重建 baseline（issue #38）。**2026-10-08 补丁（issue #67）**：WorkBuddy 签到包落在「明日到期」key 上且提前一天以 r=0 建档，「发放即消耗」场景同 key 差分 delta=0 → 当日 earn 被抵消为 0（面板今日收入恒 0）。两层修复：① 差分补丁——快照增加 `used` 字段，delta=0 且 used 上涨时按 `发放额=usedDelta` 补记 earn（数学依据 remain=total-used；used 恒 0 的渠道零影响）；② 权威入账——新增 `provider.CheckinGranter` 可选接口（对齐 CheckinReporter 模式），WorkBuddy 实现 `DailyCheckinGrant`，调度器以它为唯一签到执行路径并用回执 `credit/today_credit` 直接记 earn（回执缺失/为 0 静默降级回差分）。详见 `docs/用量积分流水记账备忘.md` |
| R18 | ~~**临期阈值可配（默认 24h，下限 24h）**~~ **已被上游 R112 取代（2026-10-21，L20）**：选号改「最早到期时刻」，配置项与端点删除 | `config.schedule.expiring_threshold_hours`，normalize 钳下限（日期粒度到期判定低于一天无意义）；scheduler 与 app.creditTotals 同源取 `cfg.ExpiringThresholdDur` |
| R19 | **TraeWork 专用池判据仅 `available_endpoint==1`**（2026-09-26 修订，issue #44 撤回 pid==209） | 演进：09-18 专用池下发 ep=1 → 09-23（f6f41a4）上游不再下发 ep=1，改判 `pid==209` → **09-26 实锤证伪**：pid=209「200 档每日签到」已升级为通用积分。本仓日志铁证：09-23 15:20–16:10 连发 99 次对话期间 remain（208/221 池）恒为 3086，而「不可用」小计 2200→1846（-354=99 次对话消耗量），即**扣费实际发生在被判为不可用的池上**；继续排除会让 pool 按虚低余额选号、面板误标「不可用」。故判据回退为 `ep==1`。pid=208/209/221 均可消耗 |
| R20 | **千问办公推理 body 必须携带 `business` 段**（`{product:"qoder_work",type:"agent",version:"1",feature_switches:{}}`） | 2026-09-24 上游 1.0.4 起网关按 `body.business.{product,type}` 解析模型目录，缺失 → 对话恒 HTTP 200 + envelope 503 `Model catalog unavailable`（模型列表/余额/费率不受影响）。**仅补 `Cosy-Business-*` 静态头不能替代**。已实测四组对照隔离变量：body 缺 business 时「本项目透传 body」与「上游原生重构造 body」均 503，补上后均 200 ⇒ 原生 body 结构、官方 `Encode=1` WASM 组包、机器指纹（machineId/Token）**均非必要条件**，故本项目只补字段、不引入 wasmtime 级依赖。参考 Buddy2api PR #84（v2.1.15） |
| R21 | **千问办公 `expires_in` 单位是秒**，且 `expiresAt` 可被 access token 的 JWT `exp` 校正 | 回归：早期按毫秒处理（`*time.Millisecond`），把 7 天压成 604.8 秒 → 落盘 `expiresAt` 比真实寿命少 ~7 天 → `NeedsRefresh(10min)` 几乎恒为真 → **每次请求都刷 token**，与千问办公 App 高频互踩，直至 refresh token 被作废、账号被禁用。证据链：上游 `expires_in=604800` 按秒算 = access token JWT 的 `iat→exp`（整 7 天，吻合）；按毫秒算 = 文件里的值（吻合）。且同仓 workbuddy/trae/workbuddyai 的 auth 文件 `expiresAt` 与 JWT `exp` 逐秒一致，**仅 qwenwork 偏离 6.99 天**。修复：①refresh 按秒解释，优先取绝对字段 `expires_at`，两字段都缺失时回退 84h（JWT 实测 7 天的一半）；②`LoadQwenWorkDir` 调 `Auth.AdoptJWTExpiry()`，用上游签名的 JWT `exp` 原地校正历史脏值（仅内存、只增不减、非 JWT 不动）。**注意：同族 dt-/drt- 渠道（qoder/qodercn/qodercom）token 为不透明串、无 JWT 可交叉验证，其 `// ms` 标注未被本次改动触及**（无证据不做改动） |
| R22 | **智谱清言（`glm/*`）走网页版私有接口；登录以 CDP 自动捕获为主、手工粘贴为兜底** | 清言无可编程登录接口，凭据是浏览器 Cookie 里的 `chatglm_refresh_token`。自动路径见 R27/R28；手工路径保留 `POST /api/login/glm_token`。**不为它引入 WebView2**（R7 已删除该依赖，为单渠道加回是架构倒退且 Windows 专属）——CDP 走系统已装的 Edge/Chrome，零新依赖。协议要点见 `docs/智谱清言渠道接入备忘.md` |
| R23 | **清言「签到」的实质是保活对话；新账号额度需 App 侧登录才发放** | `member_info.score_rule` 原文「免费用户，登录赠送200积分/天」，**但对照实验证明这个「登录」指 App 登录**：新账号加进来后 `left_score=0`，**必须在智谱清言 App 登录一次**才发放（+3000，随后再 +500）。证据：某账号创建后独立监控 **15.5 分钟全程为 0**，App 登录后 **30 秒内**变 300000（见 `docs/智谱清言渠道接入备忘.md` §2.16）。**影响**：`pool.Pick()` 按 credits 降序选号，而 `healthy()` 不要求 credits>0 ⇒ **额度为 0 的账号不算被禁用，但永远排最后、实际轮不到**。**代码层面无解**（额度发放是上游行为，Web 端无「领取额度」端点）。故 `DailyCheckinReport` 的实质动作 = 保活对话；`UserResource` 从 `member_info.left_score` 读真实积分（**单位「分」，÷100 得积分**）。旧的 `activity-api` 签到活动已下线，保留调用作尽力而为、**完全静默失败** |
| R23b | **分析纪律：观察性数据只能提假设，定因果必须做对照实验** | R23 的结论我**连续错了四次**（详见 `docs/智谱清言渠道接入备忘.md` §4.3）：①「服务端延迟」②「App 登录是原因」③「14 分钟没到账⇒需要 App」④「自己到账，与 App 无关」（**忘了是我自己让用户去登录的**，把实验干预当自然现象）。共同病根：**拿观察当因果 + 样本量 1 就下结论**。最终靠**对照实验**才定性：不干预观察 15.5 分钟全 0 → 引入单一变量（App 登录）→ 30 秒内到账。**可复用判据**：下结论前先问「还有哪些变量在同一窗口内变动」；**自己做过干预的实验必须把干预当变量** |
| R24 | **清言渠道为正常多账号渠道（`SingleAccount` 不设）** | **2026-09-26 修正**：初版误设 `SingleAccount=true`，理由是「凭据轮换后不可人工恢复」。但 ① 现在可用 CDP 自动登录随时补账号，该理由不成立；② `SingleAccount` 会**跳过所有账号级惩罚**（handler 两处短路），导致账号 A 失效/限流时**永远不切账号 B**，多账号形同虚设。故改为正常多账号：错误分类惩罚 + 池内轮换。唯一真实约束「refresh_token 轮换必须落盘」由 `glm.RefreshToken` 保证。**教训：`SingleAccount` 是结构性声明（该渠道只有一个号且不可恢复），不是「觉得渠道脆」的保险丝**。**2026-10-01 补真守卫**：原先的回归测试 `TestGLMNotSingleAccount` 只断言常量与 Go 零值（`provider.GLM.String()=="glm"`、`Runtime{}` 的 `SingleAccount` 零值为 false），**从不读 main.go 的装配 ⇒ 永远不可能失败**，而其注释写着「若将来有人又给它加上，测试立刻失败」；已删除，改为 `cmd/wild-work/single_account_test.go` 静态扫装配、双向锁死「带 `SingleAccount: true` 的渠道集合恰为 `{oczen}`」（四个负向验证过）。同批修掉 `internal/glm/constants.go` 包注释里残留的「故 Runtime 置 SingleAccount」——与 R24 矛盾，照注释改代码就会把 bug 改回去 |
| R25 | **清言 SSE 是「增量 delta」，但 `part.status=="finish"` 时给的是全文** | **2026-09-26 逐帧实测纠正**：`part.content[].text/.think` 的语义取决于 `part.status`——`init` 帧是**增量片段**（每帧几个字符），`finish` 帧是该段落**完整全文**。即 init 帧拼接 == finish 帧全文。实现：init 帧直接透传为 OpenAI delta 并累加；finish 帧与已发出内容比对，仅在全文更长时**补发差额**（防漏兜底）。**曾因照抄参考实现「假定全量快照」的注释而写错**，实测拼出 `"1, 3, 4, 5, 5"`（正确应为 `"1, 2, 3, 4, 5"`）。回归测试 `TestStreamRealFramesNoDuplication` 用真实抓包帧锁死。**注意参考实现 GLM-Free-API 的流式路径本身也是错的**（`substring` 求差在 delta 语义下丢字），不可照抄 |
| R26 | **清言 `accessToken` 允许为空（凭据本体是 refresh_token）** | 用户手填时通常只给 refresh_token，而 `auth.Parse` 要求 accessToken 非空 → `LoadGLMDir` 用放宽版解析器 `parseAllowMissingAccessToken`，由 `glm.acquireToken` 在首次请求时补齐。且 refresh 会轮换 refresh_token，**必须落盘**（落盘失败显式报错，对应不变量 19/20） |
| R27 | **清言登录走 CDP 自动捕获 Cookie，独立 profile，手工粘贴仅作兜底** | 凭据是浏览器 Cookie 里的 `chatglm_refresh_token`。**不读浏览器 Cookie 数据库**——实测 Edge 运行时对其持独占锁（20 进程），既不能读也不能复制，且值为 DPAPI+AES-GCM 加密。改为：`internal/cdp`（手写最小 WebSocket，零新依赖）拉起**独立 profile** 的 Edge/Chrome + 调试端口 → 用户正常登录 → CDP `Network.getAllCookies` 读回。独立 profile 天然隔离，**多账号逐个添加互不干扰**（无需手动开无痕）。手工粘贴路径保留为兜底。见 `internal/login_glm/auto.go` |
| R28 | **自动登录的完成判据是「凭据验证通过」，不是「Cookie 出现」** | **实测发现**：清言对全新访客会自动下发 `chatglm_refresh_token`（423 字符），该 token 调 `user/refresh` 被拒（`访客账号不可用`）。若以「Cookie 出现」为完成判据，会抓到一个**永远不可用的访客账号**。故实现为：轮询 Cookie → 尝试验证 → 只有验证通过（非访客）才落盘收工；超时且只见到访客凭据时给出明确提示。见 `TestLiveGuestTokenBehavior`（实盘验证） |
| R29 | **多账号轮换的真实语义：粘性路由 + 错误惩罚 + 同请求换号**（2026-10-08 修订，PR #82） | 轮换**不是**「积分低就切」：① **粘性路由**优先复用上次成功的账号，直到冷却/禁用或连续 50 次成功；积分只在**选新号**时作排序键（临期 → 总余额）。② **错误惩罚照旧**（冷却/禁用/计错），但自 PR #82 起**账号级错误改为同请求内自动换号**：`ErrKind.Rotatable()` 族（限流/欠费/登录态死/404/5xx/账号故障/ErrClient）在惩罚后 continue 换下一个候选（`MaxRotate` 默认 3 封顶）；内容类错误（content_blocked/prompt_too_long/passthrough）**仍透传不换号**——换号必然复现；候选全部耗尽时透传**最后一个上游原始响应**（保 6004 重置时间等细节）而非包装 503。只有**传输层错误**照旧不计 Rotatable、直接 continue 换号。**变更动机**：旧「错误下次生效」语义下，客户端重试又被粘性路由钉回同一池，本可避免的失败原样甩给客户端（2026-09-23 生产事故：13 个健康号在场却返回 429）。单账号渠道（`SingleAccount`）完全豁免不变。回归测试 `internal/server/glm_rotation_test.go`（旧断言已按新语义更名改写）、`rotate_on_account_error_test.go` |
| R30 | **清言「伙伴/群聊」任务不自动化** | 接口已探明（`mainchat-api/claw_agent` 完整 CRUD，`claw` = 「伙伴」），但**决定不实现**：① 每天 500 积分（≈5 积分实际价值）vs. 风控风险不对称；② 这些任务的设计意图是引导**真人**使用产品，脚本刷属典型薅羊毛特征；③ 用户手动点两下成本极低。**故本渠道自动化边界 = 保活对话 + 积分读取，不碰创建伙伴/绑定 IM/群聊等写操作** |
| R31 | **每日登录积分走 `member-api/member/daily_login_score`，已接入保活流程** | 初版探测的路径名**全错**（`login_bonus`/`daily` 均 404），真实端点是 **`daily_login_score`**（2026-09-26 从 Web 主包挖出）。主包里它是**页面加载时自动调用**的（`errorMessageShow:false`）⇒ 调用它 ≈ 打开一次网页，特征与网页端一致，**不是跨端伪装**。响应：`status=0` 领取成功；`status=10001 "今日已领取"` = **幂等非错误**。**故无论上游是「自动发放」还是「需主动调用」，调它都安全且有益**。⚠️ **实现陷阱**：`doJSON` 在 `env.Status != 0` 时抛 error，会把 `10001` 误报成「领取失败」→ 新增 `doJSONEnvelope`（只把 HTTP ≥400 与非法 JSON 转 error，业务码交调用方解释）。回归测试 `internal/glm/daily_score_test.go` |
| R32 | **不模拟 App 登录来触发额度发放** | 用户设想「模拟 App 登录动作」以避免手动开 App。**实测否决**：① Web 端**无**任何额度激活接口（8 个候选全 404）；② 换 App 头访问同一接口反而 401（`member_info` Web 头 200 / App 头 401）⇒ App 走**另一套认证**（设备指纹、App 签名等），不是加 UA 就能冒充；③ App 域名 `api.chatglm.cn` 独立存在。**风险不对称**：模拟 App 登录是**跨端伪装**，风控风险比只读 Web 私有接口高一个量级，且触发额度发放正是薅羊毛特征（与 R30 同一逻辑）。**结论：手动开 App 登录一次即可**（一次性成本，零风险，零开发） |
| R33 | **三个 chatglm 变体的模型名带上游代号后缀 `:moe_53f`；旧名保留为别名** | **实测**：6 个模型名逐个测服务端上报的 `parts[].model` —— 三个 chatglm 变体（普通/`zero` 推理/`deep_research` 沉思）**都上报 `moe_53f`**，即**同一底层模型的不同推理等级**（`moe`=MoE 架构、`53` 很可能指 5.3）；search=`ai-search`、ppt/video=`all-tools-glms-glms-v2`。故给三个变体加 `:<model>` 后缀（`glm/chatglm:moe_53f` 等），**search/ppt/video 不改**（其代号是工具标识非模型版本）。**两个必须同步的点**：① `resolveAssistant` 查表前**剥掉 `:` 后缀**（同时保留完整名查表），否则 `chatglm:moe_53f` 只能靠兜底命中；② **旧名保留为别名**，已配置旧名的客户端不断，但 `/v1/models` 只列新名。新增 `UpstreamModel()` 辅助函数。回归测试 `TestResolveAssistantStripsUpstreamSuffix` 断言带/不带后缀解析结果一致 |
| R34 | **新增渠道必须补 go xxxSch.Run(sctx)，否则该渠道的自动签到/保活从不运行** | **2026-09-27 实测发现**：加 glm 渠道时创建了 glmSch、注册进 runtimes、设了观察者，**但漏了 Run()** ⇒ GLM 的自动签到与保活**从未执行**。危害特征：**不报错、不崩溃**，且**手工触发仍可用**（面板按钮 / RunCheckinNow 走的是另一条路径），故极难发现——用户是手工签到后才察觉。**回归测试** cmd/wild-work/scheduler_start_test.go：静态扫描「定义了 xxxSch := scheduler.New(...) 就必须有 go xxxSch.Run(」，并交叉校验 runtimes 里声明的 Scheduler 都已启动。**新增渠道清单应加一项：创建 → 注册 runtimes → 设观察者 → **go Run** → 补测试** |
| R35 | **流式请求必须用独立的 StreamHTTP（不设 Client.Timeout）** | **2026-09-27 生产日志实证**：GLM 对话流走带 Client.Timeout 的 client，触发 context deadline exceeded **5 次**（09/26 22:42、09/27 00:03/00:09/00:12/00:18），**且无终止帧** ⇒ 客户端表现为「回答到一半停住」。根因：Go 的 Client.Timeout **覆盖整个请求生命周期（含读 body）**，对 SSE 意味着「长回答必被掐断」。**修法**（照 traework 既有模式）：Client 加 StreamHTTP *http.Client{Transport: tr}（**共用 Transport 复用连接池、但不设 Timeout**），ChatStream 改用它；main.go 两处 applyProxies 都要把 {glmUp.HTTP, glmUp.StreamHTTP} 一起传（SetTransportProxy 会**新建** Transport，只套一个会让流式漏掉代理）。**非流式 client 仍保留 Timeout**（一问一答需兜底）。回归测试 internal/glm/stream_timeout_test.go：证明流能跑过 HTTP.Timeout，且对照证明非流式仍会超时。**2026-09-29 推广到全部流式渠道**（issue #42）：此前只剩 glm/traework 有 StreamHTTP，qwenwork/qodercn/qodercom/qoder/workbuddy/ workbuddyai/oczen 的 ChatStream 全用带 Timeout 的 HTTP ⇒ 长流式同样会被掐断。现已给全部 7 个渠道补 StreamHTTP（共用 Transport、不设 Timeout，流式里 Select{StreamHTTP 非 nil 则用之}），main.go **两处** applyProxies（启动 + 面板热更新）都要把 {HTTP, BillingHTTP?, StreamHTTP} 一起传，否则只套 HTTP 会让流式漏掉代理 |
| R36 | **流被截断不得靠补 `data: [DONE]` 伪装成正常收尾**（issue #42） | **实证**：qwenwork/qodercn/qodercom/qoder 四份 sse.go 的 `sawDone` 是**死变量**（声明后从不赋值）⇒ 上游连接中断/读超时被掐断、或断在半个帧上（末行无换行），出口照样补 `data: [DONE]`，客户端拿到半截 tool_call arguments 报 "tool input was not fully received"，而网关日志**无任何错误**，极难排查。**修法**：parseNestedSSE 增加 `truncated` 出参（读错误/半帧 → true），`streamAsOpenAI` 里截断时改发一帧 OpenAI 规范 error（`code: upstream_truncated`）且**不发** [DONE]——调用方 `err!=nil` 同时保留。通用路径上游/sse.go streamCore 也做了同样的截断→error帧改造。刻意保留的行为：上游「正常 EOF 但漏发 [DONE]」（帧完整、末行有换行）仍兜底补 [DONE]，避免误伤本就补的渠道。回归测试：qwenwork/qodercn/qodercom/qoder 各 `stream_truncation_test.go` + 通用 `TestStreamTruncationNotDisguisedAsDone`，覆盖四种输入（传输层错误/半帧/正常 [DONE]/EOF 漏发） |
| R37 | **TraeWork AuthCode 交换：4xx 属终态，不得换 origin 重试掩盖首因；设备号作用域 = 账号**（issue #50；2026-10-08 二次修订 issue #60/#70） | 旧实现 `ExchangeAuthCode` 对 4xx 也 `continue` 试下一个 origin，把首选 api.trae.cn 的真实错误（403/20401 设备数上限）覆盖成回退 origin 的 400/10101「无效参数」后再打印 ⇒ 表象彻底指向参数写错，且 authCode 一次性、4xx 后重试纯属刷屏。**修法**：4xx（除 429/408）立即返回携带**首个** origin 真实响应的 `*AuthCodeRejectedError`（含 origin/status/body）；`IsDeviceLimitReached` 单表识别 20401（可行动提示「去其它设备登出释放名额，最多 10 台」）；`login_trae.Poll` 把终态错误固化到 `login-state.json` 的 `Err` 并清空 AuthCode，后续轮询短路不再每 2s 重消耗。**设备号持久化**（初版）：官方客户端 `getDeviceId()` 是持久的，本仓每次登录 `randHex(32)` 随机新生成 = 每点一次都是新设备。改为从 `device-id.json`（`login-state.json` 同目录、独立文件）复用，缺失才生成并落盘（不复用 login-state，它登录成功/取消即删）。**二次修订（2026-10-08，#60/#70 实证推翻本机级共享）**：`device-id.json` 让一机多号共享同一设备号——#70 实测 15 号对照：共享设备号的 3 个账号全部撞 4017 common risk control（仅对话入口被拒、积分正常），一机一号的 12 个零风控；#60 实测同一编造设备号被多账号绑定后新账号授权恒 20401 Device limit reached（换设备号立即成功）。**修法**：设备号作用域从「本机」改为「登录会话」——每次 `Start()` 新生成一对 machineId/deviceId，登录成功随 `auths/trae-<uid>.json` 落盘成为该账号的稳定注册设备（满足 #3 的 x-device-id 稳定性，签到/对话头从 auth 文件读、不经过 Start）；`Poll` 成功后顺手删除遗留的 `device-id.json`（老用户自愈）。**#60 建议的「读官方客户端真实设备号」不做**：需移植 storage.json TC 解密且依赖本机装官方客户端，而 #70 数据已证明随机号本身可用，会话级新号即可消解两者。**权衡披露**：同账号重登会消耗一个设备名额（上限 10），但远低于旧随机版的消耗速度。回归测试 `internal/login_trae/login_device_test.go` |
| R38 | **上游按模型限流时不得软化整个账号**（issue #53） | **2026-09-29 最小修复（不做大架构改动）**：WorkBuddyAI 上游模型级 429（6004 / body 含 `switch to the other models` / `usage exceeds frequency limit`）在 `Classify` 里判为 `ErrPassthrough`（请求级、不冷却账号），透传原文让客户端按 Retry-After 自退避或换模型——**不**把该账号其它还能用的模型一起拖进 SoftCooldown。与 R16 单账号渠道同哲学。**不做的部分**：pool 升级到 model 维度状态、`stickyKey(kind)`→`(kind,model)`、state v4（issue 作者提议的两种更大改造），它们动 pool/state/handler 三核心、~370 行，需单独评估（作者已主动提出可拆两个小 PR）。注意此判据仅限 WorkBuddyAI：其它渠道的 429 语义仍是账号级 |
| R39 | **`scheduler.Config` 的时间字段：`nil` = 未配置（落默认），`[]int{}` = 本渠道没有这类定时任务** | **2026-09-23 实证**：`scheduler.New` 原用 `len(...) == 0` 判默认值，把两者混为一谈 ⇒ 传 `nil` 想关掉定时任务的渠道被静默补上默认时间。`main.go` 里命中四处：**qoder / oczen** 每天 09:00、21:00 各跑一次必然失败的签到（面板按 `last_checkin_ok` 渲染出红色「签到失败」标签，消息是「qoder 暂无签到活动」/「no refresh token」）；**workbuddyai** 注释写「Keepalive 关闭」但 22:00 照常每日刷 token；**qwenwork 最严重** —— 注释明写「定时保活反而会与千问办公 App 互踩」，而保活批次每天照跑。同一个「无签到活动」概念在 `app.go` 有 `noExplicitCheckin()` 守卫（手动签到、首次签到路径都据此跳过），唯独 `scheduler.New` 的零值兜底把它抹掉。**修法**：两处 `len(...) == 0` 改 `== nil`；四处调用点改传 `[]int{}`；`Run()` 补「两个列表都为空时阻塞等 ctx/配置变更」—— 否则 `nextFireMinutes` 返回零值走 `IsZero` 兜底，变成每天 1440 次空转。回归测试 `internal/scheduler/scheduler_defaults_test.go`（零值落默认 / 显式空关闭 / `CheckinHours` 旧字段兼容 / 无任务时 `Run` 阻塞且响应取消） |
| R40 | **流内业务错误不得伪装成正常收尾；兼容层不得吞 error 帧**（2026-10-03） | **背景**：traework 的 `event:error`（3004 限流/1005 权益）旧实现写成 `delta.content` + `finish_reason:stop` + 补 `[DONE]`，且函数返回 `nil` ⇒ 客户端看到「正常结束、内容莫名其妙」、agent 拿半截回答继续跑，且 handler 无从得知失败 ⇒ **账号不冷却**；更糟的是 `NoteSuccess`/`stickySuccess` 在读流**之前**已执行，粘性路由把请求钉死在中招账号上，重试必然再撞。**修法**：① `solosse` 错误分支改发 OpenAI 规范 error 帧（限流标记 `upstream_rate_limited`）、**不补 `[DONE]`**、把错误返回调用方；② 新增 `provider.StreamErrorClassifier`（`Kind()`），handler 用 `errors.As` 取值后按 kind 冷却账号（软 60s / 硬 12h / 禁用），粘性路由见 `status.Cooling` 自动让位，无需显式 `stickyClear`；③ **兼容层必须识别 error 帧**——`gateway.parseChatSSELine` 此前只认 `choices`，error 帧被静默丢弃，致 `/v1/messages` 发 `end_turn`+`message_stop`、`/v1/responses` 发 `response.completed`+`[DONE]`，把失败伪装成成功（该缺口对内层所有渠道通用，含 R36 的 `upstream_truncated`）。**协议合规要点**：Anthropic `error.type` 是 **9 元判别联合**（`api_error`/`rate_limit_error`…），**不得填内层私有码**——限流映射为 `rate_limit_error`；Responses 用 `response.failed`（不补 `response.completed`/`[DONE]`），`response.error.code` 亦须映射到枚举（`server_error`/`rate_limit_exceeded`），私有码只放 `error` 事件的自由 `code` 字段。**3004 的限流维度是待强化假设**（R23b）：观察仅 1 例且来自 checkin 路径，只足以排除 IP/全局级；因软冷却仅 60s、判据不成立时最坏影响是闲置一分钟，故按账号级处置。回归：`traework/solosse_test.go`、`server/stream_error_penalty_test.go`、`gateway/stream_error_frame_test.go`、`scripts/ui-static-check.mjs` |
| R41 | **小浣熊协议回调必须由 `main.go` 在初始化前拦截（`--raccoon-callback`）**（2026-10-05） | **背景**：小浣熊「浏览器授权登录」的授权码经自定义深链 `office-raccoon://auth/callback` 回传，实现方式是登录期间临时改写 HKCU 的 `office-raccoon` 注册表命令行为 `"<wild-work.exe>" --raccoon-callback "%1"`。`internal/raccoon` 把 `CallbackFlag` 与 `SaveCallback()` 都写好了，**但 `cmd/wild-work/main.go` 从未解析该 flag** ⇒ Windows 唤起回调子进程后，它当作普通启动又拉了一份 daemon：端口被占（`listen … bind: Only one usage…`）、**且它的启动自愈看到「残留的协议改写」立刻 `RestoreProtocol`+`ClearCallback`** ⇒ 授权码从未落盘，常驻进程轮询到 5 分钟超时。**全程不报错不崩溃**，用户只看到「点完授权但账号没加进来」。**修法**：`main.go` 在 `os.Chdir(workDir())` 之后、**任何初始化（config/日志/服务/托盘）之前** 拦截 `handleRaccoonCallback(os.Args[1:])`，命中即「落盘后 `os.Exit`」，绝不启动第二份服务。**同时**：`windowsgui` 构建无控制台，回调结果必须追加写进 `data/app.log`（否则失败时零线索）。**同类教训**：这与 R34（新增渠道漏 `go xxxSch.Run()`）同族 —— **「声明了却没接线」的疏漏在源码层就能判定**，故补静态回归 `cmd/wild-work/raccoon_callback_test.go`（断言 main.go 调用了 handler、位置在服务初始化前、分支含 `os.Exit`），去掉修复即失败。**附带**：`/api/state` 新增 `login_error` —— 此前前端只看 `login_busy`，把**所有渠道**的登录失败/超时都显示成「登录完成」，正是它掩盖了本次问题；现由 `peekLoginError()` 非破坏式回传真实原因（读取即清空会被 `/api/state` 的其它调用方偷走） |
| R42 | **渠道本地模型校验必须取「静态表 ∪ 动态目录」的并集**（2026-10-05） | **背景**：raccoon / loomy 都做本地模型名校验（上游对未知模型名**静默回落到默认模型**并返回 200，不校验会让用户以为在用 A、实际扣 B 的额度），但实现只查**静态表**（`KnownModel(id)`）⇒ 上游目录新增的模型会被本地 400 误拒，而**同一个模型正被 `/v1/models` 正常列出**（后者读的是动态目录 `FetchModels` 结果）——表现为「面板列出却调不动」。**实测（2026-10-05）**：raccoon 账户 `/v1/models` 列出 9 个模型，其中 `sn-sensenova-6-8-flash` 调对话被本地 400 `model_not_found`，但直连上游同一模型 **HTTP 200 正常服务**（`sn-sensenova-6-8-flash-lite` 在静态表里、`sn-sensenova-6-8-flash` 不在，二者仅差一个后缀）。**修法**：`fetchCatalog` / `fetchModels` 成功后把目录里的模型名记进 Client（`liveIDs`，**单调扩大、只增不减**——避免目录瞬时抖动把可用模型判成未知），`ChatStream` 改查 `c.knownModel()`（静态表 ∪ liveIDs）。两渠道同款修复 + 回归测试 `TestKnownModelAcceptsLiveCatalog`（去掉并集即失败）。**顺带**：给两个 Client 加 `Base` 字段（默认常量端点，测试注入 httptest 假上游），避免为写这条测试而把 `LLMBase`/`GatewayBase` 从 const 改成 var |
| R43 | **运行统计（`internal/stats`）与用量流水（`internal/ledger`）是两套并列口径，不合并、不互校**（2026-10-07，PR #71–#73） | **背景**：新增「运行统计」tab 时引入了第二套统计面。分工：`ledger` = 磁盘 JSONL 双流水（`data/ledger/{usage,credit}-*.jsonl`），账号**条目差分**口径，按需扫描聚合（R17）；`stats` = 内存实时 + 按日归档 `data/stats.json`，「今日」口径——消耗走**余额下降差值**、收入走**日志签到事件**（`events.go` 正则解析 `app.log`，因「登录即自动签到」等场景条目晚于入账建立，差值恒 0 漏记）、逐请求 token 走 **usage 帧精确值**（`usage.go`）。**决议**：两者**零共享状态、零互相写入**（stats 仅只读 `ledger.Query(1)` 取当日作废），各自标注口径、互不引用；**数字天然不同是设计而非缺陷**（差值含积分包到期作废，ledger 已拆 spend/expire），**不追求对齐**。**边界**：`ledger` 仍是面板「用量与积分」的数据源与 issue #67 等待修的口径；`stats` 只服务「运行统计」tab。新增统计需求时**先明确归属**（精确拆分→ledger；实时/今日/趋势→stats），**不得**为对齐数字而改动另一侧。**注入纪律**：stats 全部数据输入走**进程内直调**（`allStatuses` / `handler.StickySnapshot` / `ledger.Query`），**不得** HTTP 自环（R13）；`main.go` 须 `go appInst.StartStatsFeeders(sctx)`（漏接线即静默无数据，同 R34 家族） |
| R44 | **小浣熊登录改用「网页版 CDP 捕获」，废弃桌面协议回调**（2026-10-10） | **背景**：原「浏览器授权登录」靠改写 HKCU 的 `office-raccoon://` 协议注册来接住深链授权码（R41），仅 Windows 可用、要求本机装官方客户端、且与客户端抢协议。**实测**（`ref/xiaohuanxiong_web_20261010.saz`）：网页版登录成功后前端 JS 会把凭据写进 Cookie `raccoon_refresh_token`（域 `.xiaohuanxiong.com`），且该凭据与桌面端**同一套**（JWT 无平台声明）——实测目录/余额/推理/刷新四项全通，`model_catalog` 的 **9 个模型全部可用**。**修法**：`internal/login_raccoon` 改为网页版流程（`web.go`）——拉起**独立 profile** 的 Edge/Chrome（复用 `internal/cdp`）打开 `office.xiaohuanxiong.com/home?loginModal=true` → CDP 轮询 Cookie → **判据是 JWT `owner_type==users`**（访客也下发 Cookie，见 R28 同款教训）→ 调 `/api/web/auth/v1/refresh` 换取并落盘凭据。**跨平台**（纯 HTTP + 系统浏览器，不再依赖注册表）；桌面协议登录代码（`protocol*.go` 的 Hijack/Backup/restore、`--raccoon-callback` 入口）**保留但不再调用**，仅作旧版注册表残留的启动自愈（`healRaccoonProtocol`）。**「从客户端导入」路径保留**（`import_local.go`）。**已知限制（面板弹窗已告知）**：上游 refresh **轮换 refresh_token**，若同账号凭据被本工具与浏览器/客户端**共用**会互踢；要并存须用本流程**单独登录一次**（新建独立会话，`sid` 不同）。回归测试 `internal/login_raccoon/login_test.go`（owner_type 甄别 / Poll 状态机 / 并发拒绝 / 幂等 Shutdown） |
| R45 | **明细与刷新路径同源回写 pool 快照（`creditSnapshot`）**（2026-10-11） | **背景**：面板「同屏两个数字对不上」——账号卡片/汇总条的积分与 hover 明细弹层的数字不一致。**实测**：同一响应内上游汇总字段==明细池相加，确认非上游口径漂移；差异实为时差——旧实现里 pool 快照只被「刷新事件」（手动刷新/全部刷新/自动循环）更新，而明细是 hover 时的实时值，两者必然相差区间内消耗量。**修法**：`app.creditSnapshot` 取数成功即 `SetCreditDetail` + ledger 差分（`creditTotals` 与 `ResourceDetail` 共用，删掉三处各自回写）；`ResourceDetail` 扩展返回 expiring/unusable，`/api/account/resource_detail` 响应新增 `expiring_remain`；前端 `showCreditDetail` 用响应的 `usable_remain/expiring_remain/unusable_remain` 回写卡片与汇总条（`data-uid` 定位，不全量重绘以免丢失正在 hover 的 tooltip 锚点），`checkin/refreshOne/checkinAll/refreshAll` 成功后清 `detailCache`。回归测试 `TestResourceDetailWritesBackPoolSnapshot`（去掉回写即失败） |
| R46 | **Cline 渠道（`cline/*`）= 多账号官方 API Key 池 + 免费模型调度器**（2026-10-10） | 凭据是**官方文档化的 `sk_` API Key**（app.cline.bot → Settings → API Keys），**不是** cline2api 那套 WorkOS device-code OAuth：实测两者模型面等价，而 Key 不过期、**不轮换** ⇒ R26/R44 的「同凭据多处使用互踢」在本渠道不存在，且零登录编排。**必带非空 `X-CLIENT-TYPE` 头**（值随意，实测 `bogus-value` 也放行；缺失/空值 ⇒ 全部 `cline-free/*` 返回 403 `API_REQUEST_ERROR_CODE`，且**不报错不崩溃**、只表现为免费模型消失，属 R34 家族的静默失效；由 `TestChatStreamAlwaysSendsClientTypeHeader` + live 的 `TestLiveAliasNeedsClientType` 双重锁死）。模型面**不做任何本地假设**（2026-10-12 简化，用户裁定）：**绑死上游** `recommended-models` 的 `free[]` 数组**原样透传**——ID 保留 `cline-free/*` 别名不改写（不用厂商真实名：用户在 Cline 后台实测，免费入口是别名条目而真实名会扣费，但计价逐请求抽签，本渠道不承诺价格）、不做基名去重、不按 tag/后缀过滤；**删除**硬编码静态表与 `/api/v1/models` 拉取（458 条 OpenRouter 镜像对免费池定位无信息量）。本地校验集 = 暴露集 = `free[]`（构造即一致）；**冷启动放行**（目录未拉到过时不拦，否则 daemon 重启后第一批请求全被本地 404，放行的最坏结果只是让上游给权威错误）；上游抖动时用已知集兑底不掏空面板。上游**确无余额/额度端点**（`/credits` `/usage` `/billing` `/quota` `/me` 等 12 个候选实测全 404，只有 `/api-keys` 与 `/plans` 存在）⇒ `UserResource` 恒 0 且**不得返回 error**，面板积分位「不适用」（`creditsNAKind`），实际花费只来自逐请求 `usage.cost`（入 ledger）。签到/保活/定时任务**全关**（`CheckinHours`/`KeepaliveHours` = `[]int{}`，R39）+ **`go clineSch.Run(sctx)`**（R34）；`noExplicitCheckin` 含 Cline。**不承诺价格**：`free` 命名空间与 `is_byok`/`provider` 实测**都不能**当判据（同前缀有扣费、非 free 后缀反倒 cost=0，且同一 ID 相邻两笔计价会漂移）⇒ 费率表标「不适用」，一切以实测 `usage.cost` 为准。面板文案必须写明「额度按**账号**计（官方字段 `…UsageCostUSDPerUser`），同账号多把 Key 共享一份额度」，并在检测到同账号时告警（依据 `/api-keys` 返回本账号全部 Key）。 **2026-10-12 压测订正三条（随 v2.7.0 采纳）**：① 发往上游的 body 必须强制 `stream:true`——handler 对上游响应一律按 SSE 解析，客户端发 `stream:false` 时上游回 JSON 信封 ⇒ `errEmptyStream` ⇒ 502 并被计账号连续错误，实测一次非流式请求后 4 个免费模型全 503 约 60s（`sse.go` 的 Aggregate 注释早已假定该不变量却未落实，已补 `forceStream`）；② 地区限制模型（`muse-spark-1.3-contributor` 国内直连恒 403 `not available in your region`）归 `ErrPassthrough` **不罚号**，落 ErrClient 会重试耗尽后冷却整条渠道；③ 上游 `free[]` 不返回上下文/能力字段 ⇒ 本渠道维护 `measuredCaps` 实测表，配 `provider.ModelInfo.HandMeasured` 如实标来源（与 `ContextFromAPI` 互斥），面板上下文带 `*` 且 tooltip 写明「本工具实测值」；Key 创建入口是 `Account / API Keys`（旧记 `Settings → API Keys` 有误） |
| R47 | **Cline 的 429 分两类：OpenRouter 侧共享上限不得软化账号**（2026-10-10，R38 同族扩展） | 上游把真实状态**压平成 HTTP 500**（`… from Openrouter: request failed with status 429 …`）⇒ `Classify` 必须正则取**内层**三位状态码，否则 429 被归成 5xx（违反不变量 15 的「429 优先」）。挖开后是两种语义相反的 429：① **共享出口上限**——`limit_rpd` / `Daily limit reached` / `temporarily rate-limited`，落在「Cline 自己的 OpenRouter key」上（路由判据：响应 `id` 前缀 `gen-` = OpenRouter，`gen_` = Cline 自有网关，实测 9 个 ID 零反例，是成功路径上**唯一可用**的聚合器标识；`is_byok`/`provider` 均已被证伪）⇒ **换 Cline 账号必然复现** ⇒ 归 `ErrPassthrough`（不计账号错、不冷却、不换号），并把该 model 记入渠道内 `capped`（期间从 `/v1/models` 摘除，TTL 1h 自愈；实测 `gemma-4-26b` 上轮 429、本轮 200，故必须可恢复）；② 无上述文案的 429 ⇒ 才是真账号级（依据 `plans` 的 `…UsageCostUSDPerUser`）⇒ `ErrSoftRate` 冷却 + 同请求换号（R29 全量适用，本渠道**不置** `SingleAccount`）。**不区分的后果**：渠道只有 3 个模型，`pool.CooldownModel` 在 ≥2 模型冷却时升级整号冷却 ⇒ 所有 Key 被逐个轮空 → `503 no_healthy_account`（正是 R16/R38 的误伤形态）。另一族必须处理的是 **HTTP 200 + 流内 `error` 帧 + 上游自己发 `[DONE]`**（`stream_initialization_failed`，实测另有数字 `502`）：R36 的「截断时不发 [DONE]」在此不适用（上游已发），需要识别 error 帧 → 返回 `StreamError`（实现 `StreamErrorClassifier`，R40）；为此在 `internal/upstream` 新增最小导出 `StreamWith`（同时带 hintFn 与 onUsage 两个钩子，既有三个导出各只带一个）。`max_tokens` 实测：8→上游 400、16→500 `empty response content`（推理吃光预算 ⇒ 可见内容为 0）、64~200000 全通、1e6→拒 ⇒ `PrepareBody` 缺省**不传**、<64 抬到 64、>200000 压到 200000；**强制 stream=true 并不能豁免这条**。 |
| R48 | **`normalizeToolTurnContent` 给 assistant 补 content 不再以 tool_calls 为前提**（2026-10-11） | **实测**：CodeBuddy 客户端在「思考中途被打断」时，会把半截思考存成 `{"role":"assistant","reasoning":"…"}`（**无 content、无 tool_calls**）；该空壳留在历史里后，traecode/SOLO 对**每一发**请求都回流内 `event:error` `4001 the param is invalid`（与「中毒进历史」同类，重启客户端也不恢复，只能新建会话）。旧实现只在 assistant **带 tool_calls** 时补空串，普通 assistant 刻意放过（注释「无证据会出问题」）⇒ 空壳原样透传。**修法**：`case "assistant", "tool"` 一律补 `content:""`，不再判 tool_calls。**重放坐实**（一份 129 条消息的完整会话，同一条畸形消息）：原样 → 0.6s 即 4001；删掉空壳或补 `content:""` → 均正常出流 ⇒ 上游接受空串，故补空串（保留历史结构）而非丢消息。回归测试 `internal/server/handler_tool_content_test.go`（含 reasoning-only 空壳用例，断言 reasoning 字段不被误删） |
| R49 | **思考档位只透传上游声明，绝不编造**（2026-10-12，issue #96；随 v2.7.0 采纳） | `provider.ModelInfo` 新增 `ReasoningEfforts` / `DefaultReasoningEffort` / `CanDisableThinking`（三态指针）。**上游目录声明了才透出，未声明时整个 reasoning 对象不出现**——把「未声明」显示成任何具体档位都是编造（同 `ContextFromAPI` 哲学）。接线 workbuddy CN（`reasoning.supportedEfforts/defaultEffort/canDisableThinking`，deepseek 系只有老式 `effort` 默认档时回退取它）、workbuddyai（mergeV3 非空者优先）、loomy（`reasoning_efforts` 为上游权威）。透出：`/v1/models` 加 `supports_reasoning` + `reasoning{}`，`/api/fees` 加 `reasoning_efforts`。`provider.CleanEfforts` 去空白/去重/丢空串（上游实测下发过 `"max","max",""`）。qoder 系 / qwenwork / glm / raccoon / oczen / cline / monkeycode 无档位声明，不参与。回归 `internal/upstream/reasoning_test.go` 等 |
| R50 | **思考链死循环（发癫）检测：流式逐帧判据 + 中断 SSE + 不罚账号**（2026-10-13，随 v2.7.1 采纳） | 新模块 `internal/loopguard`（算法移植自 dsh-attention-health 的 `lib/guard.js`，只取死循环检测）：四条判据（同行连续重复≥8 且行长≥12 / 60 行窗口内同短行≥30 / 40 行滑窗唯一率≤0.25 / 行内周期 p∈[2,40] 重复≥16 且累计≥160 字）+ 防误杀护栏（周期单元须含字母或汉字、十六进制字节周期豁免、代码围栏内豁免）。接线 `internal/upstream/sse.go` streamCore（九渠道）+ traework `solosse.go` + qoder 系四路 `streamAsOpenAI` + raccoon/loomy；**glm 跳过**。**命中**：发一帧 `code=upstream_reasoning_loop` 的 OpenAI 规范 error、**不补 `[DONE]`**、返回 `*loopguard.Error`。**不罚账号**：该类型**刻意不实现** `provider.StreamErrorClassifier`——死循环是模型/请求级问题，换号必然复现，冷却只会把后续请求挡成 `503 no_healthy_account`（R16/R38 同族）。**零误伤**：只在 `reasoning_content` 非空时喂入。开关 `config.features.loop_guard`（默认 true）+ `POST /api/config/loop_guard` 热切换（atomic 全局，无需重启）+ env `WILDWORK_LOOP_GUARD=0`。⚠️ **上游未做实盘触发验证**（死循环难以稳定复现），阈值待社区反馈校准 |
| R51 | **OpenRouter 系思考字段归一化到 `reasoning_content` 单字段下发**（2026-10-13，PR #100，随 v2.7.1 采纳） | Cline 免费池（Cline→OpenRouter→Meta）的思考增量字段是 `delta.reasoning` / `delta.reasoning_details`，**不是**本仓历史唯一形态 `delta.reasoning_content` ⇒ 思考文本被**静默丢弃**（客户端看不到思考、`usage.reasoning_tokens` 却非零），且 loopguard 在该渠道**永远喂不进**——同一根因的两面。新增 `upstream.reasoningDeltaOf`（优先级 `reasoning_content` > `reasoning` > `reasoning_details[type=reasoning.summary]`；三者同帧并存时逐字相同故取首个，`reasoning.encrypted` 是回放密文、无可读文本不取），流式逐帧 `normalizeFrame` 与非流式 `Aggregate`/`mergeMessageFields` 两路同改；`loopguard.ReasoningDeltaOf` 同步三字段。方向选「归一化**到** `reasoning_content`」而非透出 `reasoning`：九渠道白名单、loopguard、gateway Anthropic 转换共同认定它是唯一字段 |
| R52 | **「完整模型 ID」补渠道前缀的判据是「是否已以该渠道前缀开头」，不是「ID 含 `/`」**（2026-10-13，PR #102 + 补漏，随 v2.7.1 采纳） | **这条命中的正是本地 §10 L11 缺陷②**：本地 `Fees.jsx:modelIds()` 先修掉了「含斜杠即视为已带前缀」的错判据（那会复制出 `cline-free/grok-4`，而 `runtimeForModel` 按**第一个** `/` 拆渠道 ⇒ `provider "cline-free" is not configured`）。上游的契约更完整一层：**已以 `ch/` 开头的名字必须原样保留**，否则重复拼接成 `workbuddy/workbuddy/*`。本地 `modelIds()` 已按此补 `startsWith` 护栏，费率表与模型查找两处同源（`collectAllModels` 也走它）。回归 `webui/tools/render-check.mjs` 场景 6 的双向用例 |
| R53b | **OpenCodeZen 免费档会话头须是官方 `Identifier.descending()` 编码，非仅 `ses_` 外形**（2026-10-14，用户报 `403 FreeTierError`，上游官方 PR #69/#70） | **现象**：oczen 全部对话恒 403「OpenCode's free tier can only be used from within OpenCode」。**根因**：免费档不仅校验会话外形 `ses_<12位小写hex><14位Base62>`，还把 12 位 hex 时间戳段**解码**成官方客户端 `Identifier.descending()` 的值——`~(unix_ms<<12|counter)` 取低 48 位，故末三位是 `0xFFF-counter`；实测只接受 **counter 1–63**（末三位 `0xFC0–0xFFF`），超出即判非官方客户端 403。旧实现的时间戳段是 `sha256` 摘要前 6 字节（随机 hex），落进被拒窗口 ⇒ 恒 403。**修法**（移植上游 #70 终态，非 #69 的钟表铸造版）：`canonicalSessionID` 保留真正 descending 编码的官方 ID，其余（摘要段 / 升序 ID）确定性重编码——哈希前 6 字节按 `descendingTimePart` 渲染成 36 位时间戳移位进 48 位字高位、OR counter=1、按位取反（末三位恒 `ffe`，counter 落在允许窗口）。判定用 `descendingTimePartPattern = ^[0-9a-f]{9}f[c-f][0-9a-f]$`（覆盖 counter 1–63）。确定性 ⇒ 同一会话仍稳定映射同一 session（prompt cache / key 亲和不破）。**接线点唯一**：`internal/oczen/client.go` `canonicalSessionID`（ChatStream / TestKey / FetchModels 三处共用）。**合并期实测复核（2026-10-14，本仓）**：直连上游逐值对照——`ses_ecc5beb7cffe…`（counter=1）200、`ses_4892557ffffe…`（counter=48）200、`ses_ecc1f76c9f9b…`（counter=100）403、两个旧摘要段形态均 403 ⇒ 上表判据与修复均成立，非推断。回归：`TestCanonicalSessionIDKeepsGenuineDescendingIDs`（官方编码原样保留）/ `TestCanonicalSessionIDReencodesForeignEncodings`（摘要段+升序 ID 重编码且不保留原值）/ `TestDescendingTimePartLayout`（末三位 `ffe`）+ 实盘 `internal/oczen/live_test.go`（`-tags live` + `OCZEN_LIVE=1`，已实跑通过） |
| R53 | **usage 缓存计量只归一化「形状」不得改语义；取数逻辑收敛为唯一真源**（2026-10-13，issue #104） | **背景**：trae 系（traework/traecode）上游下发的是 **Anthropic 命名**的缓存字段（`cache_read_input_tokens` / `cache_creation_input_tokens`），而内层原样透传 ⇒ 下游按 OpenAI 规范解析（DSH 实测读法 `prompt_tokens_details?.cached_tokens ?? prompt_cache_hit_tokens ?? 0`）两条都命中不了 ⇒ **命中率恒 0%、prompt 全按未缓存计价**（以其价表 input 0.165 vs cacheRead 0.0033 计，费用高估约 50 倍）。**注意 issue 的定位不准**：它指向 `internal/upstream/sse.go`，但 trae 系根本不走那里（走 `internal/traework/solosse.go`），照抄会修不到。**决策一：归一化方向是「内层补齐 OpenAI 形状」，不是「让下游兼容 Anthropic」**——后者要改所有客户端，且与 OpenAI SDK / AI SDK / DSH 的实际读法相悖。新增 `provider.NormalizeUsageShape`（优先级 `prompt_cache_hit_tokens` > 顶层 `cached_tokens` > `cache_read_input_tokens`；**只在目标子字段缺失时写入**、**原始字段一律保留**、**认「字段存在」而非「值 > 0」**——0 是有效值）。接线：traework 流式在 **token_usage 捕获点**归一化（覆盖 onUsage 回调 / 返回值 / 不含 done 的异常收尾三条路径）+ 非流式 Aggregate 出口。**决策二：缓存取数收敛为唯一真源 `provider.ExtractUsageCache`**——此前面板 `server.cacheUsageOf`、`/v1/responses`、`/v1/messages` **各写一套优先级且已开始漂移**（两个转换器先读顶层裸 `cached_tokens`，而它在 workbuddy 系实测恒 0 是噪声，会把真值掩盖；且用 `> 0` 判定会把「明确未命中」丢成「未提供」，违反不变量 24）。收敛后三处必然同源。**决策三：`/v1/messages` 的 `input_tokens` 必须扣减缓存**——Anthropic 的 `input_tokens` 是「未命中且未写入」的那部分，客户端自行相加还原总输入；而内层 `prompt_tokens` **已是总输入**（命中是其子集）。**不下发 cache 字段**（费用高估）与**下发了却不减**（客户端求和近两倍）都是错的，故 `input_tokens = prompt_tokens − cached − write`，三段相加恒等于原 `prompt_tokens`（钳 0 防坏数据）。回归：`internal/provider/usage_test.go`（含 trae 真帧 / 显式 0 / 幂等 / 坏数据）、`internal/traework/usage_cache_shape_test.go`（双出口）、`internal/gateway/usage_cache_test.go`（responses：噪声字段优先级 + 显式 0）、`internal/gateway/anthropic_usage_test.go`（messages：三段守恒 + 非负 + 流式），四文件回退到修复前**新测试全部失败**（已反向验证） |
| R54 | **模型降级链只在「模型全冷」触发：不粘滞自动切回，降级必须可感知**（2026-10-14，PR #106 + 收尾） | **需求**：主模型被时段性平台频控全池冷却（6004/14003）时 fail-fast 503 打断 agent 任务；用户可预配有序备胎链（`config.model_fallback[]`，`{from,to[]}` 全局唯一、不自环、`channel/model` 全路径，面板可视化编辑 + `POST /api/config/model_fallback` 热生效）。**触发判据**：`runtimeCapacity` 一次 `Pool.List()` 同时得 hasHealthy 与 modelAvail（口径同 no_healthy_account「模型全冷」分支），仅 hasHealthy && !modelAvail 才查链；未配置规则时零探测（「正常路由零开销」承诺）。**不粘滞**：每请求按原模型重判，解冻自动切回（与 R29 分层：粘性是账号级、降级是模型级且用户显式配置）。**感知通道双保险**：① 响应头 `X-Model-Fallback: 请求模型 -> 备胎`（内层 WriteHeader 前设置；**兼容层必须在 `callChat` 统一转写**——/v1/responses、/v1/messages 响应体由网关重建且 model 回填请求名，不转写 = 对 Codex/Claude Code 静默换模型，PR 原版漏了这层）；② chat 面响应体 `model` 字段写备胎全路径（agent 读 chunk.model 即可感知）。**恢复探针只认 primaryAvail**：「未降级」≠「已恢复」——原模型仍全冷但备胎也没容量、或整渠道无健康账号时不得关事件（PR 原版 else 分支无条件调 NoteFallbackRecovery ⇒ 面板先显示恢复再重开一条、持续时长失真，已修）。**记账口径**：token 流水仍按客户端请求名（面向「这一发花多少」），实际执行模型走日志行 + 面板「降级记录」区块（内存环形 200 条、重启清零）。**已知限制**：无规则时不做容量探测 ⇒ 删规则后残留进行中事件不自动关（环形淘汰）；To 不做模型存在性校验（错名吃上游权威错误或本地 400）；备胎配额/余额不预判（容量仅看冷却态）。回归：`model_fallback_test.go`（触发/链序/热更新/切回/跨渠道隔离 + 恢复不谎报）、`stats/fallbacks_test.go`、`gateway/fallback_relay_test.go`（四端点转写 + 无降级不造头）、`scripts/ui-static-check.mjs` 面板接线 9 条 |
| R55 | **traework/traecode 模型元数据取上游下发；展示用字段必须容错承接，不得拖垮整张目录**（2026-10-14，PR #108 + 收尾） | **背景**：`poolEntry` 只解析 config_name + display_name ⇒ 两渠道 118 个模型全无 context_length/max_output_tokens、图片能力恒 false（客户端误判不能发图、或因上下文未知过度压缩）。**上游证据**（实测 `get_detail_param` HTTP 200/1.35MB/71 条）：`context_window_tokens.{dev,max}`、`display_config.multimodal`、`model_detail_list[].max_tokens`。**折算口径**（对齐不编造原则）：ctx 取 max 档、缺省回 dev、双缺省不填；max_tokens 为 0 不填；`ContextFromAPI` 仅在解析到容量时置 true；multimodal 直取上游布尔。**关键教训——爆炸半径**：强类型结构会因上游形状突变（对象→标量）让整批 unmarshal 失败 ⇒ `fetchModelsForPool` 报错 ⇒ 本渠道池整体拉不到；而这两个字段只是展示用增量信息，故用 `json.RawMessage` 承接、解析失败只丢该字段（同 qodercn.parseContextConfig 既有手法，不变量 5 同族哲学）。回归：`modelmeta_test.go`（容量折算四形态 + 三种形状突变，去掉 RawMessage 即失败）。`display_config.model_capability`（reasoning_model/chat_model）已解析未消费，仅记录上游形态 |
| R56 | **tool schema `$ref` 全量内联消毒：moonshot 系对任何保留的 `$ref` 都不认账**（2026-10-14，PR #109 + 收尾） | **背景**：Kimi/Moonshot 系（trae solo 后端）对 `tools.function.parameters` 含 `$ref` 即按「moonshot flavored json schema」展开校验，不收敛整体 400 `code=4027 detected infinite recursion`；官方客户端不发 `$ref`，代理客户端（经 MCP 接入）会发。**两版演进**：v1 只打断成环、保留非环 `$ref` —— 生产实测被否（3 个 `ref_before=1` 的 tool 放行后仍 4027）；v2 全量内联：所有本地 `$ref` 就地替换为目标消毒副本，展开链成环处（含 `#`）截断为空 schema（JSON Schema 语义 = 接受任意值），非本地/不可达/超预算（4096）同样截断，结果零残留；语义损失仅限递归分支处。**要点**：不按模型名门控（客户端可用不含 kimi 的自定义别名）；支持 parameters 预序列化字符串形态（原样透传会绕过消毒）；时序在 `normalizeTools` 字符串化之前；`$ref` 兄弟键按 draft-07 丢弃。**零改动原则（收尾补上）**：无 `$ref` 的请求一个字节不动——回写 Marshal 结果会重排键序、改写数字字面量（1e9→1e+09）污染上游 prompt 缓存前缀，string 形态旧版还按工具数刷日志（agent 一发 20 工具 = 20 行 app.log）；同样口径下空串 parameters 不记「str-unparsed」。**PrepareBody 改写数由三变四**（不变量 1）。回归：`schemacycle_test.go`（自引用/互递归/菱形/根引用/非本地/预算/字符串形态/端到端 14 用例）+ `TestBreakToolSchemaCycles_LeavesRefFreeParamsUntouched`（无 `$ref` 逐字节不动）；生产实测同形态请求消毒后 0 次 4027 |
| R57 | **代理配置改为「全局备用上游通道」：默认不参与任何请求，仅渠道按需取用（当前 cline 与 oczen）**（2026-10-14，用户裁定） | **动机**（旧「每渠道代理」的三处实证缺陷）：① 面板 12 行输入，而热更新接线表只覆盖 9 行（`monkeycode/raccoon/loomy` 改代理不生效、需重启），`trCodeUp`（TraeCode 自己的 client 实例）**两张表都没进** ⇒ 该渠道代理从未生效（R34 同族静默失效）；② `SetTransportProxy` 每次保存都**新建 Transport**，杀光 idle 连接且要手工继承 `ResponseHeaderTimeout`（oczen 120s 的特例注释就是这个补丁）；③ 对用户是 12 个概念，实际只需要一个。 **新语义**：`config.backup_proxy` 单一地址（http/https/socks5）= **备份链路**，由 `internal/backuplink` 原子持有；**不影响本工具的任何请求**，仅由渠道自行判定后按需取用（`backuplink.Client(base)` 克隆渠道自己的 Transport、只改出口 ⇒ 除 IP 外与该渠道出厂行为同构，不引入新超时/协议差异）。当前唯一取用方 cline：`ChatStream` 直连命中 `IsRegionBlocked`（403/451 + 保守文案表 `regionRetryMarkers`，比 `regionBlockedMarkers` 严——判据宽了会把非地区错误也发到第三方出口）⇒ **同一次请求内**用备用链路重放同一 body。 **三条硬约束**：① 未配置 / 重放拨不动 / 重放仍被地区拒 ⇒ **透传直连那份**原始 status+body（R37：不得用第二次尝试的错误掩盖首因；代理故障只进日志）；重放拿到**不同的**上游答复则以它为准；② 重放只换出口 IP、**不是换账号** ⇒ handler 挑号/惩罚/粘性路由/R29 轮换语义零改动，地区限制继续不罚号（R46 的 `ErrPassthrough` 不变）；③ 命中一次后 6h 内该模型**直接走备用**（免每发先白撞一发 403：既省 0.3~2s，也避免在上游留重复失败特征），`backuplink.Generation()` 一变即作废；备用链路自身不可用（拨不动、或上游改到只对备用出口挂地区限制）⇒ 立即作废学习结果并**本轮回落直连**（代理故障不得把本来可用的模型钉死，也不能等 TTL 到期）；反过来主链路（直连）拨不动仍按传输层错误冒泡，交给 handler 计错/换号。 **oczen 不接**：其上游对抗策略已变更、渠道当前不可用，`RegionError` 继续按 R16/不变量 22 原文透传；待恢复后自行取用 backuplink（本包零接线，无需改 main）。 **清理**：删 `config.proxies`、`applyProxies`/`applyProxyToKind`/`SetTransportProxy`/`proxySyncer`、`POST /api/config/proxies`、面板 12 行输入。旧 `proxies` 段在 `normalize` 一次性迁移进 `backup_proxy`（优先 cline 的值，其余渠道地址**丢弃**并在日志点名：除 cline 外的渠道不再支持代理）；旧值不合法则不迁移只记日志（不把启动拉死）。新端点 `POST /api/config/proxy`（同时承载 oczen key），`/api/state` 回 `backup_proxy`/`backup_proxy_active`。 **已知限制（如实披露）**：登录编排（`login_*/NewClient`）、CDP、面板内凭证测试仍不吃备用通道（保持「只服务上游通信」的边界）；若某渠道连登录都被地区拒，本设计无法解决。 **回归**：`internal/backuplink/backuplink_test.go`（判据唯一来源/未配置零影响/generation 递增/按 base 复用连接池）、`internal/cline/backup_proxy_test.go`（假上游 + 假转发代理 8 例，去掉重试分支即失败）、`cmd/wild-work/transport_test.go`（凡进 runtimes 的渠道必须进 wrapDumps 表，并禁止再出现按渠道套代理的接线）、`internal/config/backup_proxy_test.go`、`internal/app/backup_proxy_test.go` |
| R58 | **流被截断必须自证原因：空闲看门狗掐的 ≠ 上游断的；`stream_idle_seconds` 配置项从未存在，注释是空头支票**（2026-10-14，现场 QoderCOM 截断排查） | **现场**：`Qwen3.8-Flash (QoderCOM)` 输出一部分后客户端报 `Error: upstream stream truncated`。**根因一（诊断缺口）**：qoder/qodercn/qodercom/qwenwork 四个 `streamAsOpenAI` 把 `parseNestedSSE` 出参 `truncated` 当成唯一信息，收尾分支写**固定串** `"upstream stream truncated"` 且 `return errors.New("upstream stream truncated")` —— **原始 err 被彻底丢弃**，而该 `truncated` 同时覆盖「传输层读错误」「EOF 停在半帧」两种来源，于是三种完全不同的故障在日志与客户端**完全同形**：① 空闲看门狗主动掐的（`internal/idle` 连续无字节 300s，疑似上游排队/卡死）；② 上游主动断连（connection reset / unexpected EOF）；③ 读到半个帧就 EOF。与 `internal/upstream/sse.go:718` 保留 `err.Error()` 的做法不一致（R36 家族）。**根因二（判据不可达）**：`internal/idle` 看门狗唯一的动作是 `cancel()` 请求 context，在途 `Read` 返回的是 **`context canceled`**（httptest 真实链路实测，非推断），而 `provider.IsIdleTimeout` 只认 `errors.Is(err, ErrIdleTimeout)`（那个变量只有 `IdleReader` 家族会返回）⇒ **看门狗掐断在语义上根本认不出来**，即便保留了 err 也只是印一句 `context canceled`，反而更容易被误读成「客户端断开」。**修法**：① `provider.IsIdleTimeout` 扩展识别 idle 看门狗族（`context.Canceled` / `context.DeadlineExceeded` / `net.ErrClosed`），并在注释里写明「认不出则两种故障同形」；② 新增 `provider.TruncationCause/TruncationError/TruncationCode/TruncationFrame/WriteTruncationFrame` 一族：错误文本保留原因、空闲超时**统一归一成 `upstream stream idle timeout` 措辞**（不直写 `context canceled`，否则日志检索漏一半）、出口帧 `code` 分流为 `upstream_timeout` / `upstream_truncated`、帧体走 `json.Marshal` 而非字符串拼接（原因文本含引号/反斜杠时会造出坏 JSON 帧）；③ 四个渠道的截断分支改调该族，与 `internal/upstream/sse.go` 口径对齐。**⚠️ 刻意不动 qwenwork 的两处差异**：它的截断处理与 qoder 三兄弟**是两套独立实现**（`qwReadErr`/`qwCut` 测试夹具与 qoder 不同，行号 333 vs 279），故四处分别改而非抽公共包——本仓渠道包历来不共享 SSE 实现（R36 同款处置）。**根因三（空头支票注释）**：cline/loomy/raccoon/monkeycode 的 `Client.IdleTimeout` 与 `DefaultIdleTimeout` 注释都写着「由 main 注入 `config.upstream.stream_idle_seconds`」，但 `config.Upstream` **只有 `timeout_seconds` 一个字段**、`main.go` **零处赋值** ⇒ 阈值恒为硬编码（idle 包 300s / 四渠道 90s）。按用户裁定**清理注释而非补配置项**（不新增用户概念）：改成如实写明「目前没有配置项，恒取默认值」。**日志补强（同一现场的可观测性）**：`stream relay end` 原先只打 `err`，现补 `model` / `elapsed=%.1fs` / `ttfb=%dms` —— 只有这两个数字能把原因分开：**耗时 ≈ 空闲阈值且 TTFB 远小于它 ⇒ 看门狗掐的；耗时远小于阈值 ⇒ 上游自己断的**。**已知限制（如实披露）**：`elapsed` 含上游首字节等待时间，若「排队」发生在响应头之前（qoder 三渠道 Transport **未设** `ResponseHeaderTimeout`，该阶段实际无上限）则耗时会被首字节等待抬高，判据需结合 TTFB 一起看；空闲阈值仍不可配（要改需改常量或补配置项）。**回归**：`internal/provider/truncation_test.go`（看门狗族识别 + 四种原因的文本/错误码/`errors.Is` 穿透 + 恶意原因文本仍产出合法 JSON + 帧不含 `[DONE]`）、`internal/qoder/idle_truncation_test.go` 及 qodercn/qodercom/qwenwork 三份同源副本（**走真实 httptest + `idle.Monitor` 链路**，而非假 reader——只有真实链路能证明「看门狗 cancel → 在途 Read 返回 `context canceled` → `IsIdleTimeout` 认出 → `code=upstream_timeout`」这条链成立；假 reader 直接返回 `provider.ErrIdleTimeout` 会绕开最关键的一环）+ 对照用例「上游主动断连必须落 `upstream_truncated`」。**已双向验证**：临时把 `IsIdleTimeout` 的扩展判定改回 `return false`，四渠道用例与 provider 用例全部失败（错误文本退化成 `context canceled`、出口帧 code 变 `upstream_truncated`）。 |
| R59 | **Cline 渠道对外模型 ID 直通上游命名空间：`cline-free/*`（不再拼 `cline/`），旧双层写法保留路由兼容**（2026-10-14，用户裁定） | **背景**：Cline 上游免费池的模型 ID 自带命名空间（`recommended-models` 的 `free[]` 原样透传，见 R46），而 R52 的「kind 永远是第一个路径段」把对外 ID 变成了 `cline/cline-free/*` 双层路径。用户裁定：**本渠道特殊处理，模型 ID 直接透传上游前缀**（面板点击复制的就是客户端要填的串），避免双层路径这种反直觉形态。**契约（唯一判据在 `provider`）**：`provider.PublicModelID(kind, upstreamID)` = 上游 ID 自带已声明命名空间时原样返回，否则拼 `<kind>/`；`provider.SplitModelID(model)` 反向解析为 (渠道, 上游模型名)，接受两种写法：`cline-free/x` → (cline, **整串**) 与 `cline/cline-free/x` → (cline, 去一层后的 `cline-free/x`)。**兼容**：旧写法不失效——老配置的 `model_map`、降级链规则、老客户端都是那种写法，路由/网关/降级链匹配全部经同一解析器。**接线（6 处必须同源，R52 就是漏了一处）**：① `server.buildModelEntry`（`/v1/models`）；② `server.runtimeForModel`（同时它是**降级链** `pickModelFallback` 的解析器）；③ `gateway.Router.Resolve`（三接口兼容层的前缀校验 + `default_channel` 兜底拼接改用 `provider.ModelIDPrefix`，否则裸名会被拼成 `cline/<x>`）；④ `app.buildFeesChannels` 新增 `id` 字段（客户端要填的完整 ID），面板两处复制改为**直接用 `m.id`**、不再在前端拼前缀；⑤ `stats.channelOfModel`（否则 `cline-free/*` 不进平台表——顺带修了一个既有 bug：`channelKind` 白名单漏 `cline`，cline 的 token 一直不进平台行）；⑥ handler 的统计/流水归行改用 `provider.CanonicalModelID`（新旧写法必须落同一行，否则同一模型在用量榜裂成两行）。**回归**：`internal/provider/modelid_test.go`（两个方向的解析 + 归一 + 前缀）、`internal/server/model_id_contract_test.go`（`/v1/models` 只广告上游 ID；两种写法端到端都能 200 且**发给上游的 model 是 `cline-free/*`**）、`internal/gateway/gateway_test.go:TestModelResolutionClineNamespace`（命名空间放行 + default 前缀）、`internal/stats/usage_test.go`（两种写法都归到 cline）、`scripts/ui-static-check.mjs`（两处复制断言 `cline-free/*`） |
| R60 | **「单号渠道 402」的处置是模型级冷却，不是账号级、也不是纯透传**（2026-10-14，PR #113 + #114 合并期裁定） | **背景**：402（权益不足/欠费）此前不在任何冷却/降级触发条件内，存在两个缺口。**缺口一（流内嵌错误无法分类）**：qwenwork 等渠道的 402 以 HTTP 200 + 流内 envelope 形式返回，`parseNestedSSE` 剥壳后以裸 `fmt.Errorf("upstream %d: %s")` 返回 ⇒ handler 三条错误路径的 `errors.As` 全部错过。**修法**：改抛 `*sseError` 并实现 `provider.StreamErrorClassifier`（`Kind()` 返回 `Classify(status, msg)`），错误文案保持 `upstream <status>: <msg>` 不变（客户端可见文本零变化）。**缺口二（单号渠道 402 只透传、不冷却）**：原策略「单账号不罚账号、原文透传」对 402 不适用——账号本身健康，死的只是「账号×该模型」组合，不冷却则每次请求继续撞 402、降级链永不触发。**修法**：三处接入 `CooldownModel(uid, model, HardCooldown)`——① 预流式 `SingleAccount` 分支（`kind == ErrHardCredit` 时冷却该模型、本次仍原文透传）；② 流内 `len(Pool.List()) <= 1` 分支（**去掉 `&& !rt.SingleAccount` 限定**，冷却后透传）；③ `Aggregate`（非流式）出口用 `errors.As` 取分类后同样冷却。**关键边界（必须与不变量 22 合读）**：冷却的是**模型级**条目，账号本身照旧不罚 ⇒ 同号其他模型照常可用，不变量 22 的「不得施加任何账号级惩罚」未被违反；仅当短时间内第二个模型也撞墙时由 `CooldownModel` 既有逻辑升级整号（那才是账号级）。**适用范围比字面更宽**：`SingleAccount` 渠道与「池内只有一个账号」的普通渠道（qwenwork 单号）同受益。回归：`internal/qwenwork/stream_truncation_test.go` 分类断言、`internal/server` 相关用例 |
| R61 | **模型降级链必须在启动时载入，不得只靠面板保存的热更新通道**（2026-10-14，PR #112） | **缺口**：`server.Config.ModelFallbacks` 字段注释声明为「降级链初始值」，但 `cmd/wild-work/main.go` 构造 `server.Config` 时**从未赋值**；降级链唯一生效通道是 `appInst.SetModelFallbackSyncer`（面板保存触发）。⇒ **进程重启后 handler 内降级规则为空，已配置的降级链静默失效**，直到用户在设置面板重新保存一次才恢复（R34/R41 同族的「声明了却没接线」）。**修法**：装配处补 `ModelFallbacks: cfg.ModelFallback`，与热更新通道并存（后续保存仍走 syncer 覆盖）。**通用教训**：凡「配置项 → 内存态」的注入，**启动路径与热更新路径必须各有一条**，只实现后者等于把功能做成「保存过才生效」。 |
| R62 | **OpenCodeZen 同接「备用上游通道」：免费档地域受限模型同请求内自动换出口重放；编排抽到 `backuplink.Replay` 与 cline 共用**（2026-10-14，用户裁定） | **背景**：2.7.2 修复 oczen 免费档后，该渠道的部分免费模型（`muse-spark-*-contributor-free` 实测）直连仍回 403 `{"type":"error","error":{"type":"RegionError"…}}`；用户要求 oczen 也走备用通道（未配全局代理时本次验证用 `http://127.0.0.1:10809`）。**为什么抽公共编排而不是复制一份**：这套规则的语义很细（① 未配/拨不动/备用同样受限 ⇒ 交出**直连那份**原文，首因不被第二次尝试掩盖；② 备用自身不可用 ⇒ 作废学习结果并**本轮**回落直连；③ 只有备用确实给出可用答复才记学习结果；④ 学习结果随 `backuplink.Generation()` 作废），分散两份必然改一处漏一处（R52 的教训）。故新增 `internal/backuplink/route.go`：`Replay`（编排）+ `Routes`（学习路由，6h TTL、按 generation 作废），渠道只提供 `Attempt`（用给定出口发一发）与 `Blocked`（什么算地区限制）两件渠道相关内容。cline 改为调用它（行为不变，原有 8 例回归全绿），oczen 新接入。**oczen 侧判据**（宁窄勿宽：命中会多发一发经第三方出口的请求）：仅 403/451 + 文案含 `regionerror`/`not available in your region|country`/`geo-block` 才算——`FreeTierError`（会话形态）与 429 一律不重放。**与单账号豁免的关系**：备用通道只换出口 IP、**不涉及账号**，故 `SingleAccount` 语义不变；改道发生在渠道内部（`ChatStream`），成功时 handler 完全看不到 403，失败时仍按 R16/不变量 22 原文透传（`Classify` 的 `ErrPassthrough` 注释已同步说明）。**实现细节**：oczen 的 `attempt` 把 `idle.WithCancel` 的 cancel **随本次响应走**（在 attempt 内包 `idle.Monitor`，非 200/失败路径就地 cancel），不依赖「最后一次 attempt 恰是成功那次」的隐式顺序，也避免 `ErrNoBackup` 提前返回路径漏调 cancel 泄漏 context。**实盘验证（独立实例 + 真实上游 + 10809）**：未配代理时 mimo 200 / muse 403 原文透传（日志「未配置备用上游代理，原样透传」）；配代理后 mimo 仍直连 200（不误伤），muse 日志变为「经备用通道拿到上游答复 status=400」（= 流量确已换出口、拿到上游**新**答复）；关代理后回到 403 透传。**已知限制（如实披露）**：`muse-spark-*-contributor-free` 经该出口被上游判 400 `ModelProtocolUnsupported`（同一出口下 mimo/big-pickle/nemotron 均 200）⇒ 本工具的职责边界是「换了出口、把上游权威答复原样交出」，模型在某个出口下能否用由上游决定，本工具不承诺。**回归**：`internal/oczen/backup_proxy_test.go`（7 例：无代理透传 / 配代理改道成功 / 学习路由免白撞 / 双链路受限保留首因且不学习 / 非地域 403 绝不重放 / 备用拨不动保留首因 / 判据单测）、`internal/cline/backup_proxy_test.go`（重构后仍全绿）、`internal/backuplink/route.go` 由两渠道共同覆盖。 |
| R63 | **思考强度映射是「出站注入」，与 R49 的「只透传上游声明」互补**（2026-10-15，PR #118） | **背景**：issue #96 要求数据面透出思考档位，R49 已解决「对外**暴露**上游声明了什么」（未声明时整个 reasoning 对象不出现，绝不编造）。本决议解决另一半：「客户端**没说话**时，是否按用户配置**注入**档位」。**契约**：`config.reasoning_efforts`（`map[string]string`，键=`channel/model` 全路径或 `*` 全局默认，omitempty）→ 启动经 `server.Config.ReasoningEfforts` 载入（**R61 同款教训：只有热更新通道等于「保存过才生效」**），面板保存走 `POST /api/config/reasoning_efforts` → `app.SetReasoningEfforts`（trim 校验键值非空 → 落盘 → `SetReasoningEffortsSyncer` 推给 `handler.SetReasoningEfforts`，`efMu` RWMutex 保护）。**注入三态（哑管道）**：① 顶层**已有** `reasoning_effort` 键（任意值含 `null` = 客户端显式意图）⇒ 一律不碰；② 未带且精确命中 ⇒ 注入；③ 精确未命中回退 `*`；皆无 ⇒ 不注入（上游吃模型默认档）。**不校验档位取值合法性**（支持什么档位由渠道模型自己决定），注入失败仅记日志、**原 body 照发不中断请求**。**接线位置**：`handler.chatCompletions` 在 `runtimeForModel` 之后、**降级链选完备胎之后**、`rewriteModel` 之后调 `applyEffort(body, clientModel)`——注入键用**客户端请求模型名**（用户是按“我请求的那个模型”配的档位），且与 R54 降级链无耦合。**零配置零开销**：空 map 时 `lookupEffort` 首行即返回 false（不发日志/不改 body/不 Marshal），对齐 R54「正常路由零开销」。**已知限制（如实披露）**：`none` 档在 WorkBuddy 上游疑似回落默认档（哑管道照实注入不纠正）；**TraeWork 渠道协议无 reasoning 注入点，注入无害但无效**（面板 hint 已写明，不做事前拦截——渠道模型面变化时不应让配置失效）。**回归**：`internal/server/handler_effort_test.go`（7 例注入行为锁定，含键已存在/null/精确命中/回退 `*`/热更新/失败不中断）、`internal/app/reasoning_efforts_test.go`（配置面）、`scripts/ui-static-check.mjs`（编辑区/datalist 建议集/三态文案/接线共 10 项断言）。 |
| R64 | **面板「测试」类探针必须与真实请求同源取用备用通道，并如实回传实际出口**（2026-10-15，issue #117） | **现场**：用户配了备用代理，面板 OC Zen「测试」仍 403，代理日志零访问记录，上游看到真实地区；日志 `kind=passthrough（单账号渠道不罚账号）`。**逐条核实：用户观察全部属实，但根因不是 backuplink 失效，而是测试路径从未经过编排** —— ① `oczen.TestKey` 直接用 `c.HTTP` 直连（`fetchModelIDs` 同理）⇒ 配了代理也不改道，用户看到 403 无从判断「代理没生效」还是「上游本来就不给这个出口用」；② 那行日志写死「不罚账号」，对 403 `FreeTierError` 这种**与账号无关**的错误照印，把真实原因（免费档形态校验/地域）掩盖成「工具的分类问题」。**修法**：① `backuplink.Replay` 新增可选 `Note(viaBackup bool)` 钩子——`Do()` 有 8 处 return，逐处手工标记「这次答复来自哪个出口」必漏（**R52 教训**），故只在两处「交出备用答复」处置 true，由 `defer` 统一上报；② `TestKey` 改走同一份 `Replay`（含 `Routes` 学习路由），签名加 `viaBackup` 出参 → `App.TestOczenKey` → `/api/config/oczen_test` 的 `via_backup` → 面板 toast 标明「直连 / 经备用通道」，403 且走直连时给可行动提示；③ 单账号分支日志补 `body=`（上游原文），文案改为说明**为何**不冷却（无号可轮换），不再断言「所以这不是账号问题」。**通用教训（已升格为规则）**：凡「面板探针/测试按钮」这类只读入口，**要么走与真实请求同一条链路，要么在 UI 上明写它测的是哪条链路**——否则用户会把探针结果当成真实链路的结论（同 R34/R41 家族的「声明了却没接线」，此处是「接线了但不是同一条」）。**边界**：不改 `fetchModelIDs`（模型目录拉取失败本就有静态兜底，且 `/v1/models` 是只读目录非“服务可用性”声明）。**回归**：`TestOczenTestKeyUsesBackupOnRegionBlock`（地区拒→备用 200 且 `via=true`）、`TestOczenTestKeyWithoutBackupReportsDirect`（未配→直连 403 且 `via=false`）、`scripts/ui-static-check.mjs` 面板出口文案断言；既有 8 例 backuplink 用例全绿（编排语义零变更）。 |
| R65 | **小浣熊「每日积分」是惰性落账，签到 = 调一次 `setting_info`（非独立领取端点）；状态判据用 `point_grant_popups` 而非余额差分**（2026-10-15，用户实测驱动） | **背景**：用户提出「小浣熊调用一次就能获取积分，做成签到」。初版结论「无签到活动」**不完整**——上游确实没有领取端点，但每日 300 积分的发放是**惰性**的：名义记账 `grant_at` 是当天 00:00，实际落账 `created_at` 是账号当天第一次访问**工作台业务接口**的时刻（网页端文案原文：「每日积分每天 00:00 发放，默认当日 24:00 清零，**当天登录后**有效期延长至 7 天」）。**接口矩阵（逐项实测，三账号对照）**：`GET /api/web/office/v3/setting_info` ✅ 触发（各入账 300，`point_grant_popups` 非空）；`POST /api/web/llm/v2/chat/completions`（对话）❌ 只扣「桌面端 LLM 对话消耗 -2」；`GET points/v1/balance|bills`（只读）❌；`GET /api/web/auth/v1/user_info` ❌；`POST /api/web/auth/v1/iam/confirm` ❌（HTTP 200 但无发放）；猜测的领取端点（`daily_grant`/`checkin`/`claim`/`login_reward`）**全 404**。⇒ 只有 **office/v3（工作台业务域）**的访问才算「当天登录」，auth/v1 只是身份校验、llm/v2 与 points/v1 无此副作用。**幂等已实测**：同一账号当天重复调用不再发放（第二次 `popups` 为空数组）⇒ **非空 popups ⇔ 本次调用刚触发新发放**，可直接作签到结果判据。**为什么不用余额差分**：同期可能有对话扣费（实测 -2）抵消，差值不可靠；popups 是本次发放的**直接回执**。**实现**：`internal/raccoon/checkin.go` —— `FetchSettingInfo` + `DailyCheckinReport`（`CheckinReporter` 结构化上报）：popups 含 `points>0` → `CheckinClaimed`（`Amount` 为求和）、空 → `CheckinAlready`（**不是** `no_campaign`：本渠道空即代表已完成，判成可重试会导致整天重试）、401 → 类型化 `ErrSessionDead`（供调度器 refresh 自愈，不变量 19）、其它 → `CheckinError`。**接线**：`main.go` 的 `rcSch` 从 `CheckinMinutes: []int{}` 改为全局 `checkinMinutes` + 补 `SetCheckinObserver`/`SetRefreshObserver`（此前**从未设置**——签到接入后不设观察器则面板与 stats 都读不到结果）；`app.go` 的 `noExplicitCheckin` 移除 Raccoon（开放手动按钮）+ `completeRaccoonLogin`/`importRaccoon` 补首次签到；`web/app.js` 的 `NO_EXPLICIT_CHECKIN` 移除 `"raccoon"`。**刻意不设 `CheckinRetryUntil`**：窗口重试是为 Qoder「活动 10:00 后才创建」设计的，本渠道无此语义（发放恒在，只是惰性）。**与网页端同构**：`setting_info` 是网页端每次打开工作台首页都自动调用的接口，故本实现 ≈ 替用户「打开一次网页」，不是跨端伪装（同 R31 的判据）。**回归**：`internal/raccoon/checkin_test.go`（8 例：claimed/已领/字段缺失/401 类型化/5xx 可重试/多 popups 求和/旧通道包装/走 AuthBase 前缀）。 |
| R66 | **支持自定义 OpenAI 兼容渠道接入（`custom_channels`）：统一用量流水、运行统计与模型路由**（2026-10-15，用户驱动） | **背景**：用户已有第三方 OpenAI 兼容 API（如官方 StepFun、本地 CLIProxy、DeepSeek、SiliconFlow 等），希望在 WildWork 统一聚合调度，通过 `渠道标识/模型名` 统一访问，并在面板集中查看用量流水（ledger）与运行统计（stats，含 TTFB、吞吐、请求日志）。**设计**：新增 `internal/custom` 包，实现 `provider.Upstream` 接口（`New(ChannelConfig)`），流式与非流式分别走 `StreamHTTP` 与 `HTTP`（对齐 R35），流式末帧捕获 usage 记账，SSE 逐帧重写 model 名回填客户端请求名。**单账号属性**：置 `SingleAccount: true` 与 `NoCooldownOnServerError: true`（对齐 R16/R24），错误原文透传不拖垮整条渠道。**配置面**：`config.json` 顶层 `custom_channels[]`（`name` / `base_url` / `api_key` / `models` / `enabled`）；设置弹层支持可视化增删改、连通性测试（`POST /api/config/custom_channel_test` 探测 `/models`）；保存走 `POST /api/config/custom_channels` 并热生效（`SetCustomChannelsSyncer` 同步热更新 `server.Handler`、`app.Runtime`、`gateway.Compat` 路由白名单与 `stats.RegisterChannelKind`，无需重启）。**合并期修复的五条缺陷（均有代码证据、非推断）**：① **`a.runtimes` 并发读写会在保存时打死进程**——`UpdateCustomRuntimes` 是本仓**首个 post-init 写**（此前该表只在 init 赋值一次），而 9 处读点（含 30s ticker 的 `allStatuses` 与 `/api/state`）全程不加锁 ⇒ 面板保存与后台喂入重叠即 Go 的 `fatal error: concurrent map read and map write`（不可 recover）。修法：新增 `runtimesMu` + `runtimesSnapshot()`，全部读点经其取浅拷贝遍历。回归 `TestRuntimeTableConcurrentAccess`（反向验证：去掉锁 5/5 崩溃）。② **compat syncer 捕获启动快照会丢新渠道**——`SetCompatSyncer` 闭包写死 `initialChannels`，于是「先加自定义渠道、之后单独改模型映射并保存」会把白名单重置回启动态，`/v1/responses` 与 `/v1/messages` 报 unknown channel（R61 同族的「只实现一条通道」）。修法：抽出可变共享态 `channelList`（`cmd/wild-work/main.go`），两条 syncer 共读 `snapshot()`。回归 `TestChannelListSharedAcrossSyncers`。③ **自定义渠道名可与内建同名**——`channelNameRegex` 放行 `workbuddy`/`cline`/`oczen` 等，而 server 侧 `getRuntime` 内建优先、app 侧 `UpdateCustomRuntimes` 无条件覆盖 ⇒ 两层指向不同 Runtime（面板操作打到自定义池、对话走内建渠道，静默出错）。修法：`provider.BuiltinKinds()`（含 `ModelNamespaces` 键）+ `ChannelConfig.Validate` 拒绝。回归 `TestChannelConfigValidateRejectsBuiltinNames`。④ **「费率表全线展示自定义渠道」是假承诺**——`FeesInfo` 只遍历静态 `feeChannelOrder`，自定义 kind 永不出现（与 `/v1/models`/ledger/stats 的可见性不一致）。修法：`feeChannelOrderWithDynamic` 把 `modelsByKind` 中未登记的渠道按名排序追加到末尾。回归 `TestFeesOrderIncludesDynamicChannels`。⑤ **`/api/state` 明文回传上游 api_key**——`st.CustomChannels = a.cfg.CustomChannels` 直出配置，而 oczen key 是脱敏回显。修法：`maskCustomChannels` 脱敏（保留 `…` 供识别「未改动」）+ `SetCustomChannels` 按渠道名找回真实密钥（否则脱敏值落盘会把密钥换成废值，下次请求全 401）。回归 `TestCustomChannelKeyMaskedRoundTrip`；且 `/api/config/custom_channel_test` 收到含 `…` 的 key 时按 `name` 找回真实密钥（否则未改动过的渠道点「测试」恒 401，同 R64 的探针不同源），回归 `TestCustomChannelTestEndpointResolvesMaskedKey`。**合并 #120 后的两轮收尾**：⑥ **设置弹层打不开**——#120 旧 head 的 `openSettings` 悬空引用已废弃的 `inCustomModels` 节点（`$()` 返回 null，取 `.value` 抛 `TypeError`），且 index.html 从无该节点；已删引用并补**通用悬空 DOM 引用静态检查**（扫 app.js 全部 `$("id")` 与 index.html 的 id 集比对，动态创建的 `creditTip` 白名单），双向验证过。⑦ **#121 的三条**（R66 延续，merge 9767a78）：字符串形态模型 `SupportsTools` 落 false（字符串分支提前 return 跳过缺省赋值 ⇒ `/v1/models` 静默不带 supports_tools）、显式 `supports_tools:false` 落盘即丢（bool+omitempty 会省掉 false，读回变 true ⇒ 改 `*bool` + `ToolsEnabled()`）、单位串解析错误被吞（`"1OO"` 静默落 0 ⇒ 改为上抛，配置层报出渠道与字段）；另 `style.css` 被整文件改成 LF 造成 1090 行伪 diff（仓库无 .gitattributes、其余 Web 文件均 CRLF），合并时恢复 CRLF。**回归**：`internal/custom/custom_test.go`（配置校验/流式/非流式/模型发现/测试连接/内建同名拒绝）、`internal/server/custom_channel_test.go`（路由/模型列表/热更新）、`internal/app/custom_channel_test.go`（API/设置保存/视图/密钥脱敏回环/费率表含动态渠道/运行时表并发）、`cmd/wild-work/custom_channels_test.go`（装配/共享渠道清单）、`scripts/ui-static-check.mjs`。 |
| R67 | **对外显示名改为 `cy-work`、面板 logo 换为仓鼠图；只动前端界面层，后端标识一律不改**（2026-10-20，所有者裁定） | **口径**：本次只改 **React 面板显示的名字与 logo**。Go 模块名 `wild-work`、`cmd/wild-work/` 目录、二进制 `dist/wild-work*.exe|linux`、`WILDWORK_*` 环境变量、macOS 数据目录 `~/Library/Application Support/WildWork`、Windows 自启动注册表值、systemd 单元 `wild-work.service`、GitHub 仓库与仓库目录**全部保持原样**——它们被生产部署、既有 `dist/config.json`、客户端脚本与上游融合流程依赖，改动的收益仅是文案，代价却是停机与断链。**改动点（5 处显示 + 1 处注释 + 1 张图）**：`webui/index.html` 的 `<title>`、`App.jsx` 顶栏标题与两处页脚、`Misc.jsx` 关于弹层标题、`style.css` 首行注释（不显示）；`webui/public/logo64.png` 换成 `build/clawd-theme/incoming/reference-character.png`（320×320 透明底）派生版——按 `cmd/genicon` 同款去留白算法（alpha>60 的 bbox + 4% 边距）裁成 64×64，vite 构建时拷进 `web-app/`，两处 `<img>` 引用（顶栏 26px / 弹层 64px）走 `BASE_URL`，代码零改动。**唯一的后端改动**：默认 API Key `WildWorkAPI` → `CyWorkAPI`（`config.Default()`，所有者确认）——现有 `dist/config.json` 显式写的是旧值 ⇒ **生产与既有客户端不受影响**；`config_test.go` 断言与 `config.example.json` 同步，README 6 处示例同步（否则新装用户照文档配会 401）。**刻意不改**：托盘图标 / exe 图标 / 根 `icon.png` / `build/*`（非前端界面，故托盘仍是旧 logo）、登录回调页文案（`internal/login_*/callback_page.go`）、托盘提示与启动通知（`main.go`）、冻结的 `cmd/wild-work/web/` 与各 `web_*` 备份目录、README/DEVELOPMENT 里的项目名与全部 `rockswang/wild-work` 上游链接、`RELEASES.md` 与 `data/app.log` 的历史记录。**已知痕迹**：`scripts/probe-dump.sh` 的 `${WILDWORK_API_KEY:-WildWorkAPI}` 兜底值保持旧值——它探的是正在运行的生产实例，而生产 `config.json` 未改。**验证**：`npm run build` + `npm run check`（9 场景）、`go build/vet/test ./...`；沙箱 `127.0.0.1:28763` 实测标签标题/顶栏/页脚/关于弹层与 logo（无 404）；重建 `dist/wild-work.exe`。**生产生效**需重建 `dist/wild-work-linux` 并重启 `wild-work.service`（二进制在跑会 ETXTBSY，须先 stop）。 |
| R68 | **面板组件层重构：shadcn/ui（源码内置）+ `@xiaojiaenen/liquid-glass`，按「行为 + 表面」分层，paper 继续去玻璃**（2026-10-20，所有者裁定） | **依赖**：运行时新增 `@xiaojiaenen/liquid-glass` 0.1.5、`@radix-ui/react-{slot,dialog,tabs,tooltip,select,switch,label}`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`；dev 新增 `tailwindcss-animate`。npm 包 0.1.5 的 `exports` 指向不存在的 `dist/index.js` / `dist/index.css`（实际产物是 `dist/lib/index.js` 与 `dist/style.css`），故 `vite.config.js` 用正则 alias 修正入口并固定版本；**不要**直接 `import '@xiaojiaenen/liquid-glass'` 而不经过 alias。**Tailwind 纪律**：`preflight`/`container` 仍为 `false`（`.container` 撞车与既有视觉层 reset 的真实教训不变）；但 `index.css` 必须保留 `@tailwind base`——没有它，`--tw-rotate/skew/scale` 等默认值缺失，`-translate-x-1/2` 的 `transform` 整条非法（实测弹层偏到屏幕右下）。shadcn 需要的 `border-style/width` 由 `.ww-ui` 作用域补齐，不全局重置。**表面分层**：大表面（顶栏、账号卡、费率/设置/登录弹层、Help/About）走 LiquidGlass（Chromium 真 SVG 折射，Safari/Firefox 自动降级毛玻璃）；小控件与长列表用 `soft`（仅 backdrop blur）；**paper 主题下 GlassSurface 渲染普通不透明纸面，不生成任何滤镜 DOM**。**必须保留**：全部 vanilla DOM id（`TestDOMIdParity`）、`acct-card` / `btnToggleFees` / `btnRefreshAll` 指纹、`/api/*` 引用与三主题 token；`internal/oczen/**` 与桌宠文件本轮零改动。**闸门调整（均为修正判据而非放宽）**：`render-check.mjs` 改为加载真实 `vite.config.js`（此前 `configFile:false` 会让 alias 漂移时假绿）、补 Radix Dialog 所需的 `getComputedStyle` SSR 桩、卡片切块从字面 `<div class="acct-card` 改为「class 含 acct-card」；`check-props.mjs` 正确剥离 `= 默认值` 并识别 `...rest` 透传组件。**实测**：bundle 710,585 → 872,021 B（+22.7%），CSS 48,372 → 69,473 B；`dist/wild-work.exe` 16,614,912 B；headless 60 卡 = 60 套滤镜、JS 堆 38 MB、DCL 123 ms / load 208 ms（合成数据，非生产上游）。**已知限制**：每实例一套 SVG 滤镜与位移贴图，卡片数极大时仍有内存/首帧成本；`liquid-glass` 只有 light/dark 两态；未迁移 TS（组件代码仍为 JSX 源码内置）。**生产生效**需重建 `dist/wild-work-linux` 并重启 `wild-work.service`（运行中会 ETXTBSY）。 |
| R69 | **R68 的前端重构已整体回退：移除 `@xiaojiaenen/liquid-glass` 与 shadcn/Radix 组件层，恢复到重构前的 Apple 毛玻璃面板**（2026-10-20，所有者反馈「液态玻璃还不如之前」） | **回退范围**：`package.json`/`package-lock.json` 移除 liquid-glass、Radix、cva/clsx/tailwind-merge/lucide-react、tailwindcss-animate（`npm prune` 清掉 54 个包）；删除 `GlassSurface.jsx`、`src/glass.js`、`src/lib/utils.js`、`src/components/ui/`、`src/styles/ui.css`、`jsconfig.json`；`App.jsx`/`Accounts.jsx`/`Fees.jsx`/`LoginFlow.jsx`/`Misc.jsx`/`Settings.jsx`/`index.css`/`main.jsx`/`tailwind.config.js`/`vite.config.js`/`tools/{check-props,render-check}.mjs` 全部 `git checkout HEAD --` 回退，**仅重新施加 R67 的显示名改动**（App.jsx 3 处 `wild-work`→`cy-work`、Misc.jsx About 标题），`index.html`/`style.css`/`public/logo64.png` 的 R67 未提交改动原样保留。**恢复结果（实测）**：bundle 710,585 B / CSS 48,372 B（与重构前逐字节同尺寸），render-check 控件数回到 25/13/35/23/48/7/7/7/48，`go test ./...` 全绿；生产 17:29:09 重启（PID 2930565），首页回到 `assets/index-Cq5h8w_w.js` 且服务端 bundle 哈希与磁盘一致，`liquid-glass`/`ui-dialog`/`gs-soft` 命中均为 0；`dist/wild-work.exe` 重建为 16,432,640 B。**实验留档**：`/home/incam/Software/_pre-revert-r68-20261020-172833`（完整 src/tools/配置）。**教训**：所有者要的是「视觉不变地换实现」还是「换视觉」，下次必须先用最小样张确认；shadcn 的语义色桥接与 Radix 行为本身可用，但**不得再改动既有 `.topbar`/`.acct-card`/`.modal` 的观感**。 |

## 2. 架构选型（依据）

| 主题 | 选型 | 理由 |
|------|------|------|
| GUI 壳 | **无**（删除 wails） | WebView2 内存开销大 + Windows 绑定；托盘 + 浏览器足够 |
| 托盘 | energye/systray v1.0.3（现有） | 已跨平台；菜单固定方案规避其不可删菜单项限制 |
| 管理后端 | 现有 http.Server 扩展 /api/* | 单端口、复用鉴权中间件（cookie 会话守卫）、零新服务 |
| Web UI | **Vite + React 编译，产物 `go:embed` 进单文件**（R5，2026-09-30 所有者签核推翻本行原先写的「纯静态、无前端编译链」） | 面板规模已超出无构建链能维护的范围；「单 exe 双击即用」这条没变——构建期需要 node，运行期不需要 |
| 登录 | 复用 internal/login + login_trae | 纯 HTTP + 本地回调端口，跨平台 |
| 平台能力 | internal/platform + build tag（windows/darwin/other） | 浏览器无痕/开机自启/消息框/日志/工作区，接口同名 |
| 构建 | WSL 交叉编译 win；CI macos-latest 编 darwin | 见 R11 |

## 3. 托盘菜单设计（当前形态）

```
wild-work
──────────
打开主界面          → 系统浏览器打开 http://<listen>/
查看日志            → 系统默认编辑器打开 data/app.log
──────────
退出                → 退出 daemon（确认框）
```

- 单击/双击/右击：右击弹菜单；**单击与双击 = 打开主界面**
- 各菜单项使用不同颜色纯 Go 生成图标（蓝色=打开、灰色=日志、红色=退出）
- 刷新积分功能已移至 Web UI 面板操作

## 4. Web UI 页面规划（纯静态，一个 index.html + app.js + style.css）

| 页面/区块 | 内容 |
|-----------|------|
| 顶部栏 | 品牌名/版本号、API 地址（点击弹窗配置）、API-Key（点击弹窗修改）、帮助/关于 |
| 登录层 | 启用管理密码时先登录（HttpOnly cookie 会话）；设置弹层内置「退出登录」 |
| 账号管理 | 双列卡片网格，账号名/UID/积分/签到状态，图标按钮操作（签到/刷新/停用/删除）；顶部积分汇总条 chip 可点击筛选（PR #68） |
| 自动签到 | 签到时间（HH:MM 多组）+ 开机自启开关（左右布局） |
| 用量与流水 | token 与积分流水（ledger 口径，R17）；token / 积分两个子 tab |
| 费率 | 各渠道模型定价表（按渠道分组），渠道标签带余额角标、模型名点击复制（PR #69） |
| 运行统计 | 实时统计（stats 口径，R43）：今日情况 / 平台概览 / 使用中接棒 / 最近临期 / 模型消耗 / 请求日志 / 异常账号 / 运行日志，30s 轮询 |

管理 API（REST，均挂 `/api/*`；除 `/api/auth/*` 外均需有效面板会话——密码为空时不校验）：

```
POST /api/auth/login               # {password} → {session}；下发 HttpOnly cookie
POST /api/auth/logout              # 注销当前会话
GET  /api/auth/state               # 会话探针（不返回 401）：全量状态 + auth_enabled/auth_session/auth_required
GET  /api/state                    # 全量状态（账号/积分/签到/配置）
POST /api/login/start              # {channel} → {auth_url}
POST /api/login/glm_auto           # 智谱清言自动登录：拉起独立 profile 浏览器（见 R27）
GET  /api/login/glm_auto_status    # → {status: idle|pending|success|failed|cancelled, uid?, nickname?, error?}
POST /api/login/glm_auto_cancel    # 取消自动登录并关闭浏览器
POST /api/login/glm_token          # {refresh_token} → {uid} 智谱清言手工兜底（见 R22）
POST /api/login/cline_key           # {api_key} → {uid,warning} Cline 粘贴官方 sk_ Key（见 R46；只调 /api-keys 验证，零 token 消耗；warning=同账号告警）
POST /api/login/callback          # {channel,url} 粘贴回调地址（TraeWork 等回环回调渠道，L18）
POST /api/login/cancel
POST /api/account/checkin          # {uid}
POST /api/account/checkin_all
POST /api/account/refresh          # {uid}
POST /api/account/refresh_all
POST /api/account/remove           # {uid}
POST /api/account/disable          # {uid,disabled} 停用/启用
POST /api/account/resource_detail  # {uid} → 积分明细
POST /api/account/nickname          # {uid,nickname} 修改显示名
POST /api/config/checkin_times     # {times:["09:00","21:30"]}
POST /api/config/listen            # {host,port,admin_password?}（非环回时必须带密码）
POST /api/config/admin_password    # {password}（空 = 关闭面板鉴权，仅环回监听允许）
POST /api/config/api_key           # {key}
POST /api/config/autostart         # {on:bool}
POST /api/config/compat            # 模型路由（默认渠道 / 封顶 tokens / 映射表）
POST /api/config/loop_guard        # {on:bool} 思考链防癫热切换（R50，atomic 全局、无需重启；GET /api/state 回读 loop_guard）
POST /api/config/body_log          # {on:bool} 请求体摘要诊断开关（L18，默认关；写 data/ledger/body-trace-*.jsonl）
POST /api/config/proxy             # {proxy,oczen_api_key?} 全局备用上游通道（R57；空串 = 关闭）
POST /api/config/model_fallback    # {rules:[{from,to[]}]} 模型降级链（R54，保存即热生效）
POST /api/config/reasoning_efforts # {efforts:{"channel/model":"high","*":"medium"}} 思考强度注入映射（R63，保存即热生效）
POST /api/config/oczen_test        # {api_key} OpenCodeZen 凭证连通性测试
POST /api/config/custom_channels   # {channels:[{name,base_url,api_key,models,enabled}]} 自定义 OpenAI 兼容渠道（R66，保存即热生效；api_key 提交脱敏值 = 不修改）
# 推理面另有 glm 生图端点（L18）：POST /v1/images/generations、POST /v1/images/edits（同 API-Key 鉴权）

GET  /api/fees                     # 渠道费率（本地缓存 + 按需刷新）
POST /api/fees/refresh             # 异步刷新费率
GET  /api/usage                    # 用量/积分流水聚合（R17，ledger 口径）
GET  /api/stats                    # 运行统计快照（R43，stats 口径）
GET  /api/stats/logs?limit=15      # 运行统计的最近请求日志行
GET  /api/logs                     # 最近 300 行日志
POST /api/quit                     # 退出程序
```

## 5. 渠道（已实现 WorkBuddyCN + WorkBuddyAI 国际版 + TraeWork + QoderCN + QoderCOM 国际版 + 千问办公 + MonkeyCode + 小浣熊 + Loomy + 智谱清言 + OpenCodeZen 匿名 + Cline；旧 Qoder 已下线）

1. 新建 `internal/<channel>/` 包，实现 `provider.Upstream` 接口
2. `internal/auth` 增加对应 `Load<Channel>Dir()`（文件名前缀 `<channel>-*.json`；
   **glob 边界**：`qoder*.json` 会吞掉 `qodercn-`/`qodercom-` 前缀，LoadQoderDir 必须显式排除）
3. 装配处注册 `server.Runtime{Kind, Pool, Upstream, StaticModels}` + `app.Runtime{..., Scheduler}`
4. 前端渠道选择器加一项；`internal/login_<channel>` 实现登录编排（如需）
   > **无账号渠道（oczen）跳过第 2、4 步**：不建 auth 文件与加载器，虚拟账号由 `main` 装配时注入 pool，
   > 且 `app.reloadAccounts` 不得纳入（否则 `SyncToDir` 会把它剔除）。

> provider.Kind 即模型名前缀；server 按 `channel/<model>` 前缀路由，无需改接口。
> **QoderCN（`qodercn/*`）**：qoder2api 参数形态（cosyVersion 1.0.10、18 头含 cosy-scene 族、
> session_type=qoder、identity userType 实测回填）；签到仅 campaigns（legacy daily-check-in 已 DISABLED，
> 其 claim 恒返回 409 会造成假成功，故不再使用）；每日 10:00 开放 + 10:00–12:00 窗口内重试（见不变量 23）；
> 动态模型表（无静态兑底，上次成功缓存）。详见 `docs/qoderCN渠道接入备忘.md`。
> **QoderCOM（`qodercom/*`）**：国际版（qoder.com/openapi.qoder.sh/api1+api2.qoder.sh 三域分离）；
> 凭据与 CN 区完全隔离（双向 401）；签到仅 campaigns（无 daily-check-in，实测 404）；
> 每日 10:00 开放 + 10:00–12:00 窗口内重试（同 CN，见不变量 23）。详见 `docs/qoderCOM渠道抓包分析与接入计划.md`。
> **旧 Qoder（`qoder/*`，QoderWork）已从界面下线**：代码与路由保留，存量账号仍可用；不新增功能，后续可移除。
> WorkBuddyAI 国际版：`DailyCheckin` 实现为「免费模型对话保活 + 签到探测」（对用户透明，无前端界面）；
> token 有效期 365 天，故 KeepaliveHours 设为 nil。详见 `docs/workbuddy国际版渠道接入备忘.md`。
> **MonkeyCode（`monkeycode/*`，平台托管模型）**：凭据由面板「从本机客户端导入」从官方客户端
> （ohmyagent）的 settings.json 取得，一个账号 = `oma_` api_key + `omas_` signing_secret；
> 按模型声明的 type 分流到 `{base}/messages`（Anthropic 形状）或 `{base}/responses`（Responses 形状），
> 两路都是无状态 SSE；上游无目录/额度/刷新接口 → 模型表静态、额度恒 0、`RefreshToken` 空实现。
> 协议对照参考：`codkeep/MonkeyCodeReverseEngineer`（Apache-2.0）。
> **小浣熊（`raccoon/*`）**：两条添加路径 —— 面板登录按钮走**网页版自动登录**（拉起独立 profile 的
> Edge/Chrome，登录后经 CDP 捕获 Cookie `xhx_token`（R67 迁站后），见 internal/login_raccoon/web.go；
> 跨平台，不再依赖 Windows 注册表，详见 R44/R67），弹窗次按钮「从客户端导入」读本机
> `.box-agent/config/auth.json`。凭据 access_token ≈1h + refresh_token ≈30d，保活每 4 小时一次
> 以减少「请求先 401 再刷新」的往返。**签到走 `setting_info`**（每日积分的惰性落账触发点，
> 见 R65 与 internal/raccoon/checkin.go）。**注意互踢**：上游 refresh 轮换 refresh_token，
> 同账号凭据共用（本工具 + 浏览器/客户端）会互踢，需各自单独登录（独立 `sid`）才能并存。
> 上游默认档即最深思考，故不接档位面。
> 接口结构整理：`xxhhlk/raccoon2api`（MIT）。
> **Loomy（`loomy/*`）**：导入型渠道 —— 凭据由面板「从本机客户端导入」读
> `C:\Users\Public\Loomy\<hash>\userData\auth-session.json`。上游**无 refresh 端点**，
> session 约 14 天，到期需重新导入；`RefreshToken` 留空、保活关闭。**每日签到 = 宠物打工奖励**
> （按有效对话轮次结算，`internal/loomy/checkin.go`，L18 接入），签到时段随全局配置。
> 鉴权失败是 **HTTP 200 + 业务码 `100002`**（不是 401），业务码判定必须排在状态码判定之前。
> 接口结构整理：`xxhhlk/loomy2api`（MIT）。
> **Cline（`cline/*`）**：**粘贴型渠道** —— 凭据是官方文档化的 `sk_` API Key
> （`app.cline.bot` → Settings → API Keys 创建，形如 `sk_` + 64 hex，**只在创建时完整显示一次**）。
> 一个 Cline 账号一把 Key；**Key 不过期、不轮换** ⇒ 无 `RefreshToken`、无保活、无签到，
> 也没有 R26/R44 那种「同凭据多处使用互踢」的问题（见 R46）。
> **模型面不做任何本地假设**（2026-10-12 简化）：绑死上游 `recommended-models` 的 `free[]`
> 原样透传——ID 保留 `cline-free/*` 别名不改写（用户后台观察：免费入口是别名条目，
> 厂商真实名会扣费；注意此为观察级证据，计价逐请求抽签）、无静态表、无本地配置、
> 不拉 `/api/v1/models`（458 条 OpenRouter 镜像）。本地校验集 = 暴露集 = `free[]`，
> 冷启动放行；上游抖动用已知集兑底。
> **两个必须遵守的实现约束**：① 出站必带**非空 `X-CLIENT-TYPE`**，否则 `cline-free/*` 全量 403
> 且**不报错**（值随意，缺失/空值才拒）；② `Classify` 必须从被压平成 500 的 body 里取**内层**状态码，
> 并把 `limit_rpd`/`Daily limit reached`/`temporarily rate-limited` 归成**模型级**处置
> （`ErrPassthrough` + 模型冷却），**绝不软化账号**（见 R47）。
> **`max_tokens`**：客户端未给则**不传**（不传最稳），<64 抬到 64、>200000 压到 200000
> ——实测 8 被上游拒、16 会造成 `empty response content`（推理吃光预算，流式同样中招）。
> 上游**无余额/额度端点** ⇒ `UserResource` 恒 0（**不得返回 error**），面板显示「不适用」，
> 实际花费来自逐请求 `usage.cost`。**不承诺价格**：`free` 前缀 / `is_byok` / `provider` 实测都不能
> 当免费判据（同前缀有扣费、非 free 后缀反倒 cost=0，且同 ID 相邻两笔会漂移）。
> 添加时只调 `GET /api/v1/api-keys` 验证（**零 token 消耗**），uid 取其 `apk-…` id；
> 官方配额字段名是 `…UsageCostUSDPerUser`（按**账号**计）⇒ 同账号多把 Key 共享一份额度，须告警。
> 依据与实测全表见 `docs/cline渠道接入计划.md` 与 `docs/cline2api线索项目评估.md`。

> **OpenCodeZen（`oczen/*`，匿名免费）**：凭证固定字面量 `public`，无账号/无签到/无积分；
> 免费档有五道闸门（规范且位合法的 `ses_<12hex><14Base62>` 会话头 + `/inference/v1` 车道 +
> `stream:true` 且 tools 含 `bash`/`read` + 全套伪装头 + 禁发亲和头），缺一即 403 FreeTierError；面板固定一项「[OpenCodeZen] 匿名」、积分显示「不适用」，
> 不可增删停用。详见 `docs/opencodezen渠道接入备忘.md`。
> **智谱清言（`glm/*`）**：网页版私有接口（**非**开放平台 open.bigmodel.cn），凭据是浏览器 Cookie 里的
> `chatglm_refresh_token`；所有私有接口需签名 `X-Sign = md5(ts-nonce-secret)`；模型 = `assistant_id`
> （24 位 hex 智能体 ID）+ `chat_mode`（`zero` 推理 / `deep_research` 沉思 / `ppt` / `video`）。
> **模型清单是「智能体清单」不是「模型版本清单」**——清言客户端无法选模型版本，
> 服务端按账号分配（实测主对话恒为 `moe_53f`）；GLM-5.3 的具体版本控制只能走官方开放平台。
> 静态表**只收录实测可用的 4 个智能体**（ChatGLM / AI搜索 / 清言PPT / 视频助手）；
> AI画图（需 cogview 参数）、AI阅读（需上传文件）、学习搭子（上游 10025 报错）**不收录**——
> 想用未收录的智能体直接填其 24 位 hex ID。
> **积分机制**：`member_info.score_rule` = 「免费用户，登录赠送200积分/天」。
> **新账号激活**：加进来后 `left_score=0`，**必须在智谱清言 App 登录一次**才发放（+3000 随后 +500）——
> 对照实验证实（R23）。**代码层面无解**（Web 端无激活接口，R32 实测），
> 故额度为 0 的账号会永远排最后、实际轮不到。
> **每日积分**：走 `member-api/member/daily_login_score`（**已接入保活流程**，R31）——
> 该接口网页版打开时自己就会调，幂等安全（`status=10001 今日已领取` 是正常语义）。
> 「签到」的实质是**保活对话**。**操作建议**：面板加完账号 → 手机 App 登录同账号一次 → 之后每天自动领。
> SSE 为**增量 delta**（`finish` 帧给全文，见 R25）。登录走 CDP 自动捕获 Cookie（R27/R28），
> 支持多账号（独立 profile 逐个添加）。**2026-10-20（L18/R106）**：调用侧迁到 IDE(Electron) 指纹；
> 对话简化为**一来一回**（忽略 system、拒绝 assistant/多 user、不支持 tool_calls）；
> 新增 `/v1/images/generations|edits` 生图端点。⚠️ **多参考图改图**会把拼版图上传到第三方图床
> （`sang.pub`，上游协议只收公网 URL）；单张 http(s) 参考图直传、不落第三方。详见 `docs/智谱清言渠道接入备忘.md`。
> **自定义渠道（`custom_channels`）**：不写代码、只在面板配置的 OpenAI 兼容渠道（R66）——
> 用户填 `name`/`base_url`/`api_key` 与模型清单（含上下文/思考档位/多模态能力，**配什么返回什么、
> 绝不向上去拉或推测**），即可以 `name/<model>` 访问并统一纳入流水与运行统计。
> **名称不得与内建渠道（或上游命名空间如 `cline-free`）同名**：两者同名会让 server/app 两层
> 指向不同 Runtime（面板操作打到自定义池、对话请求走内建渠道），故 `Validate` 直接拒绝。

## 6. 关键不变量（改动前必读）

0. **每次代码变更后必须本地重新构建 `dist/wild-work.exe`**（见 §8）。改了 `cmd/wild-work/webui/` 下任何前端源码，必须先 `npm --prefix cmd/wild-work/webui run build` 再 go build —— 否则 exe 里是旧面板，且**不会有任何报错**（embed 的是产物目录，不是源码）。
   `dist/` 在 `.gitignore` 中，CI 只产出带平台后缀的 `wild-work-<os>-<arch>`，
   **不会**生成 `dist/wild-work.exe`——该文件只能手动构建。
   不重建会导致：本地运行的二进制与源码不一致（例如改了版本号但仍显示旧版本）。
1. `PrepareBody` 四改写勿动：强制 `stream=true`、`tool_choice` 归一化、`developer→system`、tool schema `$ref` 消毒（R56，无 `$ref` 时零改动）
2. 日志/面板/消息框**零 token**：不得输出 access/refresh token（调试用假 token）
3. auth 文件嵌套格式 `{auth:{...},account:{...}}`，`internal/auth.Parse` 与 login.SaveAuth 必须一致
4. `config.listen` 兼容新对象格式 + 旧字符串格式 `":7863"`
5. `data/state-*.json` 只增不减字段，向后兼容；旧 state.json 自动迁移
6. 托盘回调必须 goroutine 化
7. `config.example.json` 与 `config.Default()` 同步
8. 上游 HTTP ≥400 错误直接透传原始响应，不包装
9. 定价缓存持久化到 `data/pricing-cache.json`，启动加载，超 1h 自动刷新
10. 无桌面 Linux 必须 `--no-tray`，不带参数 panic 直接 exit 提示
11. **粘性路由**：`pickWithSticky` 优先复用上次账号，直至连续成功请求达 50 次或遭遇错误冷却。成功时 `stickySuccess` 递增计数，错误时 `stickyClear` 清除粘性记录。不使用 credits 阈值（pool 中余额是 stale 数据）。
12. **`internal/server` 主链路不得被绕过**：`POST /v1/chat/completions` 与 `GET /v1/models` 由内层直接服务，`internal/gateway` 只接管 `/v1/responses`、`/v1/messages`、`/v1/messages/count_tokens`。
13. **兼容层调用内层只能经 `Gateway.call()`**（`io.Pipe`），调用方读完必须 `res.Close()`，否则内层 goroutine 可能阻塞在 Write 上泄漏。
14. **`pipeRW.Flush()` 为空操作是刻意的**：`io.Pipe` 无缓冲，Write 即送达；不要改成缓冲 + 定时 flush。
15. **错误分类 429 必须优先于 hardMarkers**：限流 body 高频带 `quota exceeded`，先判 hardRule 会把限流误归余额耗尽 → 12h 硬冷却。三渠道 `Classify` 均已修复此顺序。
16. **脱敏层仅做文本替换不做语义变更**：`internal/sanitize` 只改模板句、不改用户内容语义；预检不命中时零分配原样通过。将来配置 `features.sanitize_fingerprints` 可一键关闭（逃生门）。
17. **积分「可用/不可用」拆分统计**：`provider.ResourceItem.Usable` 标记条目是否属于本工具可消耗的额度池，`provider.Summarize()` 汇总小计。
    - TraeWork 判据（2026-09-26 修订，R19 / issue #44）是 **`available_endpoint==1` 为不可用**
      （pid==209 判据已于 09-26 撤回，见下）：
      上游已不再下发 ep=1（专用池也标 0），ep 判据仅作历史兑底。**pid==209 判据已于 2026-09-26
      撤回**（issue #44）：pid=209「200 档每日签到」升级为通用积分，实测扣费就发生在这个池上
      （09-23 99 次对话期间 remain 恒 3086、「不可用」小计 -354），继续排除会让 pool 按虚低余额选号、
      面板把真实可用积分误标「不可用」。**不得用 `group_type` 判定**——同名「每日签到」既有
      通用份也有专用份。早期仅用 ep 判定的实测证据见 `docs/upstream-reverse-engineering.md` §2.3。
    - `UserResource` / `UserResourceDetail` 返回的 remain **只能是可消耗余额**，
      否则 pool 会按虚高余额选号。含专用池的总量（`usage_summary.total_amount`）不能作路由依据。
    - 不可消耗额度仅用于面板展示（`pool.Status.UnusableCredits`），不参与 `Pick()` 排序；
      展示的唯一目的是让用户看到的总积分能和官网对上。
18. **到期时间字段因渠道而异，缺失则不显示**：WorkBuddy 系是 `CycleEndTime`（**上游从不下发 `PackageEndTime`**，旧判据恒 miss），
    TraeWork 是 `expire_time`（Unix 秒），Qoder 无此字段。均按 **UTC+8 墙钟**解析（`softRateResetLoc`），
    用 `time.Local` 会在非 UTC+8 机器上算错一天。上游未下发时 `ResourceItem.ExpireAt` 必须为空串，
    前端据此隐藏整列——**不得用零值时间冒充「永不过期」**。
    **2026-10-20（L18/R105）**：`ExpireAt` 允许两种形态——纯日期（该日全天可用 ⇒ 次日 00:00 失效）
    与 RFC3339 精确时刻。解析统一走 `provider.ExpireInstant`；**ledger 伪键必须用 `provider.ExpireDate`
    只取日期前缀**，否则升级瞬间每包一对假 expire/earn 流水。
19. **401 必须自愈，不能只信本地 `expiresAt`**：上游刷新会作废旧 access token（refresh token 同步轮换）。若新 token 未落盘、
    或同一账号在别处被刷新，本地文件里的 token `expiresAt` 仍在未来，但上游已拒绝 → `NeedsRefresh` 恒为假、永不刷新、
    积分恒 0、明细恒空。因此积分/明细/费率路径遇 `ErrSessionDead` 必须「refresh + 落盘 + 重试一次」
    （`app.refreshIfSessionDead`，scheduler 的 checkin 路径同理）。
20. **凡是调 `Upstream.RefreshToken` 的地方必须紧跟 `SaveAtomic`**：refresh token 会轮换，不落盘 = 下次启动用旧 refresh token，
    重回上一条的死锁（`RefreshPricing` 曾漏，已补）。
21. **匿名渠道的虚拟账号不得进入任何「能把它弄没」的路径**：`reloadAccounts` 不纳入（`SyncToDir` 会剔除），
    启动时 `SetDisabled(uid,false)` 兜底自愈；`RemoveAccount`/`DisableAccount` 对 `provider.Oczen` 硬拒（后端拒 + 前端无入口）。
    其 `Auth.ExpiresAt` 必须为远期值（不得为 0），否则 `NeedsRefresh` 恒真 → 反复 `RefreshToken` + 冷却。
22. **单账号渠道（`Runtime.SingleAccount`）不得施加任何账号级惩罚**：唯一账号且不可重登 ⇒ 任何惩罚
    （冷却/计数/禁用）都等于整条渠道下线。故 `Runtime.SingleAccount=true` 的渠道（当前 oczen）在 handler 里
    **传输层错误与 `status>=400` 一律原文透传**，不走 `NoteError`/`Cooldown`/`Disable`。
    - **429 也不冷却**（2026-09-24 修订，推翻早期「429 短冷却是唯一需要的背压」）：无号可轮换，
      冷却后后续请求在挑号阶段被挡成 `503 no_healthy_account`，不如透传 429 让客户端按 `Retry-After` 退避。
    - **传输层错误不累计 `errCount`**：否则 3 次网络抖动（默认 `ErrThreshold`）即冷却唯一账号。
    - 启动时 `Pool.ClearPenalty(uid)` 自愈旧版遗留冷却（`SetDisabled` 只清禁用，不清冷却）。
    - **严禁**把 401/403 归为 `ErrSessionDead`（会 `pool.Disable` 永久禁用且无法人工恢复）。
    - `oczen.Classify` 仍做语义分类（供日志），但**不再用于决定惩罚**（惩罚判定前已短路）。
    - **2026-10-14 澄清（PR #113）**：“不施加账号级惩罚”不等于“什么都不冷却”——`ErrHardCredit`（402 权益不足）的处置是**模型级**冷却（`CooldownModel`，账号×该模型），账号本身仍不动。适用面比字面更宽：`SingleAccount` 渠道与「池内只有一个账号」的普通渠道（如 qwenwork 单号）都在其列。这是对 R16「4xx 一律 `ErrPassthrough`」的局部例外，理由见 R60。
23. **Qoder 双区签到只能走 campaigns，且状态必须结构化上报**：
    - **绝不调用 legacy `daily-check-in/claim`**：该端点已全局 DISABLED，却对未领取日恒返回 409，
      会被误判成「今日已领取」而跳过真实领取 → 假成功、零积分（上游 `99ab022` 同款结论，2026-09-21 抓包实测）。
      只有 `GET /sash/api/v1/me/campaigns` → `POST .../campaigns/{id}/claim` 会真实发放 100 Credits。
    - **401 必须返回 `*provider.Error{Kind: ErrSessionDead}`**，不得用裸 `fmt.Errorf`：调度器
      `isSessionDead` 走 `errors.As` 类型断言，裸 error 会让它恒为 false，自愈失效（不变式 19）。
    - **结果状态经 `provider.CheckinReporter` 上报**（`CheckinClaimed`/`Already`/`NoCampaign`/`NoToken`/`Error`）：
      `error` 通道无法区分 `no_campaign` 与 `error`——两者都不是「已签到」，却都需在窗口内重试。
      **`Msg` 必须透出**，不得被调度器覆盖成 `"ok"`，否则面板无法区分「真领到 100」与「活动还没上线」。
    - **签到窗口必须带重试**：每日 10:00（UTC+8）开放，活动可能在整点后才创建，
      故 `CheckinMinutes=[10:00]` + `CheckinRetryUntil=12:00`，窗口内每分钟重试，
      直到全部账号达 `claimed`/`already` 才算当日完成（上游 `ae3d42f` 修的就是漏领一天）。
      完成标记按「日期+时段」而非仅日期——本工具支持一天多时段（09:00/21:00），
      只按日期标记会让早间成功吞掉晚间时段。
24. **缓存字段是「可选上报」，不得把「不提供」显示成『0%』**：上游 usage 里是否回缓存命中字段
    因渠道而异（实测：WorkBuddy 系 `prompt_cache_hit_tokens`、Trae 系 `cache_read_input_tokens`、
    其余 `prompt_tokens_details.cached_tokens`；小浣熊回**空对象**、清言/Loomy 整条流无 usage）。
    判定集中在 `internal/server/cacheusage.go`，必须区分两种情形：
    - 「字段存在但为 0」（如 `prompt_cache_hit_tokens:0`）= 上游明确的「本轮未命中」⇒ 显示 0%；
    - 「字段不存在 / details 为空对象」= 上游不提供该维度 ⇒ 显示「—」，**绝不得显示 0%**。
    落地细则：`UsageEntry.CRC` / `ModelStat.CRCov` / `TokenStats.CRCov` 为零即代表「无样本」；
    利用率 = `CR ÷ CRCov` 的**加总口径**（未上报的请求整条不进分母，不稀释命中率）；
    三个字段一律 `omitempty`，保证旧流水读出来就是「未上报」（不变量 5 的向后兼容落地）。
    **分母不得做 `PT + cacheRead`**：实测 workbuddy 系 `hit+miss==prompt_tokens`、
    trae 系 `total==prompt+completion` ⇒ 命中数是 prompt_tokens 的**子集**（与 Anthropic
    官方口径相反）。副产品：利用率恒 ∈ [0,1]。回归测试 `internal/server/cacheusage_test.go`、
    `internal/ledger/cache_test.go`、`internal/stats/cache_test.go`、`scripts/ui-static-check.mjs`。
    **唯一会重建 usage 的渠道是 monkeycode**（只拼 pt/ct/total）⇒ 搬字段必须显式加，
    否则上游给的缓存数据在网关内部就被丢掉（本项就是它被发现的原因）。
    > 本仓**不采纳** `scripts/ui-static-check.mjs` 的上游更新（L11/L12 的孤儿脚本，驱动的是冻结
    > vanilla），面板侧的同款三态判据在 `webui/src/components/CacheCell.jsx` + render-check 场景 7；
    > `internal/server/cacheusage_test.go` 等 Go 侧用例照常采纳。

## 7. 平台能力差异表（internal/platform）

| 能力 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 打开浏览器 | rundll32 url.dll | `open <url>` | xdg-open |
| 系统消息框 | MessageBoxW | osascript display dialog | stderr |
| 开机自启 | 注册表 Run | LaunchAgent plist | 未实现 |
| 打开日志文件 | notepad | open -a TextEdit | xdg-open |
| 确认框 | MessageBoxW YESNO | osascript buttons | 默认否 |
| 无头模式 | --no-tray | --no-tray | --no-tray（推荐） |

## 8. 构建

> ⚠️ **本地构建是日常约束**：任何代码变更后都要重新构建 `dist/wild-work.exe`
> （见 §6 第 0 条）。CI 不生成该文件，且 `dist/` 不入版本控制。
> 标准流程：`go build ./... && go vet ./... && go test ./...` 全绿后再构建。

```bash
# 前端产物（改了 webui/ 源码必做；产物落 cmd/wild-work/web-app/，被 embed）
npm --prefix cmd/wild-work/webui install --no-audit --no-fund   # 首次或依赖变更
npm --prefix cmd/wild-work/webui run build                       # 出 web-app/
npm --prefix cmd/wild-work/webui run check                       # check-props + render-check（改前端源码后必跑）

# Windows（本机直接构建，或 WSL 交叉编译）
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-H windowsgui" -o dist/wild-work.exe ./cmd/wild-work

# macOS（需 macOS 真机或 CI，cgo 必需）
GOOS=darwin GOARCH=arm64 go build -o dist/wild-work-darwin ./cmd/wild-work

# Linux 无头
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o dist/wild-work-linux ./cmd/wild-work
```

构建后核对版本号已进二进制（防止拿到旧文件）：

```bash
# Windows bash 下用 python 字节计数（strings 对 Go 二进制的长串不可靠）
python -c "b=open('dist/wild-work.exe','rb').read(); print('new:',b.count(b'2.5.4'),'old:',b.count(b'2.5.2'))"
# 期望：new >= 1 且 old == 0。若旧版本号仍在，说明构建未生效。
```

### 发版（tag 触发）

push `v*` tag → GitHub Actions 构建五平台产物并创建正式 release。
**release note 用仓库根目录的 `RELEASES.md`**（统一维护，按版本从旧到新排列——新版本说明
**append 到文件末尾**；旧的分版本 `RELEASE-vX.Y.Z.md` 已并入该文件并删除）。
release note 从 `RELEASES.md` 截取对应版本段落（`# wild-work vX.Y.Z` 起）作为手写摘要，
而不是 `--generate-notes`（那只给 commit 链接列表）；文件/段落缺失时回退自动生成，不阻塞发版。

```bash
# 发版前确认：版本常量已 bump（internal/app/app.go const Version）、
# RELEASES.md 末尾已追加对应版本段落（# wild-work vX.Y.Z）且与 tag 名一致、
# dist/wild-work.exe 已本地重建验证
git tag vX.Y.Z && git push origin vX.Y.Z
```

## 9. 文档索引

入库文档（`docs/` 白名单制下反选入版本控制）：

- [README.md](README.md) — 用户文档
- [DEVELOPMENT.md](DEVELOPMENT.md) — 开发者文档（面向 AI Agent）
- [AGENTS.md](AGENTS.md) — 本文件：决议项（R1–R53b，另含 R54–R66）、架构选型、不变量
- [docs/三接口兼容改造备忘.md](docs/三接口兼容改造备忘.md) — 三接口（Chat/Responses/Anthropic）兼容层架构决策、实施记录、验证清单、已知限制
- [docs/用量积分流水记账备忘.md](docs/用量积分流水记账备忘.md) — 双流水统计（token/积分）架构、差分算法、实测验证、已知限制（R17）
- [docs/前端React重构架构计划.md](docs/前端React重构架构计划.md) — React 重构的选型签核（R5 被推翻的那次）、逐阶段 DoD 判定、
  各闸门的负向验证记录与实测数字（体积/控件数/色值对账）。§10 L6 是结论摘要，本文是依据与过程记录。
  > 本文件的**缺陷处置结论以 §10 L6.2/L6.3 与 `webui/FEATURES.md` §5 为准**——本文按时间顺序记录，
  > 已处置的缺陷在其原文中仍写作「待修/待定」，不逐条回填（避免两份互相覆盖的"权威结论"）。
  > 2026-10-01 起反选入库（此前受 `docs/*` 白名单制限制，仅本地可见）。

- [docs/opencodezen渠道接入备忘.md](docs/opencodezen渠道接入备忘.md) — 匿名免费渠道的协议依据：免费档**四道闸门**
  （含 2026-10-13 新增的会话 id 位不变量）、端点可达性矩阵、额度与错误语义、故障复盘与判据清单（R16）。
  原稿从未入库且已丢失，**2026-10-13 按当天实测重建**后反选入库。
- [docs/upstream-reverse-engineering.md](docs/upstream-reverse-engineering.md) — 上游三渠道逆向分析
  （认证形态、积分池判据的早期实测证据，不变量 17 引用）。
- [docs/桌宠功能实施计划.md](docs/桌宠功能实施计划.md) / [docs/桌宠动画重构计划.md](docs/桌宠动画重构计划.md)
  — 桌宠功能与弹簧/纹样动画引擎的实施记录（§10 L2 的实现依据）。

> 上述四份 **2026-10-13 起反选入库**。此前它们是**悬空引用**——§9 与 R16、不变量 17 都在指向 clone 里根本不存在的文件。
> 入库前逐文件扫过敏感内容：JWT 头（`eyJ…`）、`dt-`/`sk-`/`oma_` 形态的真实密钥、32 位以上纯 hex、
> 内网 IP、真实账号 uid **全部零命中**；文中只出现 `<accessToken>` 这类占位符与 `Bearer public` 这个协议常量。

以下备忘**确实不在仓库、本地也已丢失**（仅存在于历史会话中）：
`docs/qwenwork渠道接入备忘.md`、`docs/qoderCN渠道接入备忘.md`、
`docs/qoderCOM渠道抓包分析与接入计划.md`、`docs/智谱清言渠道接入备忘.md`（R22–R38 引用，随 PR #46 新增，
作者未提交入库）。
如需转为本仓可查，在 `.gitignore` 补 `!docs/<文件名>` 并在上方列表添链接。
**例外**：glm 渠道的协议依据（R22–R38 引用）**不在本地**——作者已将其开源为独立仓库
[glm2api](https://github.com/ttales430/glm2api)（签名算法/认证流程/SSE 语义/积分机制/智能体清单），
引用一律指向该仓库，不要找本地文件。

> **docs/ 采用白名单制**：`.gitignore` 中 `docs/*` 默认忽略全部文档，仅 `!docs/<文件名>` 显式反选的才入库。
> 逆向分析类文档一律**只保留本地、不入库**。新增需要入库的文档时，追加一行 `!docs/<文件名>`。
> 未入库的本地文档（`ref/`、`docs/` 其余文件、`HANDOFF.md`、`GO多平台发布备忘.md` 等）仅供本地参考，
> 不要在本文件中作为可点击链接引用。

---

## 10. 本地分叉（相对上游 rockswang/wild-work）

> 本节只描述**本地独有**的约定与偏离；上游决议 R1–R62 一律照上游采纳，不在此重复。

### L1 前端：功能层 / 视觉层分离
> ⚠️ **2026-09-30 起，本节的 `web/` 指 `cmd/wild-work/web/`，它已不参与 embed**，只作为上游 vanilla 的 diff 基准存在（见 L6）。真正在跑的前端是 `webui/` → `web-app/`。
> 本节各条仍是**读上游改动、决定移植到什么行为**的依据；不再是要直接编辑的活代码。
- `web/app.js` 的**功能层以上游为准**，本地只保留视觉层补丁（约 165 行）：`Pet.sync`、
  `Anim.countUp` + `creditsShown` 起点、卡片入场 `card-enter`、`glow-alert`、
  `creditsText()` 的 `credit-main|credit-unit|credit-meta` 结构、渠道费率**弹层** `openFees|closeFees`。
- `web/index.html` 与 `web/style.css` **以本地为准**（Apple 设计语言 + Paper 主题，见 `theme.js`/`anim.css`）。
  上游新增 DOM 只把**带 id 的功能节点**插进本地结构，样式按本地变量（`--accent`/`--hairline`/`--card-bg`）
  重写，**不照抄上游观感**。上游用 `--primary`/`--border`/`--card`，本地无这些名字。
- **渠道费率形态**：上游是页内多标签，本地是弹层 → 保留本地弹层外壳 `feesOverlay`，
  内部承载上游的 `.fees-tabs` 渲染（渲染目标仍是 `#feesBox`，故 app.js 无需改）。
- 渠道色一律走变量：本地有 `--glm`（三套主题各一值），新增渠道须同时补
  `:root` / `prefers-color-scheme: dark` / `html[data-theme="paper"]` 三处，否则某主题下按钮失色。

### L2 桌宠
- 纯观感层，零后端配置：`pet.js` / `pet.css` / `web/pet/` + localStorage 开关。上游无此功能，融合时整文件保留。
- 数据源：`/api/pulse`（本地在 `app.HandleAPI` 内新增，读 `handler.Traffic()` 的 atomic 计数）+ `/api/state`。
- **桌宠不得复用 app.js 的全局 `api()`**：采纳 R4 后它遇 401 会 `showLogin()`——那会弹登录层、
  抢 `adminLoginPass` 输入框焦点，且 `state !== null` 时直接 `location.reload()`。桌宠是 3s/30s 轮询，
  反复触发会毁掉登录流程。改用 `pet.js` 内的 `petGet()`：非 2xx 返回 null、静默跳过，登录后自愈。
- `/api/pulse` 刻意留在 `guardMux` 守卫之内（`/api/*` 全守卫，仅 `/api/auth/*` 例外），不为桌宠开鉴权白名单。
- **`Pet.init()` 不挂在 app.js `init()` 末尾**：上游的会话探针在未登录时 `showLogin(); return;` 会跳过后续所有语句，
  导致启用面板鉴权后桌宠永不挂载（实测踩过）。现改为 app.js 文件级独立启动，登录前后都能挂载。

### L3 融合基线与下次融合方法
- 2026-09-29 完成一次融合：上游 `4b99557d`（本地旧基线）→ `master`（**v2.5.4**），23 提交 / 79 文件。
- 真实冲突面只有 6 个文件：`cmd/wild-work/main.go`、`web/{app.js,index.html,style.css}`、
  `internal/app/app.go`、`internal/server/handler.go`。其余 73 个是纯新增或本地未碰，整文件采纳。
- **React 化之后（阶段 3 收尾）本节的形态变了**：上游仍改它的 `web/*`，而本仓 `web/` 只是基准。
  融合流程因此变成 **三步**，而不是三方合并：
  1. 上游 vanilla 照旧落进 `cmd/wild-work/web/`（保持基准与上游一致，diff 才有意义）；
  2. 用 `git diff <旧基准> -- cmd/wild-work/web/` 得到上游**功能改动清单**（不是内容合并，是行为清单）；
  3. 逐条移植进 `cmd/wild-work/webui/src/`，每改完一片跑 `TestDOMIdParity` +
     `TestPanelAPIRouteContract` + `TestStateFieldContract`：端点少了、字段少了、id 少了都会报。
  `main.go` / `app.go` / `handler.go` 仍走 `git merge-file` 三方合并，不受影响。
- ⚠️ **上游把 `web/app.js` 从 CRLF 转成了 LF**，直接 `diff` 会显示整文件重写（+1454/−1211），
  真实内容差仅 265 行。比对任何 web 文件都必须带 `--strip-trailing-cr`，否则会误判为「上游重写了前端」。
- 本目录**不是 git 仓库**，且 `github.com:443` 不通（仅 `api.github.com` / `codeload.github.com` 可达）：
  ```bash
  curl -sSL -H "Authorization: token $(gh auth token)" \
    -o master.tgz https://codeload.github.com/rockswang/wild-work/tar.gz/refs/heads/master
  # Go 文件三方合并（不需要仓库）：
  git merge-file -L local -L base -L upstream  M-app.go  base/internal/app/app.go  upstream/internal/app/app.go
  ```
  `gh api repos/rockswang/wild-work/compare/<旧基线>...master --jq '.files[].filename'` 拿变更清单。
- 本地无 git，融合前必须先手工备份：改动过的文件 + `data/ledger/` 全量（本次在
  `/home/incam/Software/_pre-merge-20260929/`，含整仓 `project-snapshot.tgz`）。

### L4 已知上游缺陷（非融合引入，勿归因于本地改动）
- ⚠️ **§8 的版本字节核对法不可靠**：`crypto/x509/pkix` 把 DN OID `2.5.4.6/2.5.4.3/…` 写进了字符串表，
  任何 Go 二进制都会命中 ≥9 次 `2.5.4`，而带引号的 `"2.5.4"` 恒为 0（Go 常量不含引号）。
  核对构建是否生效请数**本版独有标记**（融合后实测：`chatglm` 0→29、`admin_password` 0→11、
  `ww_admin` 0→1、`npmmirror` 0→1、`glmOverlay` 0→5，同时 `2.5.2` 3→0）：
  ```bash
  python3 -c "b=open('dist/wild-work-linux','rb').read();print({k.decode():b.count(k) for k in [b'chatglm',b'admin_password',b'ww_admin',b'npmmirror',b'2.5.2']})"
  ```
- ~~`internal/cdp` 的 `TestWriteDoesNotHangClose` 在本机失败~~ **已由上游社区 PR #86 修掉（2026-10-12 随 L11 融合采纳）**：
  根因是断言窗口 12s 小于 `writeTimeout=15s`，上游把测试预算改成 20s；本仓实测 PASS（15.20s）。
- ~~故 `go test ./...` 目前非全绿~~ **`go test ./...` 自 2026-10-12 起首次全绿**（30 包 0 FAIL，
  `go build` / `go vet` 同样全绿）。此前 L4/L6.3/L8 三处记的「唯一既有失败」已随本次融合消失，
  **不要再把它当已知失败预期**——若它再次变红，就是新引入的回归。
- `index.html` 的 echarts CDN `<script>` 无 SRI/`crossorigin`（上游同款），本机 origin 可被第三方脚本执行；
  上游 09-28 只是把 host 换成 `registry.npmmirror.com`（issue #47 的 3~10s 卡顿修复），未加校验。
- **`ledger.Query` 的月份分段覆盖循环漏当月（2026-10-01 已在本仓修掉，上游未修）** —— 又一记
  「测试全绿但仍然错」，且这次错在**业务代码**而非前端：`Query` 按「从窗口起点每 15 天取一次样」
  收集要扫的 `usage-YYYYMM.jsonl`，`from=09-25 / now=10-01` 时第二步落到 10-10 已越过 `now` 直接结束，
  **本月分段根本进不了集合** ⇒ 每月 1~14 日面板的 7 日视图只显示上月（上月那份不受 `trimCurrentMonth`
  裁剪，可能留着陈旧数字），当月流水静默归零——不报错、不影响 `days=1`（`from` 就是今天），所以极难察觉。
  实测铁证：造 `usage-202610.jsonl`（09-27…10-01 四条），10-01 当天 `?days=7` 返 `total=0` 而 `?days=1`
  返 169134；改为按月推进后 `?days=7` 返 609933、`by_day` 覆盖到 10-01。
  判据做在纯函数 `monthSegments(from, now)` 上而非端到端：**端到端只在每月头 14 天复现，其余日子会假绿**，
  而那正是这个缺陷本来的形态。已负向验证（装回 15 天取样 → 4 个用例变红并点名漏掉的分段）。
  上游出处 `d82dbcb`（融合 v2.5.4 带入）。
- **`ledger.cleanup` 在同一年里有 7 天会删掉上月流水（2026-10-01 已修，上游未修）** —— 上一条修完顺着
  同一片代码摸到的，性质更糟：`cutoff := time.Now().AddDate(0, -keepMonths, 0)` 没有把日期**锚到 1 号**。
  上月天数不够时 Go 会归一化溢出：`2026-05-31 → 「4 月 31 日」→ 2026-05-01`，cutoff 算成**当月** 202605，
  比上月分段 202604 还新 ⇒ `cleanup` 把上月连同更早的一起 `os.Remove`，**`keepMonths=1` 在这些天实际保留
  0 个历史月，且静默无日志**。2026 年命中 7 天：3/29、3/30、3/31、5/31、7/31、10/31、12/31
  （闰年仍有 3/30、3/31）。实测方式是造两个历史分段跑判定：5-31/3-31/10-31 三个日期上「上月」被判过期删掉，
  10-01 与 6-15 正常。修法即 `prevMonthCutoff()`：先锚 1 号再加减月。
  ⚠️ **运维后果**：`cleanup` 在 `ledger.New()`（即每次启动）里跑，所以下一次命中日 **2026-10-31**
  若用**未修的二进制**启动（含开机自启触发的重启），会删掉本仓 `dist/data/ledger/` 里的
  `usage-202609.jsonl`(37 KB) 与 `credit-202609.jsonl`(5 KB)——不可恢复。要么先部署修好的二进制，
  要么在 10-31 之前把那两份备份走。
  判据同样是纯函数表驱动（端到端一年只红 7 天，必然假绿），期望值写字面量、不用同一套加法反算
  （否则测试与实现同错就永远绿）；另配一条 `TestCleanupKeepsPrevMonthToday` 盯真实删除路径。
  负向验证：cutoff 退回未锚定写法 → 8 个日期用例变红。

### L5 生产配置约束
`config.json` 与 `dist/config.json` 的 `listen.host` 是局域网地址（非环回）→ R4 要求
`admin_password` 非空且 ≥8 字符，**否则 daemon 启动即 fatal**。改回 `127.0.0.1` 则可不设。

### L6 React 迁移：当前状态与收尾清单
- 计划与实测记录：`docs/前端React重构架构计划.md`（2026-10-01 起已在 `.gitignore` 反选入库；
  本文记结论，那份记依据与逐阶段判定）。
- **闸门**（`internal/app/`）：`web_contract_test.go` 端点级双向契约 + `TestDOMIdParity`（114 个 DOM id
  集合差，`echartsCdn` 白名单）+ `node_modules` 不得进 `web-app/` 的守卫；
  `web_field_contract_test.go` 字段级契约（`/api/state` 36 个字段路径，反射 + 内联 map 源码扫描）；
  `web_theme_tokens_test.go` 三主题渠道色对账 + 禁止 tailwind `dark:` 变体。
  **这些闸门的价值在于能变红**，均已做过负向验证（改一个 id 名、删一行 `CH_VAR` 映射都会报精确位置）。
  2026-10-01 再加两道：`webui_gates_test.go` 以**固定 cwd** 跑 `webui/tools/{check-props,render-check}.mjs`，
  把手工入口 `npm run check` 接进 `go test ./...`（缺 node 或未装依赖则 skip，不阻塞无前端工具链的机器）；
  `render-check.mjs` 是渲染层闸门（SSR 数可见控件，见 `webui/FEATURES.md` §5.4）。
  ⚠️ **新教训：闸门还得证明「它真的看了东西」**。`check-props.mjs` 原先把扫描根写成相对 cwd 的 `'src'`，
  从仓库根跑就一个 `.jsx` 都扫不到，却照样打「✓ 0 个组件…全部对得上」并 `exit 0`——而它正是为
  L6.2 第 1 条白屏崩溃而加的闸门，换个 cwd 就退化成假绿（本轮第一次跑它就吃到了这个假绿）。
  已修：路径锚到脚本自身位置 + 扫到 0 个文件 / 0 个组件签名一律 `exit 1`。
  接线后两条负向验证：给调用点塞一个组件不接收的 prop → 红；把 `render-check` 的控件正则改成永不匹配
  → 红（即计数器静默失效时报缺失、不报绿）。
  同文件另有 `TestEmbeddedWebAppIsARealPanel`：断言 embed 目标里装的**真是面板**——index.html 引用了
  存在的 `assets/*`、JS 里认得出面板指纹（`btnToggleFees`/`btnRefreshAll`/`acct-card`）、且源码不比产物新。
  补它是因为 `//go:embed all:web-app` 只要求目录非空，而被跟踪的 `web-app/.gitkeep` 让「只有 .gitkeep」
  也能编译通过 ⇒ 产出 `/` 是空面板的 exe 且**全程无错**；既有产物级检查在无产物时一律 `t.Skip`，
  恰好在不变量 0 点名的两种情况（空壳 / 忘重建）下全部让路。三项均已负向验证。
- **迁移期双份 embed 已结束**（2026-09-30 收尾）。当时 `/` = vanilla（生产在用）、`/next/` = React，
  Go 侧改动是 `main.go`（embed 两路 + `fs.Sub` 两次）与 `server.Config.WebUINext` + 一段挂载块。
  现已全部回删：embed 只剩 `all:web-app`，`WebUINext` 与 `/next/` 挂载已移除。
- **收尾清单已执行完毕**（一次做完的 5 项）：
  1. ✅ `vite.config.js` 的 `base` 从 `'/next/'` 改回 `'/'`；
     同时把两处硬编码 `/next/logo64.png` 改成 `import.meta.env.BASE_URL` 拼接 ——
     否则挂载点一变就静默 404，不必每次收尾再手改一遍。
  2. ✅ `main.go` embed 去掉 `all:web`、`fs.Sub` 只留 `web-app`，`handler.go` 删 `WebUINext` 与 `/next/`；
  3. ✅ exe 实测：同源码 vanilla-only 基线 16,072,740 → 迁移期峰值 16,761,806（+689,066，+4.29%）
     → 收尾后 **16,580,652（+507,912，+3.16%）**，即去掉 vanilla 那一份回落 **181,154 B**。
     ⚠️ **这三个数已不可复现**（2026-10-01 用同 HEAD 源码重建得 16,641,509，+60,817），
     当历史留档看，做体积对账请现测——缘由见 L6.3「仍然剩下的」第 8 条。
     ⚠️ 阶段 1 预估的「收尾后 +1.96%」是拿**空壳 bundle** 算的，作废；此处为真实面板实测值。
  4. ✅ `cmd/wild-work/web/README.md` 说明「上游参考基准，不参与 embed」；
  5. ✅ 本节与 §10 L1/L3 已标注 vanilla 不再参与 embed（§4/§5 中描述的面板**行为**仍然准确，
     因为 React 版是按同样语义移植的；变的只是实现位置）。
- 二进制内容复核（收尾后实测）：`node_modules` 计数 0、`/next/` 计数 0、
  vanilla 的 `function renderAccounts` 已不在包内。

#### L6.1 完成了什么（2026-10-01 收口，11 个 commit）

| 阶段 | 交付 | 判据 |
|---|---|---|
| 0 | 三道闸门 + `FEATURES.md` 核对单 | 端点/字段/id 三类集合差均可变红（已逐个负向验证） |
| 1 | webui 骨架 + 会话链路 | 真实浏览器：401→登录层→cookie→`/api/state`→渲染 |
| 2 | `tokens.css` 三主题 + OKLCH + 字号阶梯 | 51 对 hex/oklch **画出来像素逐通道相等** |
| 3+4 | 面板功能全量移植 + 桌宠接入 | 6 卡各状态逐项核对；改名/停用真写穿磁盘 |
| 5+6 | 构建链固化 + 本文档 | `go build/vet` 全绿 |
| 收尾 | React 提到 `/`，vanilla 退为基准 | 未登录可见控件 20 vs 20 同后端对照 |
| 修补 | 3 个真实缺陷（见 L6.2） | 各自配负向验证 |

规模：**44 文件 / +8366 / −9**，其中 40 个纯新增、只改 4 个既有文件。
**业务代码零改动**（`internal/` 除新增测试外无一个既有 .go 被改；`handler.go` 迁移期加过
`WebUINext` 收尾又删，净变化为零）；上游 vanilla `cmd/wild-work/web/` 一字节未动。

#### L6.2 过程中修掉的五个「测试全绿但仍然错」的缺陷

1. **整页白屏崩溃** — `CreditValue` 声明 `{ account }`、调用点写 `a={a}`。
   JSX 无类型，vite/esbuild/go vet 全不报。之所以躲过前几轮验证：沙箱里只有匿名账号，
   而匿名卡走 `credits_na` 提前 return，永远到不了那段。→ 补 `webui/tools/check-props.mjs`。
2. **未登录面板塌成半张** — 可见控件 20 → 8（标签页、渠道费率、刷新积分、7 个添加按钮全没渲染）。
   → 同后端双二进制对照才量得出来。该判据已于 2026-10-01 固化成 `webui/tools/render-check.mjs`
   （SSR 数可见控件，口径与浏览器对齐在 20，已负向验证），见 L6.3「已处置」第 5 条。
3. **面板宽度被静默压 27px** — tailwind 核心组件 `.container` 与本项目同名布局类撞车，
   ≥768px 视口时它的 `max-width` 盖掉面板的 980px。vendored CSS 逐字相同也照样中招，
   因为冲突来自**加载的第二份 CSS**。→ 补 `TestBuiltCSSHasNoContainerCollision` 扫产物。
4. **积分明细浮窗永久不可见**（2026-10-01 由用户报出：「鼠标放在积分这一块看不到积分明细」）
   — `.credit-tip` 的 CSS 基础规则带 `display:none`，vanilla 靠 `web/app.js:229` 的
   `tip.style.display="block"` 点亮；移植时这个浮窗从「运行期 createElement + 手工点亮」
   变成「有数据才挂载的 JSX 节点」，于是按「渲染出来＝可见」的直觉把点亮那句丢了。
   结果节点在 DOM 里、2 行数据也渲染了、标题也在，但 `display:none`、`offsetHeight/Width=0`，
   **且不报任何错**；次生后果是定位 effect 量到 h=0，「向上翻」判据一并失准。
   → 补 `style={{ display: 'block' }}`，并加 `TestHiddenByCssBaseRulesAreExplicitlyShown`
   （扫 CSS 里基础规则带 `display:none` 的类，要求 JSX 使用点自己点亮；负向验证：摘掉那句即
   按 `文件:行号` 报红）。⚠️ 前三条的教训在它身上**仍然成立**：静态 id 对账只看 id 有没有写出来，
   `render-check` 是 SSR 没有 CSS 级联，取数驱动的分支更不在 SSR 覆盖内——
   「渲染出来了」与「看得见」之间还隔着一层样式表。
5. **积分明细浮窗位置漂移 + 移开不收起**（同日，用户看到浮窗后立刻报出「位置漂移了」）
   —— 同一次移植留下的两个缺陷，都属「把命令式 DOM 改成 JSX 时丢了命令式的另一半」：
   - **漂移**：浮窗是 `position:fixed`，却渲染在 `section.section` 里，而该 section 带
     `.reveal.revealed { transform: translateY(0) }`——**入场动画的末态仍是 transform 而非 none**
     （`prefers-reduced-motion` 下那条 `.reveal{transform:none}` 又被更高优先级的 `.reveal.revealed`
     盖掉），于是它成了 fixed 后代的**包含块**：按视口算出的 left/top 被当作相对 section 原点使用。
     实测整体偏 (22, 87)、垂直方向漂 **329px**。→ `createPortal(..., document.body)`
     （vanilla 的 `appendChild` 天然如此）。修后实测 `dx=0`、向下挂时 `gapBelow=4`。
   - **不收起**：卡片上写的是 `onMouseLeave={noCredits ? undefined : onDetail.hide}`，
     而 `onDetail` 是 `show`、**`show.hide` 从未定义过**（`hide` 上挂的是 `.cancel`/`.now`）
     ⇒ 处理器恒为 `undefined`，「移开 300ms 后自动收起」这条路径整个是死的：浮窗只会因换 hover
     目标而改内容，鼠标移开就永久挂在页面上。运行时实测 `typeof props.onMouseLeave === 'undefined'`。
     → 显式传 `onDetailLeave={hide}`，修后实测移开即卸载。
   - ⚠️ **对我自己的一条更正**：第 4 条修完时我只断言了「可见」和「落在 anchor 下方」，
     **没断言水平与 anchor 对齐**，于是放过了 `dx=-25`／纵向漂 329px。判据必须覆盖
     「它声称修好的那件事的全部维度」，否则绿灯只覆盖到你想到的那一面。
   - 另记：明细有 `cache.current[uid]` 缓存、命中即不再请求，**改桩数据后必须重载页面**，
     否则读到上一轮结果（本轮又踩两次，都是同一处）。
   - 防回归：`TestCreditTipIsPortaledToBody`。它第一版也是空断言——用 `Contains(s,"document.body")`
     判 portal 目标，而**注释里也写了这个词**，于是把目标改成 `#root` 的负向用例照样绿；
     改成匹配 `createPortal(` 的第二实参后才真会红（两个负向均已验）。

**教训（写死在这里）**：同源的是 CSS，不是渲染条件；token 字节相等证明不了「该出现的元素出现了」。
凡「界面有没有变」这类问题，判据只能是**同后端对照 + 数可见控件/量几何**，不能靠比对源文件。

#### L6.3 遗留问题（2026-10-01 二次收口后）

**已经处置的（原 B 类三项 + C 类两项，均所有者拍板后落地）**

1. **tooltip 数值格式化**（原 B5）——已修。`valueFormatter` 是 echarts 5.3+ 的选项、本仓精确锁 4.3.0
   （产物内计数 0），所以 tooltip 一直走 echarts 默认的 `addCommas`。改接管整个 `formatter`，
   逐字复刻 4.3.0 的默认结构（`model/Series.js` `formatTooltip`：标题 + 圆点 marker + 系列名 + `': '` + 值，
   行间 `<br/>`），只替换数值段。实测 `323,579` → `32.4万`。
   ⚠️ 附带的安全约束：`TooltipContent.js` 是 `el.innerHTML = content` 落地，默认实现会对系列名
   `encodeHTML`，自定义 formatter 后**转义不能省**——积分图系列名是用户可改的账号备注。
   实测：备注填 `<img src=x onerror=…>` 在 tooltip 里以 `&lt;img` 文本呈现，DOM 内注入节点 0。
2. **`usage.disabled` 观感**（原 B6）——已定为「提示条 + 保留版面」。整块替换一句话会让
   今日/7日/30日、刷新、四张 KPI 卡、两个子 tab 全消失。实测两态可见控件**逐项相同**（15 项同名），
   差额只在数值填充与图表容器 `display`。提示语按真实判据写：`disabled` = `app.ledger == nil`
   ← 启动期 `ledger.New` 失败（`main.go:248-250` 只记日志不拦启动），**面板侧没有开关**，
   所以不能写「去设置里开启」那种假指引。
3. **`前端React重构架构计划.md` 入库**（原 B7）——已在 `.gitignore` 反选，§9 加了链接与
   「结论以 L6.2/L6.3 + FEATURES §5 为准」的指向。
4. **`chkPet` 非响应式**（原 C8）——已修：受控 `useState` + 订阅 `Pet.setEnabled` 广播的
   `ww-pet-toggle`。vanilla 是靠 `app.js:774` 那行嵌错位置（glm 轮询回调内）的赋值顺带掩盖，
   移植时没照搬错位、于是暴露。实测：弹层开着时点桌宠浮层「隐藏」，勾选随之翻为 `false`。
5. **渲染层判据固化**（原 C10）——已补 `webui/tools/render-check.mjs`（`npm run check` 一并跑
   `check-props`）：vite `ssrLoadModule` + `react-dom/server` 渲真实分支，按「interactive 元素
   且不在 `.hidden` 子树内」数可见控件，五场景（App 未登录外壳 / Accounts 未登录 / Accounts 有数据
   六种卡片分支 / Settings 弹层 / Fees 弹层）。控件口径已与真浏览器逐项对齐在 **20**
   （`button|input|select|textarea` + `.icon-op|.icon-link` + 顶栏两格 `code.info-value`；
   初版数到 18 的差额就是这两格）。已负向验证：把 L6.2 第 2 条缺陷装回去 → `exit 1` 点名缺失的 18 个控件。
   ⚠️ 它仍**不覆盖取数驱动的分支**（SSR 不跑 `useEffect`），那类别再回到浏览器数一遍。
6. **积分明细 tooltip**（原 A1）——**已实测，并因此查出一个真缺陷**（见 L6.2 第 4 条）。
   原判「要 `resource_detail` 真返数据、我验不了」只对了一半：数据要真凭据，但**渲染与样式层**
   可以用「页面内改写 `window.fetch` 喂假响应 + 直接调 React 的 `onMouseEnter`」驱动。
   四条子判据全部实测过（沙箱 + 合成数据，不需要上游凭据）：hover 挂载并可见
   （`display:block`、380×184）；12 条分两页、点 › 后 `1 / 2 → 2 / 2`、行首由「套餐1」变「套餐9」、
   高度 375→248；有条目带 `expire_at` 时出现「有效期」列、全部不带时**整列消失**（4 列 / 每行 4 格，
   即不变量 18 的「缺失不得用零值冒充」）；`unusable_remain=0` 时不显示「不可用」。
   ⚠️ 方法教训两条：① 明细有 `cache.current[uid]` 缓存，命中即不再请求——第二次用例没重载页面
   就会读到上一轮的缓存数据（我第一版就测出了「4 行 + 有效期列」的假矛盾）；② 匿名卡 `credits_na`
   不挂 hover，必须挑真账号那张卡。

**仍然剩下的**

**A. 只能靠生产真凭据验证的（我这边验不了）**
1. 「刷新积分 / 全部签到」真联（含不变量 19/20 的 401 自愈 + refresh 后落盘）;
2. glm CDP 自动登录（`glm_auto` → 真拉浏览器 → 轮询 `glm_auto_status` → 访客 token 判据）;
   > ~~原第 1 项：积分明细 tooltip~~ **已实测，并当场查出真缺陷 L6.2 第 4 条**。它被归进
   > 「验不了」是判断错误：上游数据确实要凭据，但**渲染与样式层不需要**——页面内改写
   > `window.fetch` 喂假响应就能驱动。详见上方「已处置」第 6 条。
   > ~~4. 多渠道时图例翻页~~ **已实测（2026-10-01，不需要生产凭据）**：沙箱造 7 渠道 × 7 天流水，
   > legend 以 `type:'scroll'` 渲染成功、控制台零报错（漏注册的表现是运行期
   > `Component legend.scroll not exists`，见 `Usage.jsx` 顶部注释）；再把 `#usageChart` 压到 240px
   > 并派发 resize，图例带内墨迹裂成 4 组、末组贴在 x=216~239 —— 即翻页控件真的出来了。
   > 判据来源：`getImageData` 采样画布像素（echarts 的 legend 画在 canvas 上，没有 DOM 可查）。
   > 这条从 A 类摘掉是因为它落在**合成数据可覆盖**的范围里；剩下 1–2 条仍要真上游凭据，
   > 且都在 render-check 的盲区（取数驱动 / 真上游），**没有闸门兜住**，别当成已验证。

**C. 已知但低影响 / 有意为之**
5. 我给两个主 tab 加了 `mtabBtnAccounts`/`mtabBtnUsage` 两个 id（vanilla 用 `.main-tabs .mtab` 选类）——
   属新增，非缺失。
6. ~~`go test ./...` 有一处既有失败：`internal/cdp` 的 `TestWriteDoesNotHangClose`~~
   **已于 2026-10-12 随 L11 融合消失**（上游 PR #86 把断言窗口 12s→20s），现全绿，见 §10 L4。
7. `dist/wild-work.exe`（Windows）只验过**体积与二进制内嵌标记**，从未在本机执行过（Linux 环境）。
   它的实际运行表现要等所有者在 Windows 上确认。
8. ⚠️ **上面 L6 收尾清单第 3 条（本文件 line ~434）记的 exe 体积不可复现**：用**当前 HEAD 源码**重建
   `dist/wild-work-linux` 得 16,641,509 B，而 2026-10-01 09:30 那份产物是 16,580,692 B（记录值 16,580,652），
   差 **+60,817 B**；本次改动本身实测只值 +1.00 kB bundle（649.42 → 650.42 kB）。
   即那份基线是在一个**更早的 web-app bundle** 上量的（`web-app/` 被 gitignore，无从比对哈希，
   原产物已被覆盖，无法归因）。今后做体积对账请现测，不要引用这几个数。

**D. 待办动作**
9. ~~生产 daemon（PID 2948815，2026-09-29 启动）仍在跑旧二进制里的 vanilla 面板，`/proc/<pid>/exe` 指向 `(deleted)`。~~
   **2026-10-12 复核已翻新**：现进程是 **PID 2992445**（2026-10-08 14:47:30 启动，`SID==PID` 会话首进程、TTY `?`），
   `/proc/2992445/exe → dist/wild-work-linux`（**不是** `(deleted)`，即跑的就是磁盘上那份），监听 `10.20.15.118:7863`。
   它是 10-08 那次重启的产物 = **React 面板 + v2.6.2 代码**；本轮 v2.6.3+ 融合与前端移植**要再重启才生效**。
   ⚠️ 顺带一条硬约束：daemon 正在执行 `dist/wild-work-linux`，所以 `go build -o dist/wild-work-linux` 会 **ETXTBSY 失败**
   ——不要误以为是构建出问题，本轮因此只重建了 `dist/wild-work.exe`。
   重启前先按 L7 备份 `dist/data/ledger/` 与 `dist/config.json`，用 `SIGTERM`（不要 `-9`）；
   因监听局域网地址会瞬断其他设备的客户端，**须所有者点头**。
   > ✅ **2026-10-12 15:42 已按上述流程重启完毕**（所有者点头）：新进程 **PID 3979065**、`SID==PID`、TTY `?`、
   > 启动约 1s 内旧进程 SIGTERM 优雅退出。L7 四项判据逐项实测通过——① `/proc/exe` 指活路径；
   > ② 首页引用 `assets/index-BBHauEO7.js`（本轮最新 bundle，服务端取回 676,622 B 与产物同尺寸、旧哈希残留 0）；
   > ③ 无会话 `/api/state` = 401、`/api/auth/state` = 200；④ bundle 内数得到 `btnAddCline` / `modelSearchOverlay`
   > 等本轮新增指纹。带 key 的 `GET /v1/models` = 200、188 个模型、6 个渠道前缀（`cline` 因无账号而不出现，符合预期）。
   > 记账完整性：5 个流水文件 + `credit-snapshot.json` 与备份**逐字节相同**，`app.log` 前缀相同且增长 6,601 B（未截断）。
   > ⚠️ **重启时踩到一条会骗人的判据**：`app.log` 的时间戳是 **Go 标准 log 的 `2026/10/12 15:42:01` 斜杠格式**，
   > 而我按平时写的 `2026-10-12` 去 `grep`，**匹配 0 行**——于是「本次启动 0 个 error」看起来像是结论，
   > 实际是谓词根本没扫到东西（空转的绿）。修法：按**字节偏移**（备份时记下的 size）切出重启后新增的 80 行来扫，
   > 并**同时拿同一谓词扫全文件做对照**（命中 96 条 ⇒ 证明它能变红）。
   > 凡是「数某类异常」的判据，报 0 之前先问一句：**它扫到了几条？**
10. ~~未 push（`xiaoyi728/wild-work` 私有仓仍是旧的）。~~ **2026-10-12 已 push**：
   本轮融合的 5 个提交（后端采纳 / React 移植 / 浏览器实测修正 / 文档 / 版本更正）已进 `origin/main`，
   与本条所属的文档翻新提交随后一并推送；推送前后 `git rev-list --left-right --count origin/main...main`
   均为 `0 0`（快进，无分叉）。`config.json` 与 `dist/` 均未被 git 跟踪，凭据与生产数据不在推送内容里。

- **已知有意行为差异**（不是 bug，别再"修回去"）：
  - `echartsCdn` 这个 id 消失（echarts 改 npm 按需引入，不再有 CDN `<script>`，L4 记的无 SRI 隐患随之消除）；
  - `creditTip` 由 vanilla 的运行期 `createElement` 变成 JSX 常驻节点；
  - 首屏总量 vanilla 995,000 B（含 CDN echarts 751,806 B）vs React 756,036 B ⇒ −24.0%，
    但**本地传输 +210.9%**——echarts 从网络搬进二进制的必然代价，换来断网可用与 3~10s CDN 卡顿消失。
  - 未登录时桌宠轮询 `/api/pulse`、`/api/state` 会在浏览器网络日志里留一串 401。
    这是 L2 的**设计行为**（`petGet` 遇非 2xx 返回 null、静默跳过、登录后自愈），
    vanilla 的桌宠同样如此，不是 React 引入的回归，别去"修"成静默。

### L7 生产 daemon 的启动与重启（**无任何托管**）

- **事实**：本机没有 systemd user 单元、没有 cron、没有 `~/.config/autostart` 条目，Linux 侧开机自启
  按 §7 本就「未实现」。所以进程挂掉**不会自己回来**，机器重启后也不会起来，必须手工启动。
- **现行启动方式**（`cwd` 必须是 `dist/`；`WILDWORK_HOME` 留空即沿用 exe 所在目录）：
  ```bash
  cd dist && WILDWORK_HOME= setsid nohup ./wild-work-linux --no-tray < /dev/null > /tmp/ww-prod-restart.log 2>&1 &
  ```
  ⚠️ 判据是 **`ps -o pid,ppid,pgid,sid -p <pid>` 里 `SID == 自身 PID`**（会话首进程）+ TTY 为 `?` +
  stdin 接 `/dev/null`，**不是 PPID=1**——PPID 是否变成 1 只取决于启动它的 shell 有没有恰好退出，
  实测两次重启：一次 PPID=1（shell 已退），一次 PPID 仍是那个 `/bin/bash -c …`（shell 还在），
  但两者 SID 都等于自身 PID，都是安全的。拿 PPID 判存活会误判。
- **`SIGTERM` 是优雅关闭，不要用 `kill -9`**：`main.go` 的 `<-sig` → `App.Stop()` →
  `srv.Shutdown(3s)` → `App.Close()` → `ledger.Close()`，后者会冲刷那对 30s `AutoFlush` 缓冲句柄。
  硬 kill 的代价是丢掉最后 ≤30s 的 usage/credit 流水。
- **重启前后各做一件事**：先把 `dist/data/ledger/` 与 `dist/config.json` 备份出去
  （本轮放 `/home/incam/Software/_pre-restart-<日期>/`，沿用 `_pre-merge-*` 的既有惯例）；
  起来后拿备份逐文件 `cmp`，证明没有截断——2026-10-01 实测三个流水文件字节相同。
- **确认「真换上了新二进制」的四项判据**（均为实测，别只看进程还在）：
  ① `/proc/<pid>/exe` 指向活路径，**不是** `(deleted)`——`(deleted)` 说明跑的是被覆盖掉的旧 inode；
  ② `curl /` 的首页引用 `assets/index-*.js`（React）而非 `app.js`（vanilla）；
  ③ 无会话访问 `/api/state` 返回 401（R4 的强制没退化）；
  ④ 从服务端取回的 bundle 里数得到面板指纹（`btnToggleFees` / `acct-card` / `ww-pet-toggle`）。
- ⚠️ **验证用的 URL 自己也会写错**：本轮就出现过 `http://10.20.118.7863/` 这种错址，请求根本失败
  而计数照样输出 `0`，看起来完全像「通过」。计数合乎预期但来路可疑时，先把原始响应打出来看。

### L8 2026-10-08 融合：上游 v2.5.4 → v2.6.2（`1bcf5ef`）

- **形态**：本地仓库已 git 化且**与上游无共同祖先**（本地 root = `d33ab7b`），故不能 `git merge`；
  流程 = 「`git checkout upstream/master -- <路径>` 整树采纳无冲突文件」+「冲突文件走 `git merge-file` 三方」（沿用 L3）。
  上游变更面 115 文件 / 61 提交 / +20289−442，**真实冲突面只有 6 个**：`handler.go`、`app.go`、
  `main.go`、`ledger.go`、`glm_rotation_test.go`、`AGENTS.md`（+ `web/{app.js,index.html,style.css}` 作为 diff 基准保留）。
- **本轮采纳（前端只补功能，见 L1/L3 的三步法）**：`internal/stats` 运行统计引擎（R43）、
  `internal/idle` 流空闲监控、raccoon / monkeycode / loomy 三渠道（R41/R42）、
  模型级冷却与同请求换号（R29 修订 / R38 升级）、`/api/stats` 与 `/api/account/import_local` 等新端点。
- **本轮保留的本地专有**：`/api/pulse` + `Handler.Traffic()` 桌宠流量计（L2）、登录/登出的
  `http.NewCrossOriginProtection()` 防跨源锁密码、`ownAccounts()` 别名渠道判据（issue #36）、
  `//go:embed all:web-app`（React 产物，L6）。
- **取舍判据**：`ledger.go` **以本地为准 + 吸收上游其余**——本地 `prevMonthCutoff` / `monthSegments`
  是纯函数且带负向测试，**上游 v2.6.2 的 `cleanup()` 仍有月末 `AddDate` 溢出 bug**（未修）；
  上游的 `RecordCheckinEarn`（issue #67）与 `entries` 显式 `sort.SliceStable` 已吸收。
  `glm_rotation_test.go` 采纳上游新语义，但**再次删除** `TestGLMNotSingleAccount`——
  它只断言常量与 Go 零值、从不读 `main.go` 装配，永不可能失败；真守卫是 `cmd/wild-work/single_account_test.go`。
- ⚠️ **`gofmt` 陷阱**：`internal/server/handler.go` 与 `internal/app/app.go` 的**上游 master 版本本身就未 gofmt**
  （`ErrSoftRate` 分支缩进、`AccountView` 字段对齐）。本地刻意**不**重排——重排会让本地 diff 对不上上游，
  下次融合又要重新判读。`go build`/`go vet`/`go test` 不受影响。
- ⚠️ ~~**L4 增补**：`internal/cdp` 的 `TestWriteDoesNotHangClose`（`writeTimeout=15s` > 测试预算 12s）
  在 v2.6.2 依旧失败，属**上游自带缺陷**，勿归因于本地改动。~~
  → **已被下一轮融合（§10 L11，上游 PR #86）修掉**，v2.6.2 那版确实还红着，当时的记录没错。

### L9 2026-10-08 前端「只补功能不动设计」：React 侧承接 v2.6.2 的运行统计与三渠道

- **范围纪律**：桌宠与视觉层零改动（`pet.js` / `pet.css` / `public/pet/*` / `style.css` 既有规则 / `tokens.css` 既有色值
  一律不碰）。只做四件事：① 三个导入型渠道（monkeycode / raccoon / loomy）进面板；② 运行统计 tab（新建 `components/Stats.jsx`）；
  ③ 积分汇总条（PR #68）与费率 tab 余额角标 + 模型名点击复制（PR #69）；④ 相应 CSS **追加**在 `style.css` 末尾（新段带标题注释，不改既有规则）。
- ⚠️ **契约测试只扫构建产物**：`internal/app/web_contract_test.go` 的 `uiSourceDirs` 是 `cmd/wild-work/web`（vanilla 基准）
  与 `cmd/wild-work/web-app`（React 产物），**不含 `webui/src`** ⇒ 新端点只写进源码时 `TestPanelAPIRouteContract`
  必然报「无任何前端引用」，必须先 `npm --prefix cmd/wild-work/webui run build` 测试才转绿。这是闸门设计使然，不是 bug。
- ⚠️ **`tokens.css` 插色不能用「按缩进猜块」**：`--glm` 在 6 个主题块里各出现一次（light hex / light `@supports` oklch /
  dark hex / dark `@supports` oklch / paper hex / paper `@supports` oklch），缩进只有两档（`  ` 与 `    `），
  第一次按缩进自动插入把 dark/paper 插错块，`git checkout` 回滚后改按**精确行号**插入才对。
  oklch 数值一律用 `webui/tools/derive-tokens.mjs` 的 `oklch()`/`fmt()` 现算，不手写。
- ⚠️ **新 CSS 类不要写 `display:none`**：`TestHiddenByCssBaseRulesAreExplicitlyShown` 要求 JSX 使用点 inline `display:`，
  新类干脆不带 `display`，省掉这层耦合（沿用 L1 对 `.credit-tip` 的处理）。
- **新增渠道的落地清单**（漏一处就会被契约测试点名）：`constants.js` 的 `CH_LABEL`/`CH_CLASS`/`CH_NAMES`/`NO_EXPLICIT_CHECKIN`/
  `PROXY_CHANNELS`/`PROXY_HINT`/`NO_CHECKIN_LOGIN_HINT`/`CHANNEL_PRESETS` + `channelColors.js` 的 `CH_VAR` + `tokens.css` 三主题色 +
  `style.css` 的 `.btn.primary.alt.<kind>` 背景。
- **导入型渠道的弹层三分支**：普通（浏览器授权）/ 导入型（只打 `/api/account/import_local`）/ 双入口（raccoon，R41 协议回调），
  判据是 `isImportLocal()` 与 `hasProtocolLogin()`；导入失败时后端 `note` 必须透出（已装/未登录官方客户端的降级提示不能吞）。
  > ⚠️ 这一条**已被 §10 L11 改写**：R44 把小浣熊登录换成网页版 CDP 捕获，`hasProtocolLogin()` 更名 `hasWebLogin()`，
  > 并新增第四种形态「粘贴凭据型」（Cline，判据 `isPasteKey()`）。历史描述保留在此不删，是为了记下「弹层形态是随渠道协议变的，
  > 不是一套模板」——但**照这段改代码会写错**。

### L10 2026-10-08 README 重写为「本仓库视角」+ 删交流群
- **起因**：README 此前与 `upstream/master` 逐字一致（纯上游文案），既没写本地能力，也把渠道数写成「十一渠道」
  ——实际界面 12 个（漏 `glm` 智谱清言），测试数写 62 也已过时（同步后 98 个）。
- **改法**：新增「本仓库说明」表（React 面板 / 桌宠 / 运行统计 / 端点防护 / 记账修正五项本地能力）+「架构」节
  （目录树、运行时 Go 1.25 仅两直接依赖、`data/` 落盘清单、测试闸门），功能节改写为十二渠道并补 v2.6.2 新能力
  （同请求换号、模型级冷却、300s 空闲监控、导入型渠道、托盘三态图标）；压缩冗长示例（Pi 配置只留 2 个模型）、
  删掉个人吐槽式 FAQ 条目；徽章与 Releases 链接改指本 fork + 上游。
- **删「交流群」整节**，连带删除 `wechat_group.jpg`（166 KB，删节后全仓零引用）——此为相对上游的本地偏离。
- **口径纪律**：README 里的数字必须现查现写。本轮逐项核实：面板 `/api/*` 端点 34 个、推理端点 6 个
  （`internal/server/handler.go:144-145` 的 chat/completions + models，`internal/gateway/gateway.go:120-124` 的
  responses/messages/count_tokens/systemone）、`_test.go` 98 个、`data/stats.json`（`internal/stats/stats.go:280`）、
  托盘单条目 `build/trayicon.ico`（`cmd/wild-work/main.go:595`，OpenUI/OpenLog/Quit，退出先 `systray.Quit(3s)` 摘图标）。

### L11 2026-10-12 融合：上游 v2.6.2 → v2.6.3+（`d24e46d`），并查出两个上游侧「不报错但功能到不了」的缺陷

- **形态**：沿用 L8（本地与上游**无共同祖先**，不能 `git merge`）=「整树采纳无冲突文件」+「`git merge-file` 三方」。
  上游变更面 21 提交 / 55 文件 / +5851−2322；**真实冲突面仅 6 个**（`app.go`、`handler.go`、`main.go`、`AGENTS.md`、
  `README.md`、`build.yml`），且三方合并**零冲突**——双方 hunk 落在不同区域。上游新增 R44–R48 已并入。
- **本轮采纳**：Cline 新渠道（R46/R47，`internal/cline` 7 文件 ~1856 行）、小浣熊网页版 CDP 登录（R44，跨平台，
  废弃注册表协议回调）、小浣熊客户端会话自愈（#85）、`import_local` 移除整体 Windows 门禁 + macOS 路径（#75/PR#93）、
  明细同源回写 `creditSnapshot`（R45）、`normalizeToolTurnContent` 补空壳 assistant content（R48，修 traecode/SOLO 4001）、
  单账号渠道流式错误透传（PR#92，运行时 `len(Pool.List())<=1` 判据，与静态 `SingleAccount` 互补）、
  14 个 `RELEASE-v*.md` 并入统一 `RELEASES.md`。
- **测试基线变了，别再按旧预期读结果**：上游 PR #86 修掉 `internal/cdp` 的 `TestWriteDoesNotHangClose`
  （断言窗口 12s→20s，本仓实测 PASS 15.20s）、PR #88 修掉 ledger 签到用例硬编码日期与跨月窗口「每月固定红一个月」的
  日期炸弹。故 **`go test ./...` 自本轮起全绿（30 包 0 FAIL）**，L4/L6.3/L8 三处「唯一既有失败」的记录已划掉改写。
- **有意不采纳（四处，均为本地偏离，下次融合仍会撞上，别再重新判读）**：
  1. `.github/workflows/build.yml` —— **本仓库不带 CI**（`git ls-files .github` 为空，工作流文件从未进过本地历史），
     上游对它的「从 `RELEASES.md` 截段落当 release note」改造无处生效；
  2. `scripts/ui-static-check.mjs` 的上游更新 —— 它是**孤儿脚本**（只有 `node ui-static-check.mjs` 手工入口，
     既不接进 `go test` 也不在 CI），且驱动的是 `cmd/wild-work/web/app.js`，而**本地那份冻结在 v2.6.2 之前的形态**
     （`grep -c renderStats` = 0，与 v2.5.4 tag 的真实内容差仅 144/24 行本地视觉层）；
  3. `cmd/wild-work/web/` 整个目录不动 —— 它含本地视觉层 + 桌宠（`pet.js`/`pet.css`/`anim.*`/`theme.js`），
     既不 embed 也不被服务，采纳上游 vanilla 等于覆盖本地设计；
  4. `README.md` 以本地为准（L10 刚重写过），`wechat_group.jpg` 保持删除（上游只是把它压到 65 KB）。
- ⚠️ **换行符陷阱第二次命中同一批文件**：`web/index.html` 的 raw diff 是 512/457，带 `--ignore-cr-at-eol` 后
  真实内容差只有 **56/1**。凡是比对 `cmd/wild-work/web/` 一律带这个开关（L3 已记过一次，这次又差点误判成「上游重写了前端」）。

- **查出的上游缺陷 ①（Cline 进不了费率面，R34 家族）**：上游给 Cline 配齐了 `internal/cline`、面板「＋ Cline」按钮、
  `.ch-header.cline` 样式，**却没把它加进 `internal/app/feeChannelOrder`**。而 `buildFeesChannels` 是
  `for _, k := range order` 的**枚举**语义（不是排序键）⇒ Cline 根本不出现在 `/api/fees`，费率表、模型查找、
  用量折线全都拿不到它，且**全程不报错**。修法：补 `provider.Cline` +
  新增 `internal/app/fee_channel_order_test.go`——扫 `provider.go` 的 `Kind = "..."` 常量声明，
  双向锁死「已声明 ⇒ 必须在面板顺序表里，不在就得进 `feePanelExempt` 并注明缘由」；
  反向还查「顺序表里有 provider 未声明的键」（拼错的字符串同样静默 continue，不报错）。
  负向验证：摘掉 `provider.Cline` → 变红并点名 `Cline(cline)`。**判据取源码扫描而非手写清单**，
  因为手写一份 Kind 列表会和被测对象同错。

- **查出的上游缺陷 ②（复制出来的模型 ID 调不通）**：上游 330ee79 的完整 ID 判据是
  「`m.model` 含 `/` 就当作已带渠道前缀」。但 `handler.go:runtimeForModel` 用
  `strings.SplitN(model, "/", 2)` 只切**第一个**斜杠 ⇒ Cline 的 `cline-free/grok-4` 必须写成
  `cline/cline-free/grok-4` 才路由得到，按上游判据复制到客户端就是 `provider "cline-free" is not configured`。
  讽刺的是这正命中原文件自己的注释「光复制模型名粘到客户端里是调不通的，这是本页最容易踩的坑」。
  本地 `Fees.jsx` 抽出 `modelIds()`：短名一律不剥、前缀一律补。
  闸门：`render-check` 第 6 个场景「完整模型 ID 前缀」，fixture 里**故意放一条带斜杠的 `cline-free/grok-4`**；
  负向验证：装回上游判据 → `rc=1` 并输出「cline/cline-free/grok-4 → 复制目标算成了 cline-free/grok-4」。

- **顺手修掉本地两处既有缺陷（均为补缺失，不改既有规则）**：
  ① `monkeycode`/`raccoon`/`loomy` 三渠道上一轮只补了 `.btn.primary.alt.*` 与 `.cs-chip.*`，
  **漏了 `.badge.*`**——而 `.badge` 基规则带 `color:#fff` 却无背景 ⇒ 这三个渠道的徽章一直是白字透明底（看不见字）。
  实测补后 MonkeyCode 徽章 = `rgb(192,38,211)`。
  ② 积分明细缺 `info_only` 分支：后端 `Summarize()` 已把它排除在 `usable_remain` 之外（MonkeyCode 的每日 Token 额度），
  面板不标注就出现「明细各行相加 ≠ 底部可用小计」。补「仅展示」角标。
  ③ Cline 的同账号告警**从未露过面**：`submitClineKey` 里连续两句 `toast(warning)` + `toast('已添加')`，
  同一 tick 内后者覆盖前者，React 只渲染最后一个值。合并成一条才真送得到。

- **验证方式（SSR 闸门覆盖不到的那一类）**：沙箱 `go build -o /tmp/ww-sbx/` + `WILDWORK_HOME=/tmp/ww-sbx/home`
  + 监听 `127.0.0.1:28763`（生产 daemon 2992445 在 `10.20.15.118:7863`，全程未动），页面内改写 `window.fetch`
  喂假 state/fees，逐条量：明细 `dx=0` 无漂移、排序「临期→可用→已用完→不可用」、临期行 `rgb(215,0,21)` = `--danger`、
  R45 卡片 1000→137 且汇总条同源、enter+leave 同 tick 无幽灵浮窗、切主 tab 浮窗即收起、
  A/B 对照「点登录小浣熊 `window.open` 调用 0 次 / 点登录 WorkBuddyCN 调用 1 次」证明 `hasWebLogin` 分支真在分流。
  ⚠️ **方法教训**：跨 `evaluate_script` 调用读 toast 读到 null，一度被我当成「toast 没渲染」。真因是本机每次工具往返 >3s
  而 toast 3s 自动消失；改成单次调用内自采样才看出机制是好的。**判据读不到 ≠ 被测对象坏**，先怀疑观测方式。
  ⚠️ 另一条：`pkill -f wild-work-sbx` 会匹配到自己的命令行把 shell 杀掉（exit 143），按 L7 只用 `pkill -x`。

- **口径更新（L10 的「现查现写」纪律，本轮重新量过）**：面板 `/api/*` 路由 **34 → 37**（新增 `login/cline_key` 等），
  `_test.go` **98 → 105**，render-check 场景 **5 → 6**，渠道 **12 → 13**。README 已按新数改写
  （含删掉「MonkeyCode/小浣熊/Loomy 仅支持 Windows」这条已被 #75/R44 推翻的 FAQ）。
- **版本常量已被融合带成 `2.6.3`（不是我 bump 的）**：`internal/app/app.go` 的 `const Version` 本地一直是上游同值，
  上一行从未被本地改过 ⇒ `git merge-file` 把上游 `2.6.2 → 2.6.3` 那次改动**干净采纳**，全程无冲突提示。
  这与 L8 的先例一致（v2.6.2 那次融合后常量就是 2.6.2）——**版本常量跟随上游基线**，
  「deliberately held」针对的是**不为本地新增功能自行加分支号**，不是「永远不改版本号」。
  ⚠️ 但这条容易被误读成「我发版了」：本仓库**没有打 tag、没有写 RELEASE 段落、没有发布**，
  `RELEASES.md` 里的 v2.6.3 段落是上游写的。若所有者要本地独立编号，改这一处即可。
- 顺带记一条**融合纪律的新教训**（比结论更重要）：三方合并里「本地没改 = 上游改动静默生效」是正确默认，
  但它意味着**语义敏感的常量（版本号、开关默认值、渠道清单）不会给你任何冲突信号**。
  以后每轮融合后应显式 `grep 'const Version' internal/app/app.go` 对一次账，别只盯着冲突文件清单。

### L12 2026-10-13 融合：上游 v2.6.3+ → v2.7.1（`5bca0a7c`），并订正上一条对 `modelIds()` 的判据缺口

- **形态**：沿用 L8/L11（本地与上游**无共同祖先**，不能 `git merge`）=「整树采纳无冲突文件」+「`git merge-file` 三方」。
  上游变更面 31 提交 / 55 文件（含 v2.7.0、v2.7.1 两次发布）；**真冲突面 10 个，其中 Go 只有 4 个**
  （`main.go`、`app.go`、`ledger.go`、`handler.go`），三方合并**唯一一处冲突**是 `provider.Cline,` 那行的注释差异。
  其余 34 个文件本地一字节未动 ⇒ 直接覆盖；21 个是上游新文件。
- **本轮采纳**：R49 思考档位透传、R50 `internal/loopguard` 思考链防癫、R51 OpenRouter 思考字段归一化、
  R52 完整 ID 前缀契约、缓存利用率统计（`internal/server/cacheusage.go` + `ledger` 的 `CR/CRC` +
  `internal/monkeycode/cacheusage.go` 修「本渠道重建 usage 时丢掉 `input_tokens_details`」+ `stats/persist.go`
  持久化缓存样本，PR #105）、Cline 三条压测订正（`forceStream` / 地区限制不罚号 / `measuredCaps`）、
  `internal/devdump`（`-tags devdump` 才生效，发布构建是空桩；接线点在 `proxy.go` 的 `applyProxyToKind`，
  那是唯一对全部渠道统一改 Transport 处，故各渠道包零改动）。上游 R49–R52 已并入 §1。
- ⚠️ **`ledger.go` 仍然必须以本地为准 + 只叠加缓存字段**：本轮实测 `grep -c prevMonthCutoff / monthSegments` 在
  上游 master 上**都是 0** —— L4 记的两个月末 `AddDate` 溢出与跨月漏扫，上游到 v2.7.1 **依旧未修**。
  这次它因 `CR/CRC` 进了冲突面，**整文件采纳上游会把 2026-10-31 删上月流水的 bug 改回来**。
- **本地专有在三方合并后仍在**（逐项实测，不是假设）：`main.go` 的 `//go:embed all:web-app` +
  `fs.Sub(webFS, "web-app")`（上游是 `all:web`，它没有 React 面板）、`handleRaccoonCallback` 前置拦截、
  `app.go` 的 `ownAccounts()`（**上游把同一判据内联在 4 处**，语义相同、形态不同 ⇒ 每轮融合都会重新撞上，
  下次仍保留本地函数形态）、`/api/pulse` 与 `handler.go` 的 `Traffic()`/`traffic`/`lastReq`
  （上游删了 `sync/atomic` import，本地必须留）、`SingleAccount: true` 仍只有一处（oczen，R24）。
- **有意不采纳（本轮新增一项设计面裁定）**：`cmd/wild-work/web/`、`scripts/ui-static-check.mjs`、
  `README.md` 沿用 L11；**新增**：上游本轮的三项设计改动经所有者 2026-10-13 裁定**不移植** ——
  手机竖屏响应式布局、渠道添加按钮改 6 列两行、**积分明细浮窗由 hover 改点击式**。
  同理**不加第 4 个主 tab**：上游把「模型列表和费率」升为主 tab，本地费率仍是弹层（L1 的本地形态），
  档位小标、缓存列、实测表都进弹层内容而非改 tab 结构。
- **React 侧移植清单**（只补功能，`pet.js`/`pet.css`/`public/pet/`/`anim.css`/`tokens.css` 既有色值
  一律未动，已用 `git status -- <这些路径>` 证空）：`Usage.jsx` 缓存列 + 平均速度列 + 缓存利用率卡 +
  区间 `localStorage` 记忆；`Stats.jsx` 模型消耗表缓存列；`Fees.jsx` 档位小标 + `hand_measured` 来源标 +
  `modelIds()` 补 `startsWith` 护栏；`Settings.jsx` 防癫开关；`LoginFlow.jsx` Cline 实测参数表；
  新建 `components/CacheCell.jsx`（**三态判据必须 Usage 与 Stats 同源**，否则「不知道」在哪一侧被画成 0% 会分叉）。
- **R52 对本地的实际意义**（上一条的缺口）：本地 `modelIds()` 当初是**无条件补前缀**，比上游的错判据对，
  但缺上游那层「已以 `ch/` 开头则原样保留」的护栏 ⇒ 若 `/api/fees` 给出已带前缀的名字会拼成
  `workbuddy/workbuddy/*`。本轮按 R52 补齐，并把两个方向都做成断言。
- **平均速度列的数据来源**：速度只存在于 `internal/stats` 引擎内存（ledger 只扫文件、无速度字段），
  上游 vanilla 靠常驻 30s 轮询把 `perfLookup` 喂给用量 tab；本地 React 里 Usage 从未取 `/api/stats`，
  故移植成「用量 tab 每次取数时并拉一次 `/api/stats` 建索引」，拉不到本列自己降级成「—」，不影响其它列。
- **闸门**：`webui/tools/render-check.mjs` 场景 **6 → 7**，第 7 场景断言缓存三态（`cr_cov=0`→「—」而非 0%）、
  档位只在声明行出现（数 `class="effort-tag"` 恰 1 次）、实测值带 `hand` 类、`modelIds()` 双向用例；
  第 3 场景控件清单加 `chkLoopGuard`。**三项负向均已验证会变红**（把「不提供」改成 0% → 红；
  装回「含斜杠即视为已带前缀」→ 红且点名 `cline-free/grok-4`；摘掉 `chkLoopGuard` → 红报缺失控件）。
  `web_field_contract_test.go` 的 `uiWantsState` **补 `loop_guard`**：面板读的是 `state.loop_guard !== false`，
  Go 若漏发该字段则读出 `undefined`、判据仍成立 ⇒ **开关恒显示「开」而实际配置可能是关**，
  这是本条最容易静默的形态；负向验证用假字段 `loop_guard_zzz` 装入清单 ⇒ 闸门变红。
  路由契约在移植前后各红过一次（`POST /api/config/loop_guard` 无人引用），即它天然能拦「后端有接口面板不接」。
  `TestDOMIdParity` 方向性核实过：只对「vanilla 有而 React 无」报错，新增 id 仅提示 ⇒ 本地新增
  `ucCache`/`chkLoopGuard` 不会假绿也不会假红。
- **口径更新**（L10 的「现查现写」纪律）：面板 `/api/*` 路由 **37 → 38**、`_test.go` **105 → 118**、
  `go test ./...` 包数 **30 → 32**（新增 `loopguard`、`devdump`，实测各跑 15 / 2 个用例，非空绿）、
  render-check 场景 **6 → 7**、版本常量 **2.6.3 → 2.7.1**（同 L11 先例由 `git merge-file` 带成上游值，
  本地**未**打 tag、**未**发布；`RELEASES.md` 里 v2.7.0/v2.7.1 两段是上游写的，本轮纯 append 采纳）。
- **沙箱浏览器实测**（`/tmp/ww-sbx` + `127.0.0.1:28763`，生产 daemon 3979065 全程未动）：缓存列三态逐条对上
  （`0.00%` 真未命中 / 「—」不提供 / `94.9%` `97.5%` 命中）、汇总卡 94.9%、`(524k*)` 带 `ctx-tag hand`
  与「本工具实测值」措辞、同表未声明档位的模型 `effort-tag` 计数为 0、`cline/cline-free/mimo-v2.6-flash`
  双层 ID 正确、搜索面板同口径、防癫开关真写穿 `home/config.json`（`features.loop_guard=false`）并经
  `/api/state` 回读、区间记忆跨 reload 生效（`days=1` 实请求）且非法种子 `__probe__` 回退 7 不崩、
  桌宠节点（`pet`/`petEyeL`…）在场、控制台零报错。
- **口径不对称的一处如实标注（本地比上游多写一层）**：「平均速度」列落在今日/7日/30日的用量表里，
  数据却只来自 `stats` 引擎的**今日**快照（ledger 无速度字段，R43 已定「不为此去改另一侧」）。
  上游 vanilla 的 tooltip 没提这件事，选 30 日时读者会当成整段均值。本地在表头 title 与单元格
  title 里都写明「今日」，措辞改的是口径披露、不是数字来源，**不改上游语义**，下次融合可保留。
- **顺手查出的一处上游文案自相矛盾**：上游 `index.html` 的 Cline 实测表提示写「上下文取实测通过值**向下**取档」，
  与其自己的 R46 裁定「按用户裁定**向上**取一档」（mimo 728K→报 1M、solar 400K→报 512K）相反。
  本地弹层按 R46 写，并注明实测值本身是 90s 响应头超时压制下的下界。

### L13 2026-10-13 oczen 免费档失效：上游未修，本仓先修（一条新的本地偏离）

- **现象与归因**：12:36:54 起 `oczen/*` 对话恒 403 `FreeTierError`，而 `GET /models` 全程 200
  ⇒ 面板 badge / 模型清单 / 费率照刷，只有真发消息才挂，R34 家族的「看着像活着」形态。
  真因是上游 **2026-10-11** commit `83f2b6f67a`（`make Zen routes a thin inference proxy` #54563）
  把免费档校验从「查会话头形状」升级为「查形状 **+ 查位不变量**」。
  **四个被实测否掉的假设值得记住**：不是我们改坏的（`internal/oczen/` 与上游 master 逐字节 `cmp` 全 IDENTICAL）、
  不是融合或重启带来的（403 早于当天 17:38 的重启）、不是 OpenCode 升 v2（v2.0.0 是 09-11 的 tag，
  六种 UA 版本结果完全相同，v2.0.28 反而比封锁晚 3h40m）、**不是调用量超额**
  （`usage-*.jsonl` 逐日请求数：最高量的 10-10 有 736 次且零 403，出 403 的 10-13 只有 9 次成功）。
- **判据**：会话 id 那 12 位 hex 的低 12 位须落在 `0xFC0`–`0xFFF`，即官方
  `~(ts_ms*0x1000+counter)` 布局里 `counter ∈ 1..63`；**时间戳段本身不校验**（时间戳 0 也 200）。
  旧实现取 `sha256(seed)` 前 6 字节直出，命中窗口仅 1/4096。协议细节、实测矩阵与端点可达性
  （`/responses`、`/messages` 原生面匿名一律 403，`/systemone` 451）见 `docs/opencodezen渠道接入备忘.md`。
- **修法**（`internal/oczen/client.go`）：新增 `descendingTimePart()` 把摘要字节重排成官方 48 位布局
  （高 36 位摘要 + counter=1 → 整字取反 ⇒ 低 12 位恒 `ffe`）；`canonicalSessionID` 的透传分支
  从「形状对就返回」收紧为「**形状且位**都合法才返回」，其余一律重排。
  选确定性重排而非「铸真时钟 + 缓存」正是因为时钟段不被校验 ⇒ 保住「同一对话恒定同一 id」
  的 prompt cache 亲和，且纯函数、零新增状态。
  ⚠️ 时钟不被校验是**实测结论**（两条荒唐时间戳均 200）；若上游将来改成校验，需回退到「真时钟 + 缓存」方案。
- **为什么旧测试没拦住**（R23b 家族的第二次命中）：旧 `TestCanonicalSessionID` 断言的是形状、稳定性、
  「形状对就透传」——**三条都与门禁无关，那个测试本身就是这个 bug 的护身符，永不可能变红**。
  重写后的承重断言是位不变量，并配三条负向验证：装回旧算法 → 红；摘掉透传分支的位检查 → 红；
  判据本身用实测 200/403 的字面样本做表驱动（不用同一套位运算反算，否则测试与实现同错就永远绿）。
  另加 `internal/oczen/live_gate_test.go`（`-tags live`，默认不跑）：一条证我们的 id 真被上游接受且真的出流，
  一条**活体对照**证旧形态仍被拒 403——后者若哪天变成 200，说明上游撤了闸门，本文与备忘 §3 需重新判读。
- **上游状态**：`rockswang/wild-work` 的 oczen 最后一次改动当时是 2026-10-07，**当时未修**；
  拉上游 master 原样跑同样 403。⇒ 本仓此次是**领先上游的本地偏离**，下次融合时 `internal/oczen/client.go`
  与 `client_test.go` 会进冲突面，**判据以本地为准**（同 `ledger.go` 的处理，见 L8 取舍判据）。
  参考实现 `jasonxu114514/opencode2api`（本仓 `constants.go` 里 `AnonymousKey` 的出处符号
  `anonymousZenKey` 仅此仓库存在）**同日推了同款修复但把测试删了**（#70 加 +69 行，两分钟后整文件删除），
  全仓已无该逻辑的用例 ⇒ 算法采信它，测试用我们自己的。
  > ✅ **2026-10-14 已收敛**：上游 v2.7.2 以 **R53b**（`470717a`，issue #111 / PR #69+#70）补上了**同一个算法**
  > （`descendingTimePart`、counter 1–63、判据正则 `^[0-9a-f]{9}f[c-f][0-9a-f]$`）。本次融合按「按上游走」采纳
  > 上游 `client.go`（额外含 R62 地域改道），本地只保留上面那两条承重测试（表驱动实测样本 + 活体对照），
  > 故「本仓领先」状态**已结束**，见 L14。上一段保留为历史记录。
- **口径订正**：`constants.go` 原记「三道闸门」订正为**四道**（新增位不变量），
  且原「1900+ 次无 429」已被 10-10 的 64 次 429 推翻——429 是配额背压、403 是闸门身份，两回事。
  另实测：`User-Agent` 里的版本号不是检查项，`x-opencode-client`/`x-opencode-project` 等头
  按参考实现逐头删除实测不在校验里（本仓未逐一复验，仍齐套发送以贴近真实客户端）。
- **生产已翻新**（2026-10-13 19:29:25，所有者点头后按 L7 执行）：新进程 **PID 858590**、`SID==PID`、TTY `?`、
  `/proc/858590/exe → dist/wild-work-linux`（非 `(deleted)`）；停机窗口约 1.2s（SIGTERM 400ms 退出 + 1s 内起来）。
  L7 四项判据逐项实测通过：首页引用 `assets/index-CDU7TDuK.js`（服务端取回 683,115 B 与磁盘产物**逐字节相同**）、
  无会话 `/api/state`=401 且 `/api/auth/state`=200、189 个模型里 `oczen/` 前缀 11 个。
  **渠道真恢复**：生产上 `oczen/big-pickle` 与 `oczen/step-5-preview-free` 均 HTTP 200 并出真实内容，
  日志出现 `new sticky route platform=oczen` ⇒ 403 归零。
  记账完整性：5 个流水文件均以备份为**严格字节前缀**（append-only 未被破坏）、`credit-snapshot.json`
  账号键数 7→7；`app.log` 新增 86 行里 `403`/`error`/`Error`/`panic` 命中全 0，
  且同一谓词在全文件分别命中 178/104/1 次 ⇒ **能变红**，不是空转的绿（L7 那条踩过的坑）。
  备份目录 `/home/incam/Software/_pre-restart-20261013-1929`（当天 17:38 那次已有目录，未覆盖）。
- ⚠️ **`dist/wild-work.exe`（Windows）与 `dist/wild-work-linux` 现在是同一份修复后的源码**，
  但 exe 只验过体积与内嵌字节（新正则 `f[c-f][0-9a-f]` 命中 1 次），**从未在 Windows 上执行过**（本机是 Linux，见 L6.3 第 7 条）。

### L14 2026-10-14 融合：上游 v2.7.1 → v2.7.2（`478d271`），Cline 对外 ID 反转与闸门作用域收窄

- **形态**：沿用 L8/L11/L12（本地与上游**无共同祖先**，不能 `git merge`）=「`git checkout upstream/master -- <路径>` 整树采纳无冲突文件」
  +「`git merge-file` 三方」。上游变更面 **36 提交 / 78 文件 / +6526 −594**（29 新增、1 删除、48 修改）；
  **真冲突面 13 个文件，其中 Go 只有 4 个**（`main.go`、`app.go`、`handler.go`、`session_test.go`），
  三方合并**只剩 2 处冲突块**且都是「各写各的、双方内容都要留」（main.go 一条本地注释引用了已删的 `applyProxies`，
  按上游丢弃；handler.go 本地 `traffic/lastReq/Traffic()` 与上游 `fbMu/fallbacks/SetModelFallbacks` 并存）。
  其余 65 个文件本地一字节未动 ⇒ 整树采纳（含上游新的 `internal/backuplink`、`internal/provider/usage.go`、
  `internal/stats/fallbacks.go`、`internal/traework/schemacycle.go` 与 30 个新测试）。
- **本轮采纳**：R53b/R53（oczen 位编码 + usage 缓存形状归一化）、R54 模型降级链（+R61 启动装配）、
  R55/R56 traework 模型元数据与 `$ref` 消毒、R57 代理收敛为「全局备用上游通道」（删 `config.proxies`/`applyProxies`/
  `SetTransportProxy`/`POST /api/config/proxies`）、R58 流截断自证原因（`upstream_timeout` vs `upstream_truncated`）、
  R59 Cline 对外 ID 直通 `cline-free/*`、R60 单号渠道 402 走模型级冷却、R62 oczen 地域改道。
  不变量 1 由「三改写」变「四改写」（`$ref` 消毒）；新增不变量 24（缓存「不提供」不得画成 0%）；
  不变量 22 补 402 模型级冷却的澄清。
- **本轮新增的本地偏离（一处，经所有者裁定）**：**契约闸门不再扫 `cmd/wild-work/web/`**。
  冻结的 vanilla 基准仍引用上游已删的 `/api/config/proxies`，`TestPanelAPIRouteContract` 与
  `TestStateFieldContract` 因此各红一条——对一份**既不 embed 也不被服务**的死代码报红。
  故 `uiSourceDirs` 只留 `web-app/`（活体产物），注释写明缘由。`TestDOMIdParity` 仍以 vanilla 为「功能核对单」
  （它证明的是「没掉功能」，不是「端点还在」），但新增 `domIdIntentionallyRemoved` 豁免表（`echartsCdn` 从硬编码
  改成表项 + 新增 `proxyList`，随 R57 功能下线），并加**反向自证**：豁免条目必须真在 vanilla 里存在。
- **R59 反转了本地上轮的判据（须记住）**：L11 缺陷②/L12 把「复制给客户端的完整 ID」定为 **`cline/cline-free/*` 双层路径**；
  上游 R59 改为**直通上游命名空间 `cline-free/*`**，旧双层保留路由兼容。本地 `Fees.jsx:modelIds(ch, raw, id)`
  改成**优先用费率行的 `id`**（Go 侧 `provider.PublicModelID` 的唯一真源），缺 `id` 才回落到 R52 的补前缀 + `startsWith` 护栏；
  `render-check` 场景 5/7 的断言按 R59 双向改写（id 在场 → `cline-free/grok-4`；缺 id → `cline/cline-free/grok-4`）。
- **oczen 同源取舍的结论**（L13 的收尾）：本仓 `e7786a6` 与上游 R53b 是**同一个算法**，本仓不再领先；
  按「按上游走」采纳上游 `client.go`（多含 R62 改道），本地只保留 L13 那两条承重测试——
  `TestSessionGatePatternDiscriminates`（实测 200/403 字面样本的表驱动，防「判据与实现同错」）与
  `live_gate_test.go`（活体对照：旧形态仍被拒 403，若哪天变 200 说明上游撤了闸门）。
  两侧**重名的 `TestCanonicalSessionID` 已消重**（保留上游版），本地测试里的 `officialSessionPattern`/`gateTimePartPattern`
  两个已消失的符号改用上游的 `descendingTimePartPattern` + 测试内 `sessionShapePattern`。
- **闸门变更与负向验证（四条，均已实测变红）**：① 装回「`modelIds` 忽略 `id`」→ `render-check` 点名 `cline/cline-free/grok-4`；
  ② 给 React 产物塞一条 `/api/definitely_not_here_zzz` → 路由闸门点名该端点；③ 豁免表塞不存在的 id → 反向自证红；
  ④ 摘掉 `proxyList` 豁免 → 点名 `[proxyList]` 缺失。另**顺带实证**了产物过期闸门是活的：
  `cp` 还原把 `Fees.jsx` 的 mtime 更新后，`TestEmbeddedWebAppIsARealPanel` 立刻报「webui 源码比 web-app 产物新」。
  `uiWantsState` 的字段级负向验证本轮**天然发生**：`proxies` 被上游删掉后该闸门先报了「面板依赖的字段缺失」，
  改成 `backup_proxy`/`backup_proxy_active`/`model_fallback` 才转绿。
- **沙箱实测（`/tmp/ww-sbx` + `127.0.0.1:28763`，生产 daemon 858590 全程未动）**：`version` 回 `2.7.2`、
  `/api/state` 有 `backup_proxy`/`backup_proxy_active`/`model_fallback` 且**无 `proxies`**、
  `POST /api/config/proxy` 与 `model_fallback` 均 200、旧 `POST /api/config/proxies` 404；
  真浏览器里走完整 UI 链路——设置弹层只有**一个**代理输入（`input.proxy-input` 计数 1）且 `proxyList` 已消失、
  降级链编辑器可加规则（两个备胎 chip）并经「保存降级链」**写穿** `/tmp/ww-sbx/home/config.json`、
  非法代理（`ftp://`）被就地拦下且弹层不关、合法 `socks5://` 保存后 `backup_proxy_active=true` 且重开弹层显示「已生效」、
  重开弹层降级链 chip 仍在、运行统计 tab 的「降级记录」区块**常显**（占位行在场）、桌宠节点 6 个仍在场、控制台零报错。
  ⚠️ **本次无法做几何/截图判据**：in-app 浏览器无可见表面（`innerWidth/innerHeight = 0`、`take_screenshot` 报
  `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），故「不漂移/不重叠」这类**视觉几何**本轮**未验证**（结构性判据与功能链路均已实测）；
  这与 L6.2 第 4/5 条的教训方向一致——「渲染出来了」不等于「看得见」，别把结构判据当成几何判据。
- **口径更新（现查现写）**：面板 `/api/*` 路由 **38 → 39**（−`config/proxies`、+`config/proxy`、+`config/model_fallback`）、
  `_test.go` **119 → 142**、`go test ./...` 实测通过的包 **32 → 33**（新增 `internal/backuplink`；`go list` 42 个含无测试包）、
  render-check 场景仍 **7**、渠道仍 **13**、版本常量 **2.7.1 → 2.7.2**（同 L11/L12 先例由 `git merge-file` 带成上游值；
  本仓**未打 tag、未写 release note、未发布**，`RELEASES.md` 里的 v2.7.2 段落是上游写的，本轮 append 采纳）。
- **验收**：`go build ./... && go vet ./... && go test ./...` 全绿（33 包 0 FAIL）；`npm run build` + `npm run check` 全绿；
  `dist/wild-work.exe` 已重建（15,275,520 B；内嵌 `backup_proxy`×10 / `model_fallback`×5 / `X-Model-Fallback`×2 /
  `upstream_truncated`×3 / `backuplink`×77，版本串 `2.7.2`×1 且 `2.7.1`×0）。
  桌宠与视觉层零改动（`git status` 对 `pet.js`/`pet.css`/`public/pet`/`anim.css`/`tokens.css`/`style.css` 既有规则为**空**）。
- ⚠️ **待办**：`dist/wild-work-linux` **未重建**——它正被生产 daemon 858590 执行（直接编译会 ETXTBSY），
  且本轮也**未重启生产**（L7 流程需所有者点头，监听局域网地址会瞬断其他设备的客户端）。
  即：**生产仍在跑 v2.7.1 的二进制**，本轮全部改动只在源码、沙箱与 `dist/wild-work.exe` 中生效。
- 本轮计划文件：`docs/上游v2.7.2融合计划.md`（本地工作稿，未入库；**结论以本节为准**）。

### L15 2026-10-15 融合：上游 v2.7.2 → v2.7.3（`5b63d503`），并**本仓先修** OpenCodeZen 免费档的第三次闸门变更

- **形态**：沿用 L8/L11/L12/L14（本地与上游**无共同祖先**，不能 `git merge`）=「`git checkout upstream/master -- <路径>` 整树采纳无冲突文件」
  +「`git merge-file` 三方」。上游变更面 **17 提交 / 36 文件**（12 新增、24 修改）；
  逐文件与基线 `478d271` 比对分类：**26 个本地一字节未动 ⇒ 整树采纳**（含全部 12 个新文件），
  **10 个本地已改** ⇒ 走分类处理。
- **本轮采纳**：R63 思考强度注入、R64 面板探针与真实请求同源（`backuplink.Replay.Note` + `TestKey` 加 `viaBackup`）、
  R65 小浣熊 `setting_info` 签到、R66 自定义 OpenAI 兼容渠道（`internal/custom` + `runtimesMu`/`runtimesSnapshot` +
  `channelList` 共享渠道清单 + 密钥脱敏回环），以及降级链行内主模型可编辑、长模型 ID 溢出、设置弹层悬空引用三条修复。
- **三方合并只有 app.go 有冲突（6 处，同一形态）**：本地 `ownAccounts(rt)` vs 上游内联 `rt != nil && rt.Pool != nil && !rt.Alias`。
  **本轮必须采纳上游的 `runtimesSnapshot()` 迭代**（R66 引入 `a.runtimes` 的 post-init 写，9 处读点不加锁会
  `fatal error: concurrent map read and map write`），同时**保留本地 `ownAccounts` 谓词**（语义相同、形态不同，L12 已记）。
  `main.go` / `handler.go` / `oczen/client.go` 三方零冲突。
- **有意不采纳（沿用 L11/L12/L14）**：`cmd/wild-work/web/`（冻结基准 + 本地视觉层）、`scripts/ui-static-check.mjs`（孤儿脚本，
  驱动冻结 vanilla）。`README.md` 以本地为准。`RELEASES.md` / `config.example.json` 本地未动 ⇒ 整份采纳（纯 append）。

#### L15.1 OpenCodeZen 免费档的第三次闸门变更——**上游未修，本仓先修**（同 L13 的地位）

- **现场**：生产日志 `10-15 10:09` 起 `oczen/*` 对话恒 `403 FreeTierError`（末次成功 `10-14 17:02`），
  而 `/zen/v1/models` **全程 200 / 86 条** ⇒ 面板 badge、模型清单、费率一路正常，**只有真发消息才挂**（R34 家族形态）。
  单账号分支的旧日志写死「不罚账号」且**不带 body**，日志里看不出 403 的原因（这正是 R64 补 `body=` 要解决的）。
- **判据（2026-10-15 直连 opencode.ai 单变量实测，每项重复 3–8 次、结果稳定）**：

  | 要素 | 旧 wire（本仓 10-15 前 / 上游 master 至今） | 现状要求 |
  |---|---|---|
  | 对话端点 | `/zen/v1/chat/completions` | **`/inference/v1/chat/completions`**（/zen 即便其余全对也 403） |
  | 亲和头 | 发 `x-session-affinity` + `X-Session-Id` | **必须不发**（带了即 403；与 2026-09 的实测相反） |
  | 回合头 | `randomID("req",16)` = `req_`+32hex | **铸造 `msg_<12位小写hex><14位Base62>`** |
  | UA | `opencode/1.18.31 (windows amd64; node22)` | 不变即可（须含 `opencode/<version>` 记号；`dsh/1.0` 实测 403） |
  | 会话段 | R53b 的 descending 铸造 | 不变（随机 hex 仍 403；counter 1–40 实测均接受） |
  | tools | `bash`/`read` 各带 property | 不变（空 `properties` 与「只声明 bash」实测 403） |

- **修法**：`constants.go` 的 `DefaultBase` → `/inference/v1`（模型目录两个前缀都仍 200，故统一走后者）；
  `headered()` 删两个亲和头、补 `x-opencode-session-id`（同会话值）、`x-opencode-request` 改 `mintRequestID()`、
  `x-opencode-project` 改常量 `global`。**判据与实测表写进 `constants.go` 的包注释**（原「三道校验」订正为五道）。
- **为什么旧测试没拦住（R23b 家族第三次命中）**：既有 `TestChatStreamRequestShape` 断言的正是**旧 wire**
  （它要求 `x-session-affinity`/`X-Session-Id` 在场、要求 `x-opencode-request` 以 `req_` 开头）——
  **它是旧实现的护身符，闸门一变只会让它更绿**。新判据落在 `internal/oczen/gate_test.go`：一条测试锁一件事
  （基址 / 禁发的头 / 铸造回合 id / 工具指纹 / 会话字面样本表 / 端到端 wire），
  **期望值一律字面量**（用被测函数反算 = 测试与实现同错，永绿）。
- **负向验证（均已实测变红）**：① 装回 `DefaultBase=/zen/v1` → `TestDefaultBaseIsInferencePath` 红；
  ② 装回两个亲和头 → `TestHeaderedDropsAffinityHeaders` + `TestChatStreamSendsGateCleanWire` 红并逐条点名。
  另加实盘对照 `live_gate_test.go:TestLiveGateStillRejectsLegacyWire`（旧 wire 必须仍被 403；变绿即上游撤了收紧，需重判）。
- **口径订正**：`constants.go` 的「三道闸门」→ **五道**；`DEVELOPMENT.md` 的 oczen 端点表与闸门清单同步改写
  （旧表还写着 `/zen/v1` 与亲和头）。`internal/devdump` 的 URL 夹具同步换到 `/inference/v1`。
- **参考实现只到 10-14 那一版**：`yetone/magpie`、`Ebony-Vinyl/dsh-our-free-model` 都记了 `/inference/v1` + 工具指纹，
  但**都还没记 10-15 的「禁亲和头 + 铸造回合 id + UA 记号」** ⇒ 照抄它们仍会 403（本节的表是当日现测）。
  上游 master（`5b63d503`）的 `internal/oczen/` 与本仓修复前**逐字同构**，故这是又一次「本仓领先上游」的本地偏离，
  下次融合 `internal/oczen/client.go` 与 `constants.go` 会进冲突面，**判据以本地为准**（同 `ledger.go`、L13 的处置）。

#### L15.2 React 侧移植（只补功能，桌宠与视觉层零改动）

- `Settings.jsx`：新增**思考强度**（全局默认行 + 模型档位映射列表 + `datalist` 建议集）与
  **自定义渠道**（渠道卡片：标识/地址/脱敏密钥/启停/删除 + 模型表：上下文/最大输出/思考档位/能力 + 单行添加行）
  两区；降级链行内主模型改可编辑输入框（非受控 + `key=r.from`，**校验失败必须手动把 `el.value` 拨回旧值**）；
  oczen「测试」toast 标明**直连 / 经备用通道**，403 且走直连时给可行动提示。
- `constants.js`：`NO_EXPLICIT_CHECKIN` 移除 `raccoon`（签到已接入，开放手动按钮）；
  `chLabel`/`chClass` 的兜底从「未知即 WorkBuddy」改为「渠道名本身 + `custom`」——
  旧兜底会让自定义渠道顶着 **WorkBuddyCN 的徽章与配色**出现。新增 `RESERVED_CHANNEL_NAMES`（与 `provider.BuiltinKinds()` 同集）。
- `format.js`：`parseTokens`（k/M 单位，与后端 custom 包同源）与 `formatTokenCount`。
- `channelColors.js`：未登记渠道回落 **`--custom`**（原先回落 `--accent`，与主色混在一起）；
  `tokens.css` 三主题各补一值（`#6366f1` / `#818cf8` / `#5b60b8`，oklch 由 `tools/derive-tokens.mjs` 现算），
  `style.css` 追加 `.badge.custom` / `.btn.primary.alt.custom` / `.cs-chip.custom.active` / `.fees .ch-header.custom`
  与自定义渠道卡片、`fb-from-col`、`eff-model` 等新规则（**只追加，不改既有规则**）。
- **闸门**：`render-check.mjs` 场景 **7 → 8**，场景 3 的控件清单加 13 个新 id；场景 8 断言
  脱敏密钥不进 HTML、k/M 格式化（`1M`/`64k`）、`supports_tools` 缺省=支持且显式 `false` 不标、档位列表。
  `web_field_contract_test.go` 的 `uiWantsState` 补 `reasoning_efforts` / `custom_channels`
  （Go 漏发时面板读出空对象、编辑区画成「未配置」——静默的错，正是该闸门要拦的形态）。
- **负向验证（已实测变红，且闸门当场抓出一个真实缺陷）**：把 `api_key` 放回 `title` 属性 →
  场景 8 报「明文进了面板 HTML」；把容量直接 `String(n)` → 报「应格式化为 1M」。
  ⚠️ **那条 `title` 是照抄上游 vanilla 的写法**（`title="${esc(c.api_key)}"`）——**上游把完整密钥写进了 DOM 属性**；
  本地按「面板只应拿到脱敏值」的既有口径**不放 title**。这是本轮唯一一处「上游写法不安全、本地刻意不照抄」。

#### L15.3 口径更新（现查现写）

- 面板 `/api/*` 路由 **39 → 42**（+`config/reasoning_efforts`、+`config/custom_channels`、+`config/custom_channel_test`），
  前端引用 41 条、白名单 2 条；`/api/state` 面板依赖字段 **41 个路径**（+2）。
- `_test.go` **142 → 152**；`go test ./...` 实测通过的包 **33 → 34**（新增 `internal/custom`）；渲染闸门场景 **7 → 8**。
- 版本常量 **2.7.1 → 2.7.3**（同 L11/L12/L14 先例，由 `git merge-file` 带成上游值；
  本仓**未打 tag、未写 release note、未发布**，`RELEASES.md` 里的 v2.7.3 段落是上游写的，本轮纯 append 采纳）。
- 渠道数仍 **13**（自定义渠道是面板配置项，不占 `provider.Kind` 常量位）。

### L16 2026-10-19 摘取上游 v2.8.1/v2.9.1 四项必要修复 + 国际版 R77/R79（不含新渠道）

- **范围裁定（所有者）**：只修已有渠道/引擎，**不新增渠道**；小浣熊迁站、Loomy/MonkeyCode 签到、
  第二梯队其余项均不做。上游 v2.9.1 的 7 个新渠道（OfficeAce/Kilo/MiniMax/LobsterAI/ZCode/Gemini/CodeArts）
  与面板改版 R81–R93 一律不移植。
- **① issue #157**：`pool.RecordCheckin` 的 `if e, ok := ...` 遮蔽同名参数，`lastCheckinOK` 恒 true
  （面板对失败签到也显示「签到成功」）。改名 `found`；承重测试 `TestRecordCheckinFailureNotMasked`。
- **② 请求级错误不罚号**：`ErrClient` 单独 case（仅轮转、不 `NoteError`）；
  `ErrImageInvalid`/`ErrBadParams` 加入 `ErrContentBlocked/ErrPromptTooLong/ErrPassthrough` 透明透传分支。
  承重测试 `internal/server/request_error_penalty_test.go`。
- **③ WorkBuddyAI 14018**：429 分支内识别 `"code":14018`（下一字符须非数字，防 `140180` 误伤）与复数
  `credits exhausted` → `ErrHardCredit`；否则误判软限流只冷 60s，降级链永不触发。测试并入 `TestClassify`。
- **④ 自定义渠道退出积分体系**：`RefreshAll` 跳过 `rt.Custom`；`RefreshCredits`/`ResourceDetail` 明确报
  「不适用」。React 按后端 `credits_na` 动态隐藏签到/刷新积分入口、积分明细 hover 与汇总条，
  保留停用/删除；显示名不可编辑（无凭证文件）。`render-check` 场景 2b 用「按卡片切块」断言，
  普通渠道入口不得误伤。
- **⑤ R77 WorkBuddyAI 429 显式可重试**：`retryDecision` 识别 `retry_policy.retry=true` 或 `actions`
  含 `RETRY`（14003 瞬时拥塞），用独立 `rateLimitMaxAttempts=2` 预算重试一次（20s 退避），
  不与 5xx 的 3 次额度混用。避免上游说「可重试」时直接罚号，把可自愈抖动放大成
  `503 no_healthy_account`。测试 `retry_policy_test.go`。
- **⑥ R79 WorkBuddyAI 目录/费率类型化错误**：`fetchCatalog`/`fetchV3Catalog` 非 200 返回
  `*provider.Error{Kind: Classify(...)}`，让 `RefreshPricing` 的 `refreshIfSessionDead` 能用
  `errors.As` 取到分类，401 时 refresh + 重试（不变量 19）。测试 `typederror_test.go`。
  ⚠️ 上游 R79 还改了共享 `internal/upstream/client.go`（裸 401→SessionDead、14018），
  影响 WorkBuddy CN 等渠道；**本轮未采纳**，只做 WBAI 面。
- **负向验证（均实测变红）**：装回 `ok` 遮蔽 → 签到恒真；摘掉 handler 两个 case → `errCount=1`；
  摘掉 14018 分支 → `soft_rate`；摘掉自定义渠道 guard → `failed=1` / `remain=500`；
  `noCredits` 退回静态名单 → 场景 2b 点名「仍显示刷新积分」；
  `retryDecision` 的 429 分支返回 false → 重试用例 429；类型化错误退回裸 `fmt.Errorf` →
  `TestCatalogReturnTypedError` 点名 `*errors.errorString`。
- **仍需保留的本地偏离**：`ledger` 的 `prevMonthCutoff`/`monthSegments`（上游 v2.9.1 仍未修）、
  oczen 五道闸门判据（与上游 R69 相反，以本地实测为准）。
- **验证**：`go build ./... && go vet ./... && go test ./...` 全绿（34 包 0 FAIL，需 Node 22 PATH 供前端闸门）；
  `npm run build` + `npm run check` 9 场景绿；`dist/wild-work.exe` 已重建（15,415,296 B，
  `"code":14018`×1 / `credits exhausted`×1 / `retry_policy.retry`×1 / `models api:`×3 / 自定义渠道文案×1）；
  版本常量仍 **2.7.3**（未 bump、未发版）。

### L17 2026-10-20 按需摘取上游 v2.8.2–v2.9.3 五项（仍不做全量融合）

- **范围裁定（所有者）**：只做与在用渠道（workbuddy / workbuddyai / traework / qodercn）
  相关的稳定性修复；**不做**新渠道（上游 14→20）、面板改版 R81–R104、glm IDE 指纹与生图（R106）、
  hostguard（生产已设管理密码，不适用）、mac 自启、body_log、Token 单位面板。
  `session_dead` 标记与「请求内降级重入」改动面大（跨 pool/handler/面板、handler 重构），本轮不动。
- **① 5xx 默认不罚号（上游 v2.9.2）**：`server.Runtime.NoCooldownOnServerError` 改为
  `CountServerErrorAsAccountFault`（默认 false = 不计数，5xx 仍可轮转）。动机：一次上游 500 风暴
  会让单个请求轮转 3 个健康账号各 +1，`err_threshold=3` ⇒ 重试一次即整池冷却、整条渠道 503。
  回归 `internal/server/upstream_fault_no_account_penalty_test.go`（默认不冷 + 逃生门仍有效）。
  R66 里写的 `NoCooldownOnServerError` 是历史记录，字段本身已不存在。
- **② 共享 client 类型化错误（R79 全量）**：`internal/upstream/client.go` 的 models/pricing
  HTTP ≥400 改返回 `*Error{Kind: Classify(...)}`。此前只有 WBAI 面做了（L16 ⑥），共享 client 仍是
  裸 `fmt.Errorf` ⇒ `RefreshPricing` 的 `errors.As` 取不到分类，**WorkBuddy CN 的目录/费率 401 自愈
  永远不触发**。回归 `internal/upstream/typederror_test.go`。
- **③ Qoder 双区签到窗口（R95）**：`qodercn` / `qodercom` 的 `checkin.go` **整文件采纳上游**
  （claimStatus 双形态容错 + `startAt/endAt` 过滤 + benefit 金额上报 + 诊断文案），
  修复「窗口外残留 CLAIMED 被读成今日已领 ⇒ 当天漏领」与「未开始活动被直接 POST ⇒ 假失败」。
  新增 `checkin_alignment_test.go` / `checkin_window_test.go` / `checkin_variant_test.go`（均上游同源）。
- **④ WorkBuddy CN 签到只读探测（#147）**：新增 `internal/upstream/checkin_activity.go`
  （实现 `provider.CheckinReporter`）：先查 `checkin-activity-status`，已签**零写请求**，
  活动未开归 `no_campaign`，探测失败降级回直接领取。**配套**：`scheduler.dailyCheckin` 的
  reporter 路径补权威入账（`report.Amount → RecordCheckinEarn`），否则 #67 的「签到成功但今日收入 0」
  会在 reporter 路径重现。回归 `checkin_activity_test.go`、`scheduler/checkin_reporter_earn_test.go`。
- **⑤ ledger 整包到期归因（R101）**：`credit.go` 增 `itemSnap.Total` + 快照保留键 `@ch`
  （渠道级「分别上报 total/used」事实，永久共享）+ `poolShrankExpiry` 三门槛
  （无到期日 / 渠道分别记账 / total 确实下降）。修复 QoderCN 整包到期被记成「今日消耗」。
  **刻意不动 `expired()`**：本仓 ledger 仍 local-first，R105 的自然日/RFC3339 口径未采纳；
  `prevMonthCutoff`/`monthSegments` 两个上游至今未修的月末缺陷继续保留（见 L4/L8）。
  回归 `internal/ledger/credit_poolshrink_test.go`（7 例，含老快照兼容与渠道级标记）。
- **负向验证（均实测变红）**：5xx 分支恒计数 → 账号被冷却；类型化错误退回裸 `fmt.Errorf` →
  点名 `*errors.errorString`；`campaignWindow` 恒 active → 未开始活动被 POST、边界用例红；
  已签到分支短路 → 发写请求；reporter 入账短路 → earn 缺 100；`poolShrankExpiry` 摘除/恒 true →
  整包到期记 spend、真实消耗渠道被误记 expire。
- **有意不采纳并留档**：v2.9.2 的 `loginFlows` 收表**自带回归**（登录发起 2 秒静默死亡，
  v2.9.3 #168 才修）⇒ 不要单独摘中间态；`ErrModelBlocked` 改模型级冷却、
  R105 到期口径、R100–R104 面板改动均未做。
- **附带修（测试面，非功能）**：`internal/stats/persist_test.go` 两处 fixture 写死
  `"2026-09-20"`，自 **2026-10-20** 起滑出 30 日窗口 ⇒ `go test ./...` 必红（上游 master 同款
  日期炸弹，与 L11 的 PR #88 同族）。改为相对日期（昨天），断言语义不变。
- **验证**：`go build ./... && go vet ./... && go test ./...` 全绿（34 包 0 FAIL）；
  `npm run check` 9 场景绿；`dist/wild-work.exe` 已重建（15,459,328 B，
  `checkin-activity-status`×2 / `CountServerErrorAsAccountFault`×1 / `该账号无积分领取活动资格`×1 /
  `poolShrankExpiry`×1，`NoCooldownOnServerError`×0，版本仍 **2.7.3**）。
  生产 daemon 未重启、未重建 `dist/wild-work-linux`（运行中会 ETXTBSY）。

### L18 2026-10-20 对齐上游 v2.8.2–v2.9.3 的其余行为（不做 P3 新渠道、不做 macOS 自启）

- **范围**：在 L17 五项之上，把「与在用渠道/面板有关」的剩余差异全部对齐；**不做**新渠道（P3）、
  macOS 自启、以及本仓刻意保留的三处设计（oczen 五道闸门、ledger 月末修复、React 面板结构）。
  `internal/oczen/**` 与桌宠文件（`pet.js`/`pet.css`/`public/pet/**`/`anim.css`）本轮**零改动**。
- **后端**：
  1. 共享 `Classify` 补「所有 401→SessionDead」与 429 内 `14018`（复数 `Credits exhausted`）；
     `ErrModelBlocked` 改为只冻（账号×模型）。
  2. `session_dead` 标记替代永久 `Disable`：pool 字段/持久化/挑号跳过/粘性路由跳过/
     `MarkSessionDead`/`ClearSessionDead`/签到失败识别/重登后按 auth 文件 mtime 自动清除；
     `AccountView` 增加 `session_dead*`。
  3. 请求内降级重入（`fallbackWorthy = ErrHardCredit || ErrSoftRate`，只跨渠道、封顶一次）；
     成功换号复位 `statRow.Status`；降级记账改为**实际执行模型**（§6 默认项）。
  4. R73：402 硬冷却截到 `cooldown.daily_grant_at`（默认 `00:00`）+ `daily_grant_buffer`（`30m`）。
  5. R105：`provider.ExpireInstant/ExpireDate/ExpireIn/ExpireBucketOf/ExpireWithinDays/
     ExpiringWithinDays`；ledger 与 stats 改为按精确时刻/自然日分桶（逐条目，非「最早日」）；
     WorkBuddy CN/WBAI/TraeWork/QwenWork 的 `ExpireAt` 改 RFC3339，ledger 伪键仍取日期前缀。
  6. `data:` 无空格 SSE 容错（`sseDataPayload`，Aggregate 与 streamCore 共用）。
  7. `checkinOne` 长会话守卫（无 refresh 但 access 非空不再短路）+ `sessionDeadSeen` 终态收口；
     Loomy 宠物打工签到、MonkeyCode 钱包签到（Cap.js PoW，新增 `captcha.go`）。
  8. TraeWork 人工回调（`SubmitCallbackURL` + `CallbackPort` 端口自检）、`POST /api/login/callback`。
  9. R67 小浣熊迁站：入口 `/login?product_code=work…`、Cookie `xhx_token`、`raccoon.JWTUID` 单点。
  10. traework 排队心跳观测（`queue_begin`/`request_wait_in_queue`，首条 + 30s 限频）。
  11. DNS rebinding `hostGuard`（未设密码时只认环回 Host）、`body_log` 请求体摘要
      （`ledger/bodytrace.go`，默认关）、`ResourceItem.Unit`/`credits_unit`（token 计量不进积分口径）、
      devdump tee 流式落盘。
  12. glm R106：IDE 指纹迁移、一来一回对话语义（拒 assistant/多 user）、
      `/v1/images/generations|edits`（新增 `internal/imgutil`，依赖 `golang.org/x/image`）。
- **React（只改 webui/src，产物 web-app）**：设置内「查询模型」两处 + 结果全量滚动；
  顶栏 API-Key 中间省略（`data-key` 保留完整值）；自定义渠道保存自动收录未提交输入行；
  `body_log` 开关；平台表「今日作废」列；NA 卡片默认收起（原位开关 + localStorage）；
  折线 0→null；24h 时间；`session_dead` 徽标 + ⟳ 重登；冷却时刻（`until_ts`）；
  TraeWork 粘贴回调输入行；Token 计数标签；最近临期精确时刻/剩余小时/紧迫度配色；
  降级链备胎 chip 支持拖拽改序。**保留** hover 明细与既有面板结构。
- **已知未做（如实披露）**：登录编排 `loginFlows` 收表（其唯一功能收益是新增渠道的实现收敛，
  P3 已裁掉；单独摘 v2.9.2 中间态会带入 #168 回归）；fallback/effort 输入框未做上游同款
  combobox 模糊下拉（模型查找入口 + 拖拽改序已补）；token 计量渠道只在账号卡标注，未单开统计面板。
- **验证**：`go build/vet/test ./...` 全绿（新增 app/provider/stats/ledger/pool/scheduler/server/
  login_trae/login_raccoon/loomy/monkeycode/glm/imgutil 回归）；`npm run build` + `npm run check`
  9 场景绿；`scripts` 无改动。`dist/wild-work.exe` 已重建；版本仍 **2.7.3**（未 bump、未发版）。
  生产 daemon 未重启、`dist/wild-work-linux` 未重建。

### L19 2026-10-20 面板重构落地记录：shadcn/ui + LiquidGlass（R68 的实现细节；**同日整体回退，见 R69**）

- **范围**：按所有者裁定的「分阶段 / paper 保留并降级 / 行为+表面分层」执行。已完成阶段 0–5：
  基线与依赖、主题桥接与作用域 reset、外壳（顶栏/主 tab/AdminLogin/Confirm/Rename/Help/About/toast）、
  账号卡与积分明细浮层、费率/设置/登录流程弹层、设置内 Select/Switch。
  **未做**：Usage/Stats 的 KPI 卡保持既有 CSS 毛玻璃（`.ucard` 本来就带 `backdrop-filter`，
  长列表不叠加 SVG 滤镜）；未迁移 TypeScript；未改动 `cmd/wild-work/web/`（冻结基准）、
  `internal/oczen/**`、桌宠文件、三主题 token 值。
- **新增/修改的桥接文件**：`src/components/GlassSurface.jsx`（按 `paper/soft/refraction` 三态决定
  真实 LiquidGlass 或不透明表面）、`src/glass.js`（三主题 → light/dark/paper 的模式读取）、
  `src/components/ui/{button,input,label,tabs,tooltip,switch,select,dialog,glass-dialog}.jsx`
  （shadcn 源码内置，去掉 `dark:` 变体与 `var()` 不支持的 alpha 修饰符）、`src/styles/ui.css`
  （`.ww-ui` 作用域 reset、语义色桥接、`.gs-*` 表面、paper 去玻璃）。`vite.config.js` 的 alias 是
  `@xiaojiaenen/liquid-glass` 能工作的前提（见 R68）。
- **两个实测踩到的坑（已修，别再犯）**：
  ① `@tailwind base` 被删掉后 `-translate-x-1/2` 的 `transform` 非法（`--tw-rotate` 等默认值缺失），
  弹层位置从居中变成「左上角在屏幕中心」；
  ② 主题切换事件必须在写 `data-theme` **之后**派发，否则 GlassSurface 读到旧值，
  出现「弹层已 paper、顶栏仍玻璃」。`useGlassMode` 另加 `setTimeout(sync,0)` 兜底。
- **闸门变化**：`render-check` 改用真实 vite 配置并补 Radix SSR 桩；`check-props` 修掉默认值解析
  与 rest 透传；`TestDOMIdParity` 要求的 5 个 overlay id 改为 `GlassDialog id="..."`（不再用
  `overlayId` 自定义 prop，否则静态扫描认不出）。`Settings` 可见控件数 48 → 55（Radix Select/Switch
  的内部元素），属预期变化，不是功能新增。
- **验证**：`npm run build` + `npm run check` 9 场景全绿；`go build/vet/test ./...` 全绿；
  headless CDP 实测顶栏 `backdrop-filter: url("#lg-…")`、滤镜 SVG 尺寸与位移贴图均已生成；
  60 卡压力测试 60 套滤镜、JS 堆 38 MB、DCL 123 ms / load 208 ms（合成 state，非生产上游）。
- **2026-10-20 17:29 整体回退**：所有者反馈液态玻璃不如原面板，已按 R69 移除 liquid-glass + shadcn/Radix
  并恢复到重构前源码（保留 R67 显示名）。生产再次重启（PID 2930565），资源回到 `index-Cq5h8w_w.js`。
  本节以下内容只作为那次实验的记录，**不要再当作当前实现**。
- **生产已部署（2026-10-20 17:21:30）**：按 L7 流程备份 → `systemctl --user stop wild-work.service`
  → 重建 `dist/wild-work-linux`（19,153,820 B）→ start。新进程 **PID 2883219**，
  `/proc/exe` 指向活路径；首页引用 `assets/index-DJ5JCj9-.js`，服务端取回的 bundle 与磁盘产物
  **sha256 完全一致**（872,021 B）；`/api/state` = 401、`/api/auth/state` = 200、
  `/v1/models` = 193 个模型；浏览器 DOM 冒烟确认登录弹层（Radix Dialog + 玻璃表面）、
  `adminLoginPass` / `btnAdminLogin` 与顶栏 `liquid-glass` 均在场，控制台仅有桌宠/状态轮询的
  预期 401（L2 设计行为）。重启后新增 app.log 6,223 B 内 `panic|fatal|error` 命中 0
  （同一谓词全文件命中 221，证明判据能变红）；6 个 JSONL 流水均为备份的严格前缀，
  `credit-snapshot.json` 键集 10→10（6 条因启动自动刷新而变化，属预期），`config.json` 逐字节相同。
  备份目录 `/home/incam/Software/_pre-restart-20261020-172124`。
  `dist/wild-work.exe` 已重建（16,614,912 B）。

### L20 2026-10-21 对齐上游 v2.9.4（按需摘取，不做新渠道）

- **范围（所有者裁定「以上全修复」）**：只补在用渠道/网关/面板的稳定性与协议差异，**
  不做**上游 14→20 的新渠道（officeace/kilo/minimax/lobsterai/gemini/codearts/zcode），
  也不做 macOS 自启。`internal/oczen/**` 的免费档闸门判据仍以本地为准（L15.1）。
- **R115 出站脱敏补 DSH 身份句**：`internal/sanitize` 与 `internal/upstream` 两份表各加一条
  `You are an AI agent powered by DeepSeek Harness` → 插入冠词 `the`。上游按 system 开头逐字
  前缀匹配即回 11128，插一个虚词即绕过（实测 200）。**这正是 10-21 生产两条 11128 的最可能元凶**
  （请求来自 /v1/responses 的 deepseek 系客户端）。
- **R113 工具结果图片走 vision**：`internal/gateway/util.go` 新增 `toolContentValue`/`imagePartURL`，
  `/v1/responses` 的 `function_call_output`、`role:tool` 与 Anthropic `tool_result` 三处统一。
  旧实现把 1.6MB 截图 base64 当文本 ⇒ 约 146 万 token ⇒ `prompt is too long`。
- **R114 请求体 128MiB + 图片降采样**：`server.MaxRequestBody` 由常量改变量（默认 128MiB）、
  新增 `server.IsBodyTooLarge`、`config.server.max_request_body_mb`（8~1024 钳制）、
  `gateway.maxInnerBody` 改函数（避免包初始化快照）、新增 `internal/gateway/imageslim.go`
  （data URL 长边 ≤1568、不透明转 JPEG q85、带 alpha 保 PNG、sha256 缓存 256 条）。
- **R108 Qoder 三区信封错误**：qoder/qodercn/qodercom 的 `sse.go` 整文件采纳上游——信封
  `statusCodeValue>=400` 立即返回 `*sseError`（实现 StreamErrorClassifier）、零字节排队帧识别、
  110/112 归账号级额度耗尽、`RESOURCE_LIMIT` 归软限流；新增 `provider.Queued` / `Classified`
  / `AsClassified` / `ErrQueued`。handler 补排队路径：**一字节未写时可换号**（冷却「号×模型」）、
  出口 `model_queued` 错误体、全号排队 `Retry-After: 30`。三份 `stream_nested_error_test.go` 采纳。
- **thinking_config 档位**：qodercn/qodercom 解析 `thinking_config.enabled.efforts` →
  `ReasoningEfforts`/`DefaultReasoningEffort`（低→高排序），body 写 `parameters.reasoning_effort`，
  `none` 档同时 `max_thinking_tokens=0` + `is_reasoning=false`。（qoder 包本就有该透传，上游未改。）
- **R107 小浣熊逐笔到期**：`UserResourceDetail` 额外拉 `points/v1/bills`，把聚合「每日额度」
  按到期升序先进先出拆成逐笔条目（同 Name、不设 Key，ledger 聚合仍同键），余额之和恒等于
  `daily_points`；bills 失败降级为无到期口径。修复「到期清零被记成今日消耗」与到期三列恒「—」。
- **oczen 出口 IP 封禁**：`regionBlockedMarkers` 增 `abusive traffic` / `available from your current
  network`，并显式排除 `can only be used from within OpenCode`（与 IP 无关，换出口无效）。
- **R110 custom 超时**：等响应头 180s（≥ `upstream.timeout_seconds`），流中空闲仍 90s；
  `main.go` 把 `upstream.timeout_seconds` 注入自定义渠道（此前该配置对它们无效）。
- **R111 换号分层**：删除 `server.Config.MaxRotate`，尝试上限 = 渠道账号数；传输层错误统一
  **不换号、不计错、直接 502**（同 host 换号必撞同一面墙，原逻辑最长白等 6 分钟）。
- **R112 选号改最早到期**：`provider.EarliestExpire` + `ExpiringDays=1`；pool 的 `entry` 增
  `earliestExpire`（持久化 `earliest_expire` unix 秒，**不 bump stateVersion**），`entryBetter`
  改为「最早到期升序 → uid → 无到期信息按余额降序」，已过期快照回落到无到期组；
  `CooldownModel` 整号升级阈值 2→3；积分自动刷新 30min→10min。
  **删除** `config.schedule.expiring_threshold_hours`、`Config.ExpiringThreshold*`、
  `POST /api/config/expiring_days`、`/api/state` 的 `expiring_days` 与面板「临期阈值」下拉
  （`selExpiring` 进 `domIdIntentionallyRemoved` 豁免表，理由写明）。
- **LICENSE**：采纳上游 MIT 许可证。
- **验证**：`go build/vet/test ./...` 全绿（34 包 0 FAIL）；`npm run build` + `npm run check`
  10 场景绿（Settings 可见控件 48→47，少的是被删的临期阈值下拉）；`dist/wild-work.exe` 已重建
  （16,530,944 B），内嵌标记 `DeepSeek Harness`×2 / `abusive traffic`×1 / `model_queued`×1 /
  `max_request_body_mb`×2 / `earliest_expire`×1 / `RESOURCE_LIMIT`×1，`expiring_threshold_hours`×0。
- **沙箱面板实测（2026-10-21，`/tmp/ww-sbx-check` + `127.0.0.1:28764`，生产 daemon 2930565 全程未动）**：
  顺带修掉两个既有面板缺陷——
  ① **仅无积分概念账号时「展开」按钮不可达**：`btnToggleNA` 挂在 `cs-bar` 内，而该条以
  `rows.length`（有积分的渠道行）为渲染条件 ⇒ 全新安装只有 oczen 匿名时提示文案指向一个
  不存在的按钮、卡片永远看不到。改为 `rows.length || naAcc.length` 渲染，并新增 render-check
  场景 10「仅不适用账号可展开」（负向验证：装回旧条件即点名失败）。
  ② **登录后分支的两个主 tab 丢了 id**：`mtabBtnAccounts`/`mtabBtnUsage` 只在未登录外壳里写了
  `id`，登录后是动态 class 且无 id ⇒ `TestDOMIdParity` 因源码里存在而**假绿**。已补回。
  实测：页面零 console 报错、23 个 XHR 全 200；`POST /api/config/expiring_days` = **404**、
  `proxy`/`model_fallback` = 200 且 `/api/state` 无 `expiring_days`；
  `server.max_request_body_mb=8` 时 9MiB 请求体回 `413 request_too_large ... (8 MiB)`，
  恢复默认后同一请求体通过读入闸并直达上游（400 上下文超限）⇒ R114 端到端成立。
- **生产已重启（2026-10-21 14:06:49，所有者点头，systemd user 单元 `wild-work.service`）**：
  备份 `/home/incam/Software/_pre-restart-20261021-1406` → stop → 重建 `dist/wild-work-linux`
  （19,067,311 B，内嵌标记与 exe 同口径）→ start。新进程 **PID 948382**、`SID==PID`、TTY `?`、
  `/proc/948382/exe` 指向活路径（非 `(deleted)`）；首页引用 `assets/index-C026RDWs.js`
  （与磁盘产物同名）；无会话 `/api/state`=401、`/api/auth/state`=200；`/v1/models`=190 个模型 /
  6 个渠道。重启后新增 app.log 6,222 B 内 `panic|fatal|level=error| upstream |failed` 命中 0
  （同一谓词全文件分别 0/0/0/349/1850 ⇒ 能变红）；6 个流水文件均以备份为严格前缀，
  `config.json` 逐字节相同，`credit-snapshot.json` 因启动自动刷新而更新（JSON 可解析、10 个账号键）。
  **新字段已落盘**：`state-workbuddy*.json` / `state-traework.json` 出现 `earliest_expire`
  （workbuddy 两号 2026-10-22 09:00 / 09:17，workbuddyai 10-31，traework 10-26 / 11-15），
  qodercn/oczen 无该字段（渠道不下发到期，按设计垫底按余额）。**注意**：这些账号 `expiring=0`
  是新口径的正常结果——R112 起临期固定为「今日到期」，10-22 的包不再算临期；路由仍按
  最早到期优先。
- **积分明细浮窗修复（2026-10-21 15:06，用户报「数字超出面板、不对齐」）**：
  `CreditTip` 的到期解析仍按纯日期写（`split('-')`），而 L18 起 WorkBuddy/TraeWork/QwenWork
  的 `ExpireAt` 已是 **RFC3339** ⇒ 解析出 NaN（分组/排序全失效）且原文 `2026-10-22T09:00:00+08:00`
  直接渲染，配合旧的 `td:last-child{min-width:112px}` 把整表撑出 380px 浮窗。
  修法：① 新增 `expInstant()/fmtExpire()` 区分两种形态（纯日期=次日 00:00 +08；RFC3339 原样解析），
  显示压成 `MM-DD` / `MM-DD HH:MM`（完整值进 title）；② 表格改 `table-layout: fixed` + colgroup
  固定列宽、浮窗 380→440；③ 临期标签换行显示，不再被截成「临」。
  实测（沙箱合成 26 条、混合两种到期形态）：表头与各列 x 坐标**逐列相等**（64/206/258/310/366）、
  `scrollWidth==clientWidth`（438）无溢出、仅「今日到期」行判临期、标签完整在格内。
  生产 15:06 重启（PID 1276150），首页 `index-DXBSQ2Pa.js`，日志无异常。
- **未做**：版本常量仍 **2.9.3**（未 bump、未发版）。

### L21 2026-10-22 对齐上游 v2.9.5（按需摘取，仍不做新渠道）

- **范围裁定（所有者「全部修复，但排除新增渠道」）**：只修已有渠道与面板，**不做**上游 v2.9.5 的新渠道
  `internal/officeace/**`（OfficeAce，按日消耗查询）。唯一涉及已有渠道却被排除的是
  `internal/login_loomy/**`（#173 Loomy 短信登录）——本地 Loomy 是纯导入型，补它等于**新增一套登录编排**
  （非修复），如需要须单独开一轮。`scripts/ui-static-check.mjs` 照 L11 不采纳（孤儿脚本，驱动冻结 vanilla）。
- **① DSH Web GUI 脱敏（R115 续）**：`internal/sanitize` 与 `internal/upstream` 两份表各加
  `DeepSeek Harness Web GUI` → `DSH Web GUI`（上游按 system 开头**整段 221 字符逐字前缀**匹配，
  缩写为 DSH 即破坏逐字串，实测 200）。补 `sanitize_test.go` / `sanitize_parity_test.go`，
  更新 `upstream/sanitize_test.go` 的逐字节快照（8→9 项、6→7 对）。
- **② WorkBuddy 双区身份链（R116/R117）**：新增 `internal/upstream/convheaders.go` 与
  `internal/workbuddyai/convheaders.go`（两区各持一份，**不共享**）；会话头三层语义——
  `X-Conversation-ID` 会话级（首条 user 文本哈希 + uid）、`X-Conversation-Request-ID` 轮级
  （末条 user，重试/换号复用）、`X-Conversation-Message-ID` 调用级（每请求新值）；
  国内版补齐 `X-Conversation-ID`。身份串整体对齐官方桌面 5.8.3：
  UA `WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0`、`X-IDE-Version=5.8.3`、`X-Product=SaaS`、
  `X-Private-Data=true`、`X-Agent-Intent=craft`，**删除自造的 `X-Machine-ID`/`X-Session-ID`**；
  登录链 UA 同步（`internal/login/login.go`）。`Classify` 新增 `conversation id missing` → `ErrAccountFault`
  （排在 contentBlocked 之前；另一形态 `unapproved channel` 仍是内容拦截）。锚点在 `PrepareBody` **之前**
  从原始 body 抽取。
- **③ custom 可用化（R119/R121，后端 + React）**：新增 `custom/{endpoint,probe,caps}.go`
  （BaseURL 规范化：补协议/丢 query/循环剥 `/chat/completions` 尾巴；`Discover` **只发 GET**、
  有界嗅探、401/403 与 HTML 兑底页不算确认；能力只认上游显式声明）；`ModelConfig.CapSource`
  三态（api/user/unknown）+ `provider.ModelInfo.ContextFromUser`；`/api/config/custom_channel_test`
  改走 `Discover` 并回 `caps/base_url/adjusted/renormed/models_ok/chat_ok/tries/note`；
  `custom_channel_key` 按需下发单条明文（日志只记渠道名）；`maskKey` 改**长头 12 + `****` + 尾 4**
  （短 key 全遮、可见量不超原文一半），`isMaskedKey` 同时认 `****`/`…`/`••`（升级瞬间旧脱敏串不得当真值落盘）。
  费率表新增 `base_url`/`api_key_masked`/`cap_source`，`staticModelFallback` 对 custom 例外
  （其 `FetchModels` 不发网络，可安全取回）。
  **React 侧**：`Settings.jsx` 加「导入模型」（勾选 + 已存在可「更新能力」）、`cap_source` 标签、
  新增渠道自动探测、前端**不再二次脱敏**（`c.api_key` 已是后端脱敏串）；模型默认值**留空**
  （推翻旧版预填 1M/64k/全能力）；`Fees.jsx` 加接入点一行 + 点击复制 key（走新端点，明文不进 DOM），
  `hand_measured` 布尔改为 `cap_source` 四态文案。
- **④ 小浣熊等响应头上限（R118）**：`raccoon.NewWithTimeout` 统一算等响应头（≥180s，总超时仍取
  `upstream.timeout_seconds`），`main.go` 改用它；补 `raccoon/timeout_test.go`（含 180s 硬下限护栏）。
  保留本地 `catalogModel` 的 `visible`/`billing_category`/`ability_level` 字段。
- **⑤ 面板签到时间**：`Settings.jsx` 点「＋」不再直接塞当前时刻，改为就地 `input[type=time]` + 确定/取消
  （取消不发请求），与上游 `06c8b31` 的行为对齐（React 版实现，不改冻结的 vanilla）。
- **⑥ 只补测试（行为早已对齐）**：`qoder`/`qodercom` 的 `envelope_notice_test.go`、
  `qodercn/queue_frame_test.go`（R108 信封/排队帧）、`server/fallback_dimension_test.go`（降级记账维度）。
  四者均一次通过，说明本地行为与上游一致，只是缺负向锁。
- **保留的本地偏离（不得被下轮融合冲掉）**：`custom.ChannelConfig.Enabled`（上游 R83 已删，本地保留并
  `IsEnabled()` 供 main 装配过滤）、`ledger` 的 `prevMonthCutoff`/`monthSegments`、`oczen` 五道闸门判据、
  `app.go` 的 `Version = 2.9.3`（**未跟随上游 2.9.5**）、`ownAccounts`/`runtimesMu`、`App.closed`。
  其中 `App.closed` 是**本轮新增的本地修复**：`FeesInfo` 触发的后台 `RefreshPricing` 可能在 `Close()`
  之后写 `pricing-cache.json`（实测会让 `t.TempDir` 清理偶发 `directory not empty`），
  故 `Close` 置位、`savePricingCache` 关闭后不落盘。
- **口径更新（现查现写）**：面板 `/api/*` 路由 **42 → 44**（新增 `POST /api/config/custom_channel_key`，
  另有既有端点计数变化），前端引用 43 条 + 白名单 2 条；`_test.go` **约 208 个**；
  `go test ./...` 实测 **35 个包 ok、0 FAIL**；render-check 场景 **10 → 11**（新增费率页接入点/脱敏断言）；
  版本常量仍 **2.9.3**（未 bump、未发版）。
- **验证**：`go build ./... && go vet ./... && go test ./...` 全绿；`npm run build` + `npm run check`（11 场景）绿；
  三项负向验证均实测变红——① 摘掉 sanitize 的 Web GUI 重写 → `TestDSHFullPromptSanitizedViaMessages` 失败；
  ② `conversationID` 改为每次随机 → 会话 id 稳定性 3 条失败；③ `maskKey` 退回旧「首5…尾4」→ 长前缀用例失败。
  `dist/wild-work.exe` 已重建（见下），**未重建 `dist/wild-work-linux`、未重启生产**（运行中会 ETXTBSY，
  重启需所有者点头，走 L7 备份流程）。
- **未做/待办（如实披露）**：① WorkBuddy 双区身份链**尚未实发对话验证**（改的是真实上游请求头，
  单测只能证明形态；实发各 1 次低成本对话需所有者点头）；② 生产仍在跑 v2.9.4 时代的二进制；
  ③ 上游 `cmd/wild-work/web/**` 的签到时间选择器只在本仓 React 面板等价实现，冻结基准不动；
  ④ officeace 与 login_loomy 未采纳（见范围裁定）。
