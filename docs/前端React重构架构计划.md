# 前端架构重构计划 — vanilla → Vite+React

> 状态：**全部完成（2026-09-30 起，2026-10-01 收口，共 11 个 commit）**
> React 已提到根路径 `/`，`/next/` 与 `WebUINext` 已移除，vanilla `web/` 退为纯 diff 基准。
> 收尾实测与作废预估见 AGENTS.md §10 L6。

---

## 0000. 阶段 2 落地记录（2026-09-30）— 设计 token 层

交付：`webui/src/tokens.css`（三主题 + OKLCH + 字号阶梯）、`webui/src/channelColors.js`、
`internal/app/web_theme_tokens_test.go`、`webui/tools/{derive,verify}-tokens.mjs`。

**判据实测**：51 对 hex/oklch 在浏览器里**画出来逐通道相等**（最大通道差 0）。
`/next/` 与 `/`（vanilla）在同一浏览器下，light 与 paper 两主题的
`--bg/--text/--muted/--accent/--danger/--hairline/--glm/--oczen` 解析结果**完全一致**。
CSS 2.38 KB → 6.48 KB，首屏 563,161 → 567,269 字节（仍 −43%）。

**四个踩过的坑，都值得记下来：**

1. **「OKLCH 是否等价」不能用字符串比。** `getComputedStyle` 返回 `oklch(…)` 原文
   （CSS Color 4 规定计算值仍是 oklch，只到 used-value 才转 sRGB），canvas 的
   `fillStyle` getter 也原样回显。第一版据此判出 **51/51 FAIL**，而颜色其实全对。
   唯一可靠的取法是画 1×1 像素再 `getImageData` 读回。
2. **必须加 `CSS.supports` 门禁。** 浏览器不支持 oklch 时 `fillStyle` 赋值被**静默忽略**，
   两侧都停在同一个兜底色上 ⇒ 假绿。不支持就判 FAIL，不判通过。
3. **不要自己写 OKLab 逆向矩阵。** 我连错两处：`hexToRgb` 重复 /255（白被算成
   oklch(0.625 0.248 10) 这种深棕），以及把 LMS→sRGB 用成 XYZ→sRGB（白反算成 #ffb0a0）。
   现在只保留正向换算，反算以浏览器为准。
4. **暗色主题机制二选一，取了「不并存」。** tailwind `darkMode: false` 显式关掉。
   若保留 `dark:` 变体，它按 class 或按 media 都**映射不到 paper 主题**，
   会出现「dark: 生效但 paper 不跟」的静默错位，比没有该机制更难查。

**渠道清单改为从 Go 推导**：闸门不再硬编码 10 个渠道，而是取面板权威枚举
`feeChannelOrder` + 已下线但路由保留的旧 `qoder`。加第 11 个渠道时会自动要求它
既有三主题色变量、又有 `CH_VAR` 映射——硬编码清单则会让它悄悄掉进 `--accent` 兜底。

**`CH_VAR` 缺 glm 的修复落在 React 侧**，vanilla 的 `app.js` 不动（L1 约束：功能层以
上游为准，且它要留作融合 diff 基准）。负向验证做过：删掉 `glm: '--glm'` 一行，
测试立刻报「渠道 [glm(--glm 未映射)] 没进 CH_VAR」，还原即绿。

---

