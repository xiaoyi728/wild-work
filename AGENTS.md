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
| R10 | 新增渠道扩展方式：实现 `provider.Upstream` 接口 + auth 加载器 + 注册 Runtime | 模型前缀 `channel/<model>` 路由；已实现 WorkBuddyCN(国内) + WorkBuddyAI(国际) + TraeWork + TraeCode(与 TraeWork 共账号，function=solo_agent) + QoderCN + QoderCOM(国际) + 千问办公(qwenwork) + MonkeyCode(monkeycode，平台托管模型) + 小浣熊(raccoon) + Loomy(loomy) + 智谱清言(glm) + OpenCodeZen(oczen 匿名) + Cline(cline，官方 sk_ Key 免费池) 十三渠道；旧 Qoder（`qoder/*`，QoderWork）已从界面下线但路由保留 |
| R11 | Windows 产物在 WSL 交叉编译（`GOOS=windows CGO_ENABLED=0`，已验证可行）；macOS 产物走 GitHub Actions macos-latest（cgo 必需） | WSL 无法编 darwin cgo；CI 增加 darwin job |
| R12 | **无桌面 Linux 使用 `--no-tray` 参数** | 无参启动在无 DBus 环境托盘 panic 直接 exit 并提示；`--no-tray` 跳过托盘打印信息阻塞等待 Ctrl+C |
| R13 | **三接口兼容采用两层结构：内层 handler 不动，新增 `internal/gateway` 边缘层**，经 **in-process 调用**（`io.Pipe` + ResponseWriter 形状）复用内层 | 代码量比内联重构多 20%，但改动面小一个数量级（主链路仅 2 处调用点 + 1 个访问器），回归风险低、可脱离 pool 单测。**不得用 HTTP 自环**（`0.0.0.0` 监听不可作目标、鉴权双份、启动竞态） |
| R14 | **`Stream`/`Aggregate` 的 model 由调用方显式传入**，渠道不得用实例字段记忆「上次请求的模型名」 | 旧实现 qoder 用全局 `lastModel`，多账号并发会串号；traework 恒为空串。详见 `docs/三接口兼容改造备忘.md` §3 |
| R15 | **Responses 的 `function_call` 必须是独立 output item**（带 `call_id`），Anthropic 的 tool_use 参数必须走 `input_json_delta` | 参考实现 `tokligence-gateway` 两处写法不合规范（塞进 `message.content`、start 里一次性给完整 input），Codex/Claude Code 会解析失败 |
| R16 | **无账号渠道（oczen）不建 auth 文件、不进 `reloadAccounts`、不参与禁用/冷却惩罚** | 匿名凭证是常量 `public`；`SyncToDir` 会剔除磁盘上不存在的虚拟账号，故只在装配时注入一次。单账号 + 不可重登 ⇒ 任何账号级惩罚都等于整渠道下线，故 4xx 一律走 `ErrPassthrough`（原文透传、不计错不冷却）。**2026-09-24 修订：429 也不再冷却**——原「429 短冷却是唯一需要的背压」经实测证伪：单账号无号可轮换，冷却后后续请求在挑号阶段被挡成 `503 no_healthy_account`，反而不如透传 429 让客户端按 `Retry-After` 自行退避；同理**传输层错误也不再累计 `errCount`**（默认 3 次网络抖动即冷却唯一账号）。两者由新增的 `server.Runtime.SingleAccount` 统一豁免（结构属性，不硬编码渠道名），启动时另调 `Pool.ClearPenalty` 自愈旧版遗留的冷却。详见 `docs/opencodezen渠道接入备忘.md` |
| R17 | **用量/积分双流水分口径统计，不强关联、不折算** | `internal/ledger` 双 JSONL（usage 按渠道×模型 / credit 按账号 earn·spend·expire）；写入仅 append 缓冲句柄（30s AutoFlush），读取仅在 UI 请求 `/api/usage` 时按月分段扫描聚合，常驻内存 ≈0。`Upstream.Stream` 返回末帧 usage（R14 同款显式传参哲学）。首见账号只记一条「存量额度」baseline，不逐条展开。**同 key 重复条目（WorkBuddy 伪键一对多）先聚合求和再差分**，每 key 每次刷新最多一条事件；升级首启将旧错误流水一次性归档为 `old-credit-*.jsonl` 并删快照重建 baseline（issue #38）。**2026-10-08 补丁（issue #67）**：WorkBuddy 签到包落在「明日到期」key 上且提前一天以 r=0 建档，「发放即消耗」场景同 key 差分 delta=0 → 当日 earn 被抵消为 0（面板今日收入恒 0）。两层修复：① 差分补丁——快照增加 `used` 字段，delta=0 且 used 上涨时按 `发放额=usedDelta` 补记 earn（数学依据 remain=total-used；used 恒 0 的渠道零影响）；② 权威入账——新增 `provider.CheckinGranter` 可选接口（对齐 CheckinReporter 模式），WorkBuddy 实现 `DailyCheckinGrant`，调度器以它为唯一签到执行路径并用回执 `credit/today_credit` 直接记 earn（回执缺失/为 0 静默降级回差分）。详见 `docs/用量积分流水记账备忘.md` |
| R18 | **临期阈值可配（默认 24h，下限 24h）** | `config.schedule.expiring_threshold_hours`，normalize 钳下限（日期粒度到期判定低于一天无意义）；scheduler 与 app.creditTotals 同源取 `cfg.ExpiringThresholdDur` |
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
| R46 | **Cline 渠道（`cline/*`）= 多账号官方 API Key 池 + 免费模型调度器**（2026-10-10） | 凭据是**官方文档化的 `sk_` API Key**（app.cline.bot → Settings → API Keys），**不是** cline2api 那套 WorkOS device-code OAuth：实测两者模型面等价，而 Key 不过期、**不轮换** ⇒ R26/R44 的「同凭据多处使用互踢」在本渠道不存在，且零登录编排。**必带非空 `X-CLIENT-TYPE` 头**（值随意，实测 `bogus-value` 也放行；缺失/空值 ⇒ 全部 `cline-free/*` 返回 403 `API_REQUEST_ERROR_CODE`，且**不报错不崩溃**、只表现为免费模型消失，属 R34 家族的静默失效；由 `TestChatStreamAlwaysSendsClientTypeHeader` + live 的 `TestLiveAliasNeedsClientType` 双重锁死）。模型面**不做任何本地假设**（2026-10-12 简化，用户裁定）：**绑死上游** `recommended-models` 的 `free[]` 数组**原样透传**——ID 保留 `cline-free/*` 别名不改写（不用厂商真实名：用户在 Cline 后台实测，免费入口是别名条目而真实名会扣费，但计价逐请求抽签，本渠道不承诺价格）、不做基名去重、不按 tag/后缀过滤；**删除**硬编码静态表与 `/api/v1/models` 拉取（458 条 OpenRouter 镜像对免费池定位无信息量）。本地校验集 = 暴露集 = `free[]`（构造即一致）；**冷启动放行**（目录未拉到过时不拦，否则 daemon 重启后第一批请求全被本地 404，放行的最坏结果只是让上游给权威错误）；上游抖动时用已知集兑底不掏空面板。上游**确无余额/额度端点**（`/credits` `/usage` `/billing` `/quota` `/me` 等 12 个候选实测全 404，只有 `/api-keys` 与 `/plans` 存在）⇒ `UserResource` 恒 0 且**不得返回 error**，面板积分位「不适用」（`creditsNAKind`），实际花费只来自逐请求 `usage.cost`（入 ledger）。签到/保活/定时任务**全关**（`CheckinHours`/`KeepaliveHours` = `[]int{}`，R39）+ **`go clineSch.Run(sctx)`**（R34）；`noExplicitCheckin` 含 Cline。**不承诺价格**：`free` 命名空间与 `is_byok`/`provider` 实测**都不能**当判据（同前缀有扣费、非 free 后缀反倒 cost=0，且同一 ID 相邻两笔计价会漂移）⇒ 费率表标「不适用」，一切以实测 `usage.cost` 为准。面板文案必须写明「额度按**账号**计（官方字段 `…UsageCostUSDPerUser`），同账号多把 Key 共享一份额度」，并在检测到同账号时告警（依据 `/api-keys` 返回本账号全部 Key）。 |
| R47 | **Cline 的 429 分两类：OpenRouter 侧共享上限不得软化账号**（2026-10-10，R38 同族扩展） | 上游把真实状态**压平成 HTTP 500**（`… from Openrouter: request failed with status 429 …`）⇒ `Classify` 必须正则取**内层**三位状态码，否则 429 被归成 5xx（违反不变量 15 的「429 优先」）。挖开后是两种语义相反的 429：① **共享出口上限**——`limit_rpd` / `Daily limit reached` / `temporarily rate-limited`，落在「Cline 自己的 OpenRouter key」上（路由判据：响应 `id` 前缀 `gen-` = OpenRouter，`gen_` = Cline 自有网关，实测 9 个 ID 零反例，是成功路径上**唯一可用**的聚合器标识；`is_byok`/`provider` 均已被证伪）⇒ **换 Cline 账号必然复现** ⇒ 归 `ErrPassthrough`（不计账号错、不冷却、不换号），并把该 model 记入渠道内 `capped`（期间从 `/v1/models` 摘除，TTL 1h 自愈；实测 `gemma-4-26b` 上轮 429、本轮 200，故必须可恢复）；② 无上述文案的 429 ⇒ 才是真账号级（依据 `plans` 的 `…UsageCostUSDPerUser`）⇒ `ErrSoftRate` 冷却 + 同请求换号（R29 全量适用，本渠道**不置** `SingleAccount`）。**不区分的后果**：渠道只有 3 个模型，`pool.CooldownModel` 在 ≥2 模型冷却时升级整号冷却 ⇒ 所有 Key 被逐个轮空 → `503 no_healthy_account`（正是 R16/R38 的误伤形态）。另一族必须处理的是 **HTTP 200 + 流内 `error` 帧 + 上游自己发 `[DONE]`**（`stream_initialization_failed`，实测另有数字 `502`）：R36 的「截断时不发 [DONE]」在此不适用（上游已发），需要识别 error 帧 → 返回 `StreamError`（实现 `StreamErrorClassifier`，R40）；为此在 `internal/upstream` 新增最小导出 `StreamWith`（同时带 hintFn 与 onUsage 两个钩子，既有三个导出各只带一个）。`max_tokens` 实测：8→上游 400、16→500 `empty response content`（推理吃光预算 ⇒ 可见内容为 0）、64~200000 全通、1e6→拒 ⇒ `PrepareBody` 缺省**不传**、<64 抬到 64、>200000 压到 200000；**强制 stream=true 并不能豁免这条**。 |
| R48 | **`normalizeToolTurnContent` 给 assistant 补 content 不再以 tool_calls 为前提**（2026-10-11） | **实测**：CodeBuddy 客户端在「思考中途被打断」时，会把半截思考存成 `{"role":"assistant","reasoning":"…"}`（**无 content、无 tool_calls**）；该空壳留在历史里后，traecode/SOLO 对**每一发**请求都回流内 `event:error` `4001 the param is invalid`（与「中毒进历史」同类，重启客户端也不恢复，只能新建会话）。旧实现只在 assistant **带 tool_calls** 时补空串，普通 assistant 刻意放过（注释「无证据会出问题」）⇒ 空壳原样透传。**修法**：`case "assistant", "tool"` 一律补 `content:""`，不再判 tool_calls。**重放坐实**（一份 129 条消息的完整会话，同一条畸形消息）：原样 → 0.6s 即 4001；删掉空壳或补 `content:""` → 均正常出流 ⇒ 上游接受空串，故补空串（保留历史结构）而非丢消息。回归测试 `internal/server/handler_tool_content_test.go`（含 reasoning-only 空壳用例，断言 reasoning 字段不被误删） |

## 2. 架构选型（依据）

| 主题 | 选型 | 理由 |
|------|------|------|
| GUI 壳 | **无**（删除 wails） | WebView2 内存开销大 + Windows 绑定；托盘 + 浏览器足够 |
| 托盘 | energye/systray v1.0.3（现有） | 已跨平台；菜单固定方案规避其不可删菜单项限制 |
| 管理后端 | 现有 http.Server 扩展 /api/* | 单端口、复用鉴权中间件（cookie 会话守卫）、零新服务 |
| Web UI | 纯静态 embed + fetch | 无 Node 构建链，单 exe 双击即用 |
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
POST /api/config/expiring_days     # {days} 临期阈值
POST /api/config/proxies           # {proxies:{channel:url}} 单渠道上游代理
POST /api/config/oczen_test        # {api_key} OpenCodeZen 凭证连通性测试
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
> Edge/Chrome，登录后经 CDP 捕获 Cookie `raccoon_refresh_token`，见 internal/login_raccoon/web.go；
> 跨平台，不再依赖 Windows 注册表，详见 R44），弹窗次按钮「从客户端导入」读本机
> `.box-agent/config/auth.json`。凭据 access_token ≈1h + refresh_token ≈30d，保活每 4 小时一次
> 以减少「请求先 401 再刷新」的往返；无签到端点。**注意互踢**：上游 refresh 轮换 refresh_token，
> 同账号凭据共用（本工具 + 浏览器/客户端）会互踢，需各自单独登录（独立 `sid`）才能并存。
> 上游默认档即最深思考，故不接档位面。
> 接口结构整理：`xxhhlk/raccoon2api`（MIT）。
> **Loomy（`loomy/*`）**：导入型渠道 —— 凭据由面板「从本机客户端导入」读
> `C:\Users\Public\Loomy\<hash>\userData\auth-session.json`。上游**无 refresh 端点**，
> session 约 14 天，到期需重新导入；故 `RefreshToken` 留空、定时任务全关（保活会被
> 按「无 refresh token」跳过，但每天仍空跑一次并记失败）。鉴权失败是 **HTTP 200 +
> 业务码 `100002`**（不是 401），业务码判定必须排在状态码判定之前。
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
> 免费档有三道闸门（规范 `ses_<12hex><14Base62>` 会话头 + `stream:true` 且 tools 含 `bash`/`read` +
> OpenCode CLI 伪装头），缺一即 403 FreeTierError；面板固定一项「[OpenCodeZen] 匿名」、积分显示「不适用」，
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
> 支持多账号（独立 profile 逐个添加）。详见 `docs/智谱清言渠道接入备忘.md`。

## 6. 关键不变量（改动前必读）

0. **每次代码变更后必须本地重新构建 `dist/wild-work.exe`**（见 §8）。改了 `cmd/wild-work/webui/` 下任何前端源码，必须先 `npm --prefix cmd/wild-work/webui run build` 再 go build —— 否则 exe 里是旧面板，且**不会有任何报错**（embed 的是产物目录，不是源码）。
   `dist/` 在 `.gitignore` 中，CI 只产出带平台后缀的 `wild-work-<os>-<arch>`，
   **不会**生成 `dist/wild-work.exe`——该文件只能手动构建。
   不重建会导致：本地运行的二进制与源码不一致（例如改了版本号但仍显示旧版本）。
1. `PrepareBody` 三改写勿动：强制 `stream=true`、`tool_choice` 归一化、`developer→system`
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
- [AGENTS.md](AGENTS.md) — 本文件：决议项（R1–R48）、架构选型、不变量
- [docs/三接口兼容改造备忘.md](docs/三接口兼容改造备忘.md) — 三接口（Chat/Responses/Anthropic）兼容层架构决策、实施记录、验证清单、已知限制
- [docs/用量积分流水记账备忘.md](docs/用量积分流水记账备忘.md) — 双流水统计（token/积分）架构、差分算法、实测验证、已知限制（R17）
- [docs/前端React重构架构计划.md](docs/前端React重构架构计划.md) — React 重构的选型签核（R5 被推翻的那次）、逐阶段 DoD 判定、
  各闸门的负向验证记录与实测数字（体积/控件数/色值对账）。§10 L6 是结论摘要，本文是依据与过程记录。
  > 本文件的**缺陷处置结论以 §10 L6.2/L6.3 与 `webui/FEATURES.md` §5 为准**——本文按时间顺序记录，
  > 已处置的缺陷在其原文中仍写作「待修/待定」，不逐条回填（避免两份互相覆盖的"权威结论"）。
  > 2026-10-01 起反选入库（此前受 `docs/*` 白名单制限制，仅本地可见）。

以下备忘被 R16 / 不变量 22 / 不变量 23 等决议引用，但**尚未入库**（`.gitignore` 白名单未反选，仅本地可见）：
`docs/opencodezen渠道接入备忘.md`、`docs/qwenwork渠道接入备忘.md`、`docs/qoderCN渠道接入备忘.md`、
`docs/qoderCOM渠道抓包分析与接入计划.md`、`docs/智谱清言渠道接入备忘.md`（R22–R38 引用，随 PR #46 新增，
作者未提交入库）。（部分可能已丢失，仅存在于历史会话中）。
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

> 本节只描述**本地独有**的约定与偏离；上游决议 R1–R43 一律照上游采纳，不在此重复。

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
- `internal/cdp` 的 `TestWriteDoesNotHangClose` 在本机失败（**纯上游 master 同样复现**）：
  `writeTimeout=15s` 大于测试预算 12s，且 `Call(timeout)` 的超时并不约束写入阶段。
- 故 `go test ./...` 目前**非全绿**（仅此一处），`go build` / `go vet` 全绿。执行 §8「全绿后再构建」时须知悉此条。
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
6. `go test ./...` 有**一处既有失败**：`internal/cdp` 的 `TestWriteDoesNotHangClose`
   （纯上游同样复现，见 §10 L4），非本次引入。
7. `dist/wild-work.exe`（Windows）只验过**体积与二进制内嵌标记**，从未在本机执行过（Linux 环境）。
   它的实际运行表现要等所有者在 Windows 上确认。
8. ⚠️ **上面 L6 收尾清单第 3 条（本文件 line ~434）记的 exe 体积不可复现**：用**当前 HEAD 源码**重建
   `dist/wild-work-linux` 得 16,641,509 B，而 2026-10-01 09:30 那份产物是 16,580,692 B（记录值 16,580,652），
   差 **+60,817 B**；本次改动本身实测只值 +1.00 kB bundle（649.42 → 650.42 kB）。
   即那份基线是在一个**更早的 web-app bundle** 上量的（`web-app/` 被 gitignore，无从比对哈希，
   原产物已被覆盖，无法归因）。今后做体积对账请现测，不要引用这几个数。

**D. 待办动作**
9. 生产 daemon（`10.20.15.118:7863`，PID 2948815，2026-09-29 启动）仍在跑旧二进制里的 vanilla 面板，
   `/proc/<pid>/exe` 指向 `(deleted)`。磁盘上的 `dist/` 已是 React 版 + 本轮三处修复，**要重启才生效**；
   因监听局域网地址、重启会瞬断其他设备的客户端，须所有者点头。
10. 未 push（`xiaoyi728/wild-work` 私有仓仍是旧的）。

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
- ⚠️ **L4 增补**：`internal/cdp` 的 `TestWriteDoesNotHangClose`（`writeTimeout=15s` > 测试预算 12s）
  在 v2.6.2 依旧失败，属**上游自带缺陷**，勿归因于本地改动。

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