> 起草日期：2026-09-30
> 触发：调研 [TokenTracker](https://github.com/xiufengsun/TokenTracker) 前端栈后，比对本地 `cmd/wild-work/web/` 现状
> 本文件位于 `docs/`，受 `.gitignore:17 docs/*` 保护，**默认不入库**；需要入库时追加 `!docs/前端React重构架构计划.md`。

---

## 000. 阶段 1 落地记录（2026-09-30）—— 两处原判据作废

### 裁决一：DoD 第 4 条改写，改判「首屏下载量」而非 exe 体积

原 §8-4「exe 体积小于基线 13,487,616」与 §0 签核「echarts 内置、不再走 CDN」**互斥**，
两者不可能同时成立。**根因：echarts 从来就不在 exe 里** —— 它今天是 CDN 下载的
751,806 字节。把它搬进二进制，exe 必然变长；要求「同时更小」是我上一轮写计划时的推理错误。
§1.3 那个「React 全家桶 + 按需 echarts = 417,067 字节」也复现不出来，真实 JS 产物
**560,380** 字节（差 34%），当时大概是裸包构建、没带 router 与 tailwind。以实测为准。

所有者裁定：判据改为**首屏需下载字节**，实测（curl 逐文件量过，非估算）：

| | 首屏字节 | 说明 |
|---|---|---|
| vanilla 现状 | **997,096** | 内置 245,290 + CDN echarts 751,806（后者正是 L4 记的 issue #47 3~10s 卡顿源） |
| React 产物 | **563,161** | index 397 + JS 560,380 + CSS 2,384，全走 localhost，断网可用，第三方脚本归零 |
| | **−43.5%** | ✅ 新判据通过 |

exe 侧的代价被明确接受为定价而非失败：

| 形态 | 字节 | 相对基线 |
|---|---|---|
| A. 只 embed vanilla（HEAD 基线） | 16,072,740 | — |
| B. **迁移期双份共存** | 16,638,918 | **+566,178 (+3.52%)** 临时 |
| C. 阶段 3 收尾只剩 React | 16,388,172 | **+315,432 (+1.96%)** 最终 |

### 裁决二：embed 不切换，改为双份共存、React 挂 `/next/`

原计划阶段 1 就把 embed 从 `web` 切到 `web-app`。实测后果是：**从现在到阶段 3 做完
（5-7 天），所有者日常用的生产面板只剩一张图**，114 个 DOM id 对应的功能全部不可用。
所有者裁定改为迁移期两份同时 embed，根路径继续服务 vanilla，React 产物挂 `/next/`。

好处不止是不断服：移植每张卡片、每个弹层都能**开两个标签页对着原样比**，
FEATURES.md 的核对单从「凭记忆勾」变成「当场勾」。

代价（都已实测，不是猜测）：
- Go 侧改动从「一行」变成 **2 个文件约 10 行**：`main.go` embed 指令 + `fs.Sub` 第二次取子树 +
  `server.Config.WebUINext` 字段 + `handler.go` 一段挂载块。**仍不碰任何业务代码**，
  不变量 12（server 主链路不得被绕过）不受影响 —— 新增的是一个独立路径前缀。
- 迁移期 exe 同时装两份面板（+3.52%），阶段 3 收尾删掉 vanilla 引用后回落到 +1.96%。

### D1 原文有误：切 embed 是**两行**，不是一行

`cmd/wild-work/main.go:353` 还有 `fs.Sub(webFS, "web")`。只改 46 行的 embed 指令会得到
一个莫名的 `GET / → 404`（我就是这样撞上的）。D1 那句「Go 侧改动仅一行」作废。

### 新增：web-app/ 必须留一个 tracked 占位

`web-app/` 整体是 npm 产物、不入库，但 `//go:embed all:web-app` **要求目录存在**，
否则新克隆的仓库直接编译失败。故 `.gitignore` 改成 `web-app/*` + `!web-app/.gitkeep`，
并给 vite 加了 `closeBundle` 钩子重建 `.gitkeep`（否则 `emptyOutDir` 每次 build 都把它清掉）。

### echarts 精确锁 4.3.0，不是 ^4.x

与现状 CDN **同版**。阶段 3 那 8 项图表交互必须在同一行为上对账，不能「升到 4.x 最新再回归」。
另记：v4 既无 `echarts/core` 也无 `use()`，走 `echarts/lib/*` 副作用 import；echarts 的
package.json **连 main/module/exports 都没有**，裸包名解析不到。

### 会话链路已在真实浏览器验过（非 curl 推断）

未登录 `/api/state` → 401 `need_login` → React 弹登录层 → 错密码 401 → 对密码拿
HttpOnly cookie → `/api/state` 200 → 渲染版本/账号数/渠道数 → **echarts canvas 实绘 779×180**，
console 零报错。`credentials: 'same-origin'` 是必需项，不带则 cookie 不发送。

产物里 `node_modules` 出现次数 = **0**（D1 生死线在真实二进制上验证，不是口头保证）。

---

## 00. 阶段 0 落地记录（2026-09-30）

已交付三件闸门，全绿、纯增量、可单独提交，vanilla 代码一行未改：

| 文件 | 作用 |
|---|---|
| `internal/app/web_contract_test.go` | 端点级双向契约 + 扫描器自检 + `web-app/` 无 node_modules 守卫 |
| `internal/app/web_field_contract_test.go` | 字段级契约（反射 + 内联 map 源码扫描），锁死 `/api/state` 36 个字段路径 |
| `cmd/wild-work/webui/FEATURES.md` | 114 DOM id + 10 弹层 + 桌宠 8 键 8 态 + 19 段必须搬的业务逻辑 |

实测跑出的数字：`Go 注册 33 条 /api/* 路由，前端引用 31 条，有意不上面板 2 条` —— 与 §1.2 一致。

**对本文原稿的三处修正（原文数字有误，已按实测为准）：**

1. §1.2「桌宠 9 态优先级」**实为 8 态**：`PRIORITY` 数组（pet.js:15）只有
   `error urgent stale working happy hungry asleep idle`，无隐式第 9 态；`MOTIFS`/`BLUSH` 也各 8 条。
2. §1.2「桌宠 5 个 localStorage 开关」**实为 8 个 `ww-pet-*` 键**：原文只数了引擎/外观开关
   （engine motif crescent burst ring），漏掉 `ww-pet-on` `ww-pet-pos` `ww-pet-mini`。
   照 5 个搬会丢**显示开关、拖拽位置、迷你模式**三项功能。
3. §3.1 的契约测试只做端点包含判断，**掉字段不会报警**（掉 `credits_stale`、
   `unusable_credits` 面板只是静默少个标记）。已加强为字段级，见上表第二个文件。

**新增事实（审计副产物，React 类型定义据此砍面）：** Go 发了但面板读 0 次的字段
`State.keepalive_hours`、`AccountView.until|reason|last_checkin_msg`、`ResourceItem.key`、
`RefreshSummary.total|platforms`、`CheckinResult.uid|has_remain`、`feesModelRow.supports_tools`、
`Stats.token.pt|ct`、`DayTokens.total`、`CreditStats.expire`、`RecentCredit.name` ——
**不进 React 类型**。面板依赖面因此比 wire 面小一圈。

**两个必须知道的实现陷阱**（已在测试里锁死）：
- `/api/usage` 的 `disabled` 键**不在 `ledger.Stats` 上**，是 handler 在 ledger 为 nil 时
  下发的内联 map。只按 Stats 生成 TS 类型 ⇒ 用量页无从显示「记账已关闭」。
- `/api/fees`、`/api/account/resource_detail`、`/api/pulse`、`/api/login/glm_auto_status`
  全是内联 map，反射覆盖不到 ⇒ 走源码字面量扫描，语义是「宁误报不漏报」。

---

## 0. 签核记录（重要）

**R5 将被推翻。** AGENTS.md 决议 R5 原文「Web UI 用纯静态 HTML/CSS/JS（无前端编译链）」，
其「不得推翻，除非有强理由并更新本节」的门槛由所有者于 **2026-09-30** 明确签核越过：

- 问题「前端架构往哪走？R5 是已定决议，改它需要你明确签核」→ 答：**引入 Vite+React 重写前端**
- 问题「echarts 这条外部依赖怎么处理」→ 答：**echarts 内置，不再走 CDN**

实施完成后必须同步更新 AGENTS.md（见 §8）。

---

## 1. 实测事实（本计划全部建立在这些数字上，非估算）

### 1.1 现状资产

| 文件 | 行数 | 说明 |
|---|---|---|
| `cmd/wild-work/web/app.js` | 1574 | 功能层（上游 v2.5.4）+ 本地视觉层补丁约 165 行 |
| `cmd/wild-work/web/index.html` | 455 | **114 个 DOM id** |
| `cmd/wild-work/web/style.css` | 631 | 三套主题 |
| `cmd/wild-work/web/pet.js` | 802 | 桌宠（弹簧内核 + motif） |
| `cmd/wild-work/web/pet.css` | 167 | |
| `cmd/wild-work/web/anim.css` / `anim.js` | 65 / 58 | |
| `cmd/wild-work/web/theme.js` | 26 | Paper 主题切换，键 `ww-theme` |

- embed 声明：`cmd/wild-work/main.go:46` → `//go:embed all:web`
- 静态挂载：`internal/server/handler.go:145` → `h.mux.Handle("/", ...)`，带 `Cache-Control: no-cache`

### 1.2 功能面（移植时必须逐条对账的清单）

- **Go 注册面板路由 33 条**；前端实际调用 **31 条**。
  差额：`GET /api/logs`、`POST /api/quit` —— Go 有路由、面板无入口。**这是现状事实，不是 bug，移植时不要「顺手补上」**。
- **`$("...")` 取元素 113 处**
- **10 个弹层**：`loginConfirmOverlay` `loginOverlay` `feesOverlay` `confirmOverlay`
  `settingsOverlay` `renameOverlay` `helpOverlay` `aboutOverlay` `glmOverlay` `adminLoginOverlay`
- **桌宠 5 个 localStorage 开关**：`ww-pet-engine` `ww-pet-motif` `ww-pet-crescent` `ww-pet-burst` `ww-pet-ring`
- **桌宠 9 态优先级**：`error > urgent > stale > working > happy > hungry > asleep > idle`
- **桌宠内核常量**：`RING = { r:62, a0:300, a1:130, maxDots:16 }`、`stepSpring(s, omega, zeta, dt)`、`MOTIFS` 目录、`BLUSH` 表

### 1.3 体积与工具链（本机实测）

| 项 | 实测值 |
|---|---|
| node / npm | v22.22.3 / 10.9.8，registry 已指向 `registry.npmmirror.com` |
| 安装 vite7+react18+router7+tailwind3+echarts4 | **92 包 / 88 MB / 10 秒** |
| 按需 echarts(core+line+tooltip+legend+grid) + react + react-dom + router 打包 | **417,067 字节**（gzip 149,555） |
| 现 CDN `echarts.min.js` 4.3.0 | **751,806 字节**（gzip 250,231） |
| 现 `dist/wild-work.exe` | 13,487,616 字节 |
| 现 `dist/wild-work-linux` | 16,129,549 字节 |
| echarts 4 模块化入口 | `lib/chart/line.js` `lib/component/tooltip.js` `lib/component/legend.js` 均存在 ✓ |

> **结论：React 全家桶 + 按需 echarts 的产物体积，比现在单个外链 echarts 还小一半多。**
> 早期「内置 echarts 会让 exe +5.6%」的估算作废——它建立在「整包 echarts」的错误前提上。
> react-router-dom 7 打包时 rollup 会报 `"use client"` directive 警告，**无害**（已被忽略，产物正常）。

### 1.4 「每渠道专色变量」不需要移植

TokenTracker 的 `--community-*` 手法本地**已经有**，且三主题各一份：
`style.css` 的 `:root`（26-35 行）、`prefers-color-scheme: dark`（57-66 行）、
`html[data-theme="paper"]`（541 行起）各定义 `--wb --trae --qoder --wbai --traecode --qodercn --qodercom --qwenwork --glm --oczen`，
`app.js:1423 CH_VAR` + `app.js:1419 cssVar()` 从 CSS 变量取色喂图表。
**本计划不把它列为「待搬项」。**

---

## 2. 三个决定性架构选择

### D1 源码目录与 embed 目录必须分开（生死线）

`//go:embed all:web` 的 `all:` 前缀会连 `_`、`.` 开头的文件一起收。
若把 React 工程建在 `web/` 内，**88 MB 的 `node_modules` 会被整个打进 exe**。

```
cmd/wild-work/webui/      ← React 源码（git 跟踪，不 embed，node_modules 在此）
cmd/wild-work/web-app/    ← vite build 产物（embed 目标，进 .gitignore）
cmd/wild-work/web/        ← 上游 vanilla 代码，原样保留、不参与 embed
```

Go 侧改动仅一行：`//go:embed all:web` → `//go:embed all:web-app`

**这条同时解决了 React 路线最大的代价**：上游 vanilla `web/` 留在树里 = 下次融合的 diff 基准。
融合时照旧 `git merge-file --strip-trailing-cr` 拿到上游功能改动清单，再逐条移植进 React。
否则下次融合将无法回答「上游改了什么」。

### D2 HashRouter，不用 BrowserRouter

`handler.go:145` 静态挂在 `/`，BrowserRouter 的 `/settings` 深链刷新会打到 Go 的 404，
修它就得给后端加 SPA fallback —— **违反「不影响后端功能」约束**。
HashRouter（`#/settings`）零 Go 改动。

### D3 echarts 改为 npm 按需引入

签核选的是「内置、不走 CDN」。在 React 下该意图的自然形态是 npm 依赖 + 按需注册，
比独立文件更小、彻底断网可用、AGENTS.md L4 的「CDN 无 SRI/`crossorigin`」隐患直接消失
（不再是第三方脚本）。

---

## 3. 阶段 0 · 闸门先行（1 天，纯增量，可单独提交，零风险）

写任何 React 之前先建保护网，使后续每一步都能**证明**没掉功能。

1. **契约测试** `internal/app/web_contract_test.go`
   - 枚举 Go 注册的 33 条面板路由
   - 扫描 `cmd/wild-work/web-app/` 产物中的 `/api/*` 引用
   - 断言 **前端调用集 ⊆ Go 注册集**
   - 初版白名单：`GET /api/logs`、`POST /api/quit`（Go 有、面板无，保持现状）
   - 价值：上游新增端点或 React 漏实现 → 测试红，而不是上线后才发现
2. **DOM id 核对单** `cmd/wild-work/webui/FEATURES.md`
   - 导出 114 个 id → 用途表，作为移植完成度核对单
3. **10 弹层清单** 写入同一文件，明确「一个都不能少」

> 回退：本阶段只新增测试与文档，删除即恢复原状。

---

## 4. 阶段 1-6

### 阶段 1 · 骨架（1 天）
- `webui/` 起 vite + react + tailwind，`base: '/'`，产物输出 `../web-app/`
- `main.go` embed 一行改指 `web-app`；`go build ./... && go vet ./...` 全绿
- 空壳页跑通 `/api/auth/state` → 登录层，确认 R4 会话链路在 React 下成立
  （HttpOnly + SameSite=Lax cookie，fetch 需 `credentials: 'same-origin'`；7 天滑动续期）
- **本阶段必须实测 exe 体积确实下降**；不达标即回到 D3 重估，不要继续往后做

### 阶段 2 · 设计 token 层（2 天，纯 CSS）
- 中性灰阶改 **OKLCH**（感知均匀）+ sRGB hex 兜底 + `@supports (color: oklch())` 包裹
  —— 该写法是为迁就老 WebView2（Chromium<111），Windows 侧用得上
- `--text-*` display 字号阶梯：72/56/48/36/28/22/18/16/14/12/11 + 负字距（`-0.03em` 级）
- **三主题逐一对账**：`:root` / `prefers-color-scheme: dark` / `html[data-theme="paper"]`
  paper 的纸质噪点背景、学术衬线标题、去玻璃拟态**全部保留**
- Tailwind 仅作 token 载体；`darkMode:'class'` 与现有 `data-theme` 机制**二选一，不并存**

**顺手修一个实测到的真 bug**：`app.js:1423` 的 `CH_VAR` 只映射 8 个渠道、**缺 `glm`**，
导致智谱清言折线一直走 `cssVar(CH_VAR[ch] || "--accent")` 兜底、显示主色而非 `--glm`。移植时补进映射表。

### 阶段 3 · 功能移植（5-7 天，按弹层切片，每片一次提交）
每片完成后跑 §3 契约测试 + id 核对单：

1. 账号卡片网格（签到/刷新/停用/删除/明细/改名；含不变量 17：不可用额度**仅展示、不参与 `Pick()` 排序**）
2. 登录编排：`login/start` + `login/cancel` + glm 三件套（`glm_auto` / `glm_auto_status` 轮询 / `glm_auto_cancel`）+ `glm_token` 手工兜底
3. 设置弹层：`checkin_times` `listen` `admin_password` `api_key` `autostart` `compat` `expiring_days` `proxies` `oczen_test`
4. **用量与流水双 tab**（echarts 按需引入）—— 必须复刻的 8 项交互面：
   - `tooltip trigger:'axis'` 轴指示器 + `valueFormatter`（`fmtTokensFull` / `fmtCredits`）
   - `smooth: true`
   - 图例点击隐藏 + `legend type:'scroll'` 翻页
   - `fmtTokensFull`/`fmtCredits` Y 轴格式化
   - `resize()`：window resize / 主 tab 切换 / usage 子 tab 切换 / 容器由隐藏变可见
   - `cssVar()` 三主题同源取色（`--text --muted --hairline --bg` + `CH_VAR`）
   - 无 spend 条目时 `box.style.display='none'` + `dispose()`
   - 主题变更重画：`ww-theme-change` 事件 + `matchMedia('prefers-color-scheme: dark')` 监听
5. 渠道费率**弹层**（L1 约束：本地是弹层、上游是页内多标签 → 保留 `feesOverlay` 外壳承载上游 `.fees-tabs` 渲染，渲染目标仍 `#feesBox`）
6. 关于/帮助/确认/改名等小弹层

### 阶段 4 · 桌宠（3-4 天，风险最高，放最后）
两条硬约束（AGENTS.md L2，实测踩过）：
- **绝不能复用面板全局 `api()`** —— 它遇 401 会 `showLogin()` 弹登录层、抢 `adminLoginPass` 焦点、
  `state !== null` 时直接 `location.reload()`；桌宠是 3s/30s 轮询，反复触发会毁掉登录流程。
  必须保留独立 `petGet()`（非 2xx 返回 null、静默跳过、登录后自愈）。
- **`Pet.init()` 不能挂在主流程 `init()` 末尾** —— 上游会话探针未登录时 `showLogin(); return;`
  会跳过后续所有语句，导致启用面板鉴权后桌宠永不挂载。React 下等价做法：挂在 `main.jsx` 的**独立 root**，
  不共享 `App` 渲染路径。

逐项对账：5 个 localStorage 开关、弹簧内核 `stepSpring(omega,zeta,dt)`、9 态优先级、`MOTIFS` 目录、
`RING{r:62,a0:300,a1:130,maxDots:16}`、`BLUSH` 表、`/api/pulse` 轮询（该端点刻意留在 `guardMux` 守卫内，不开鉴权白名单）。

**建议桌宠走独立入口**（vite 多 entry `pet.html`），不塞进 SPA 主路由 —— 能省掉一大半移植风险。

### 阶段 5 · 构建链固化（1 天）
- 不变量 0 改写：`dist/wild-work.exe` 前置步骤从「go build」变为
  「`npm --prefix cmd/wild-work/webui run build` → go build」，写进 AGENTS.md §8 + DEVELOPMENT.md
- `.gitignore`：追加 `cmd/wild-work/web-app/`、`cmd/wild-work/webui/node_modules/`
- **新增构建守卫测试**：断言 `web-app/` 下不存在 `node_modules`，防止有人把工程建错目录把 88 MB 打进 exe

### 阶段 6 · 文档与签核落地（0.5 天）
- AGENTS.md：R5 改为「Vite+React 编译，产物 embed」，注明签核日期与理由
- §10 L1/L3 融合方法整节重写：冲突面从「6 文件」变为
  「上游 vanilla `web/` → 功能清单 → 移植进 React」，并保留 `--strip-trailing-cr` 纪律
- `cmd/wild-work/web/` 顶部加说明：「此目录为上游参考基准，不参与 embed」
- 渠道色变量若新增，仍须三处同步（`:root` / dark / paper）

---

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| node_modules 被 embed，exe 暴涨 88 MB | D1 分目录 + 阶段 5 构建守卫测试 |
| 下次上游融合无法定位功能变更 | `web/` 保留为 diff 基准 + 阶段 0 契约测试 |
| 深链 404 | D2 HashRouter |
| 图表交互回归 | 阶段 3 第 4 片的 8 项交互清单逐条勾 |
| 桌宠抢登录焦点 / 鉴权下不挂载 | 阶段 4 两条 L2 硬约束 |
| 体积不降反升 | 阶段 1 就实测，不达标即停 |
| paper 主题或某个弹层被漏移植 | 114 id + 10 弹层核对单 |

**回退路径**：`main.go` embed 行改回 `all:web` 即恢复原状 —— vanilla 代码全程未被修改，
这是 D1 目录安排最大的价值。

---

## 6. 明确不做的事（范围闸门）

- **不动任何 Go 业务代码**：pool / scheduler / upstream / ledger / gateway / session / auth 全不碰；
  Go 侧唯一改动是 `main.go` 那一行 embed 路径。
- **不补 `GET /api/logs` / `POST /api/quit` 的面板入口** —— 现状没有，保持没有（补属新功能，不在本计划内）。
- **不引入 UI 组件库**（shadcn/antd/MUI）：保持本地 Apple/Paper 视觉层自绘。
- **不做 React Router 的 BrowserRouter**，因此**不碰 `handler.go`**。
- **不移除 paper 主题、不移除桌宠、不改桌宠动画内核**（R34/R35 等决议照常生效）。
- **不推翻其它任何已定决议**（R1-R4、R6-R33、R34/R35 等）。

---

## 7. 工期

- 串行：**16-20 工作日**
- 压缩方案（3-5 天）：只做 **阶段 0 + 阶段 2 + D3 的 vanilla 版**（echarts 改本地按需，暂不 React）
  → 可得：设计 token、断网可用、体积下降、修掉 `glm` 配色 bug；React 化留到确有页面级需求时再启动。

---

## 8. 完成定义（DoD）—— 逐条判定（2026-10-01）

| # | 判据 | 结论 |
|---|---|---|
| 1 | `go build && go vet && go test ./...` 全绿 | ⚠️ build/vet 全绿；`go test ./...` 有**一处既有失败**：`internal/cdp` 的 `TestWriteDoesNotHangClose`（纯上游同样复现，AGENTS.md §10 L4 已记），非本次引入 |
| 2 | 契约测试通过：React 每条 `/api/*` 都在 Go 侧存在 | ✅ 且升级为**双向**：Go 侧未被调用者必须恰为白名单 `{GET /api/logs, POST /api/quit}`，上游新增端点会红 |
| 3 | 构建守卫通过：`web-app/` 内无 `node_modules` | ✅ 测试实跑不跳过；产物内 `node_modules` 计数 **0** |
| 4 | ~~exe 体积小于基线~~ → 改判首屏下载量 | ✅ 997,096 → 567,269 B（**−43.0%**，收尾后重量）；exe +3.16%（见 §000 裁决一） |
| 5 | 114 id / 10 弹层 / 三主题 / 桌宠 8 键 8 态逐项核对 | ✅ 但**这一条原本是"人工打勾"，实际不可信**——L6.2 那三个缺陷都是在它"已通过"之后发现的。现已改为机器判据 + 同后端可见控件对照 |
| 6 | `dist/wild-work.exe` 按新流程重建并**验证** | ⚠️ 已按 npm build → go build 重建，只验了体积与内嵌标记；Windows 二进制**从未在本机执行过**（Linux 环境） |
| 7 | AGENTS.md R5 / §8 / §10 L1-L3 已更新 | ✅ 另加 L6 收尾清单、L6.1 完成表、L6.2 缺陷记录、L6.3 遗留清单 |

## 9. 本计划的判断修正记录（防止后人又按旧数字决策）

| 原判断 | 实测结论 | 错在哪 |
|---|---|---|
| 「切 embed 只改一行」 | 两行：embed 指令 + `fs.Sub(webFS, "web")` | 只改一行得到莫名的 `/` 404，我就是这样撞上的 |
| 「exe 应小于基线」 | 与「echarts 内置」签核互斥 | echarts 从来不在 exe 里（是 CDN 751,806 B），搬进二进制必然变长 |
| 「按需打包 417,067 B」 | 真实 JS 产物 648,680 B | 当初大概是裸包构建，没带 router 与面板代码 |
| 「首屏 −43.5%」 | 空壳期数字；真实面板 + 视觉层后 −43.0%（收尾）/ −24.0%（含 vanilla 全部资源口径） | 拿骨架数当真数报过一次，已更正 |
| 「桌宠 9 态」 | 8 态（`PRIORITY` 就 8 项） | 数错 |
| 「桌宠 5 个开关」 | 8 个 `ww-pet-*` 键 | 漏了 `on`/`pos`/`mini`，照 5 个搬会丢迷你模式与拖拽位置 |
| 「视觉层同源 ⇒ 界面观感不变」 | 同源的是 CSS，不是渲染条件 | token 字节相等证明不了"该出现的元素出现了"；三个真实缺陷全在此判断"成立"期间发生 |
| 手写 OKLab 逆向矩阵做色值校验 | 以浏览器渲染为准 | 连错两处系数（`hexToRgb` 重复 /255、LMS→sRGB 误用 XYZ→sRGB），且 `getComputedStyle`/`fillStyle` 都原样回显 oklch 无法比对 |

## 10. 遗留与待办

见 **AGENTS.md §10 L6.3**。本文件已于 2026-10-01 在 `.gitignore` 反选入库
（此前受 `docs/*` 白名单制限制只在本地），但**处置结论以 L6.3 与 `webui/FEATURES.md` §5 为准**：
本文按时间顺序记录，下面 §8/§9 及各阶段原文里仍写作「待修/待定」的条目，凡与 §11 冲突以 §11 为准。

## 11. 二次收口（2026-10-01，紧接 §8 同日）：上一轮遗留全部落地，另逼出一个业务代码缺陷

写文档这趟又要我先核实、不许凭记忆。逐条给出处置与实测出处：

| 上一轮记的事 | 本轮结论 | 判据（现测，非引用） |
|---|---|---|
| B5 `valueFormatter` 死选项 | **已修** | 接管 `tooltip.formatter`，逐字复刻 4.3.0 默认结构（读 `node_modules/echarts/lib/model/Series.js` `formatTooltip` 与 `util/format.js` `getTooltipMarker` 取证），只替换数值段。浏览器实测 tooltip HTML：`WorkBuddyCN: 32.4万`（修前 `323,579`） |
| ↑ 附带的安全面 | 自定义 formatter 必须自己转义 | `TooltipContent.js:237` 是 `el.innerHTML = content`；默认实现对名字走 `encodeHTML`。造一个备注为 `<img src=x onerror=alert(1)>` 的 glm 账号实测：tooltip 内是 `&lt;img …&gt;` 文本，全页 `img[src="x"]` 节点数 **0** |
| B6 `usage.disabled` 观感 | **已定：提示条 + 保留版面** | 造真 disabled（把 `data/ledger` 换成同名普通文件 → `ledger.New` 的 `MkdirAll` 失败 → `app.ledger==nil` → `{disabled:true}`）。实测面板可见控件 15 项，与数据态**逐项同名**；提示条文案按真实成因写（面板侧无开关，故不写「去设置里开启」） |
| B7 计划文档入库 | **已反选** | `.gitignore` 加 `!docs/前端React重构架构计划.md`；AGENTS.md §9 补链接 |
| C8 `chkPet` 非响应式 | **已修** | 受控 state + `Pet.setEnabled` 广播 `ww-pet-toggle`。实测：弹层开着时点桌宠浮层「隐藏」（走的就是同一个 `setEnabled`），勾选翻为 `false`、桌宠同时消失 |
| C10 渲染层判据未固化 | **已补闸门** | 新 `webui/tools/render-check.mjs`：vite `ssrLoadModule` + `react-dom/server`，五场景数可见控件；`npm run check` 串上 `check-props`。口径与真浏览器逐项对齐在 **20**。负向验证：把 L6.2 第 2 条缺陷装回去 → `exit 1` 点名缺失 18 个控件 |
| （新）canvas 724 vs 736 的口头归因 | **归因错了，已更正两次** | 上一轮我口头归给「容器/滚动条」——实测两边 viewport 皆 795、无滚动条；真因是 tailwind `.container` 撞名（已修，见 L6.2 第 3 条）。本轮再问「736 是哪来的」，实测 `containerW=795` 时 canvas 宽 **736**，两态一致，非缺陷 |
| A4 多渠道图例翻页「要生产凭据才验得了」 | **判断错了，合成数据就够，已实测** | 沙箱造 7 渠道 × 7 天流水：legend 按 `type:'scroll'` 渲染成功、控制台零报错（漏注册会抛 `Component legend.scroll not exists`）。再把 `#usageChart` 压到 240px + 派发 `resize`，图例带内墨迹裂成 4 组、末组贴 x=216~239，即翻页控件真的出现了。判据只能取画布像素（`getImageData`）——echarts 的 legend 画在 canvas 上，**没有 DOM 可查**，这也解释了它为什么一直被我归进"验不了" |

### 11.1 顺手抓到一条**业务代码**的「测试全绿但仍然错」

`ledger.Query` 每月 1~14 日把 7 日窗口的**当月分段整段漏读**（详见 AGENTS.md §10 L4 该条）。
触发它纯属意外：为了核对 disabled 形态而造了一批 fixture 流水，`?days=7` 返回 `total=0`
而 `?days=1` 返回 169134——同一批文件、同一次进程，这不可能同时成立，于是顺藤摸到月份循环。

三点值得记下来：
1. **判据必须是可重复的数，不是"看起来对"**。`days=7` 与 `days=1` 的差值是唯一把这件事钉死的证据；
   在我造 fixture 之前，这条缺陷在生产上已经可能跑了很久，且没有任何日志。
2. **端到端测试在这里会假绿**：`Query` 读 `time.Now()`，端到端写法只在每月头 14 天复现。
   所以判据做在纯函数 `monthSegments(from, now)` 上，用固定日期表驱动，天天可跑。
3. **别把"没报错"当"没坏"**：这条既不影响 `days=1`、也不影响写入路径，只影响读出来给面板看的聚合。

### 11.2 一条自我更正：体积基线不可复现

用当前 HEAD 源码重建 `dist/wild-work-linux` 得 **16,641,509 B**，而本文与 AGENTS.md 记的收尾值是
**16,580,652 / 16,580,692**，差 **+60,817 B**；本轮全部源码改动实测只值 **+1.00 kB bundle**
（649.42 → 650.42 kB，两次 `npm run build` 对照）。⇒ 那几个体积数字是在一个**更早的 web-app bundle**
上量的，`web-app/` 被 gitignore、原产物已被覆盖，无从比对哈希、无法归因。
**今后做体积对账一律现测**，别再引用本节及 §8 第 4 条里的历史数字（数字本身没错，错在被当成参照）。

### 11.3 仍待所有者动作

本轮交付方式由所有者定为**只提交到本地**：不 push、不重启 daemon。于是
`10.20.15.118:7863`（PID 2948815，2026-09-29 启动）跑的仍是旧二进制里的 vanilla 面板，
磁盘上的 `dist/` 才是 React 版 + 本轮全部修复；重启会瞬断局域网其他设备的在途请求，需所有者点头再做。
`xiaoyi728/wild-work` 私有仓同样落后于本地。
