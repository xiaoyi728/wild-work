# 面板功能核对单 · vanilla → React 移植基线

> 生成于 2026-09-30，来源：`cmd/wild-work/web/`（上游 v2.5.4 + 本地视觉层）全文穷举。
> **2026-10-01 状态：移植已完成，面板已提到根路径 `/`。本文件仍是下次融合的功能基准。**
> 用法：移植完成的判据是本文件每一节都能逐条打勾，**一个都不能少**。
> 配套闸门：`internal/app/web_contract_test.go`（端点级）+ `web_field_contract_test.go`（字段级）。
> 本目录 `webui/` 是 React **源码**；构建产物必须输出到 `../web-app/`。两者混用会把
> 88 MB 的 `node_modules` 打进 exe —— 见 web_contract_test.go 的守卫测试。

---

## 1. DOM id 全量（114 个，index.html）

「JS 引用数」= `$("id")` 在 app.js/pet.js 中的出现次数。引用数 0 的两个（`btnTheme`、
`recentPager`）仍须保留 DOM 节点：前者由 `theme.js` 以选择器绑定，后者是分页容器。

| id | 元素 | class | JS 引用 |
|---|---|---|---|
| `aboutOverlay` | <div> |  | 3 |
| `aboutVer` | <span> |  | 1 |
| `acctEmpty` | <div> | empty hidden | 1 |
| `acctList` | <div> | acct-grid | 1 |
| `adminLoginErr` | <div> |  | 3 |
| `adminLoginOverlay` | <div> |  | 2 |
| `adminLoginPass` | <input> | input | 4 |
| `adminPassInput` | <input> | input grow | 3 |
| `adminPassReq` | <span> | req hidden | 1 |
| `apiAddr` | <code> |  | 4 |
| `apiKeyDisplay` | <code> |  | 3 |
| `btnAbout` | <span> |  | 1 |
| `btnAboutClose` | <button> |  | 1 |
| `btnAddGLM` | <button> |  | 1 |
| `btnAddQoderCN` | <button> |  | 1 |
| `btnAddQoderCOM` | <button> |  | 1 |
| `btnAddQwen` | <button> |  | 1 |
| `btnAddTime` | <button> |  | 1 |
| `btnAddTrae` | <button> |  | 1 |
| `btnAddWB` | <button> |  | 1 |
| `btnAddWBAI` | <button> |  | 1 |
| `btnAdminLogin` | <button> |  | 3 |
| `btnAdminLogout` | <button> |  | 1 |
| `btnCancelLogin` | <button> |  | 1 |
| `btnCheckinAll` | <button> |  | 3 |
| `btnClearAdminPass` | <button> |  | 1 |
| `btnCompatMap` | <span> |  | 1 |
| `btnConfirmCancel` | <button> |  | 1 |
| `btnConfirmOk` | <button> |  | 1 |
| `btnCopyUrl` | <button> |  | 3 |
| `btnFeesClose` | <button> |  | 1 |
| `btnGLMCancel` | <button> |  | 1 |
| `btnGLMSubmit` | <button> |  | 2 |
| `btnGLMToggleManual` | <span> |  | 1 |
| `btnHelp` | <span> |  | 1 |
| `btnHelpClose` | <button> |  | 1 |
| `btnLoginConfirm` | <button> |  | 2 |
| `btnLoginConfirmCancel` | <button> |  | 1 |
| `btnOczenTest` | <button> |  | 2 |
| `btnRefreshAll` | <button> |  | 3 |
| `btnRefreshFees` | <button> |  | 3 |
| `btnRefreshUsage` | <button> |  | 1 |
| `btnRenameCancel` | <button> |  | 1 |
| `btnRenameSave` | <button> |  | 1 |
| `btnSettings` | <span> |  | 1 |
| `btnSettingsCancel` | <button> |  | 1 |
| `btnSettingsSave` | <button> |  | 1 |
| `btnTheme` | <span> |  | 0 |
| `btnToggleFees` | <button> |  | 1 |
| `chkAutostart` | <input> |  | 3 |
| `chkPet` | <input> |  | 2 |
| `confirmMsg` | <div> |  | 1 |
| `confirmOverlay` | <div> |  | 3 |
| `creditChart` | <div> | chart-box | 2 |
| `customHostRow` | <div> | row hidden | 3 |
| `echartsCdn` | <script> |  | 1 |
| `feesBox` | <div> |  | 2 |
| `feesOverlay` | <div> |  | 3 |
| `glmAuto` | <div> |  | 1 |
| `glmErr` | <div> |  | 6 |
| `glmManual` | <div> | hidden | 4 |
| `glmOverlay` | <div> |  | 4 |
| `glmStatus` | <div> |  | 5 |
| `glmTokenInput` | <input> | input grow | 1 |
| `helpOverlay` | <div> |  | 3 |
| `inHost` | <input> | input grow | 4 |
| `inMaxTok` | <input> | input port | 2 |
| `inPort` | <input> | input port | 2 |
| `keyInput` | <input> | input grow | 3 |
| `lcMsg` | <p> |  | 1 |
| `lcTitle` | <div> |  | 1 |
| `listenRiskTip` | <div> | risk-tip hidden | 1 |
| `loginConfirmOverlay` | <div> |  | 4 |
| `loginMsg` | <div> |  | 1 |
| `loginOverlay` | <div> |  | 3 |
| `loginTitle` | <div> |  | 1 |
| `mapEditor` | <div> | map-editor hidden | 3 |
| `mapErr` | <div> |  | 2 |
| `mapPresets` | <span> |  | 1 |
| `mapSummary` | <span> |  | 1 |
| `mapText` | <textarea> | input map-text | 4 |
| `mtabAccounts` | <div> |  | 1 |
| `mtabUsage` | <div> |  | 1 |
| `nextCheckin` | <span> |  | 1 |
| `oczenKeyInput` | <input> | input grow | 5 |
| `pgInfo` | <span> |  | 1 |
| `pgNext` | <button> |  | 2 |
| `pgPrev` | <button> |  | 2 |
| `proxyErr` | <div> |  | 3 |
| `proxyList` | <div> | proxy-list | 1 |
| `recentList` | <div> | recent | 1 |
| `recentPager` | <div> |  | 0 |
| `renameOverlay` | <div> |  | 3 |
| `rnInput` | <input> | input grow | 4 |
| `rnUid` | <span> |  | 1 |
| `secAccounts` | <section> |  | 1 |
| `selCh` | <select> | select | 3 |
| `selExpiring` | <select> | input | 2 |
| `selHost` | <select> | select | 6 |
| `serverLine` | <div> |  | 1 |
| `settingsOverlay` | <div> |  | 3 |
| `tabCredit` | <div> |  | 1 |
| `tabToken` | <div> |  | 1 |
| `tblModels` | <table> |  | 1 |
| `timesBox` | <div> | times | 1 |
| `toast` | <div> | toast hidden | 1 |
| `ucEarn` | <div> |  | 1 |
| `ucReqs` | <div> |  | 1 |
| `ucSpend` | <div> |  | 1 |
| `ucTokens` | <div> |  | 1 |
| `usageChart` | <div> | chart-box | 2 |
| `usageRange` | <div> |  | 2 |
| `usageSince` | <span> |  | 3 |
| `ver` | <span> |  | 1 |

> `echartsCdn` 在 React 化后消失（D3：echarts 改 npm 按需引入，不再有 CDN `<script>`）。
> 这是**有意删除**，AGENTS.md L4 记的「CDN 无 SRI/`crossorigin`」隐患随之消除。

---

## 2. 弹层（10 个，缺一不可）

| 弹层 | 触发 | 关闭路径 |
|---|---|---|
| `adminLoginOverlay` | 401 `need_login` | 登录成功 / `btnAdminLogout` |
| `loginOverlay` | 登录编排进行中 | `btnCancelLogin` → `POST /api/login/cancel` |
| `loginConfirmOverlay` | 打开 auth_url 前的确认 | `btnLoginConfirm` / `btnLoginConfirmCancel` |
| `glmOverlay` | 添加智谱清言 | `btnGLMCancel` → `glm_auto_cancel`；含手工兜底 `glmManual` |
| `feesOverlay` | `btnToggleFees` | `btnFeesClose`（L1 约束：本地弹层壳承载上游 `.fees-tabs`，渲染目标仍是 `feesBox`） |
| `settingsOverlay` | `btnSettings` | `btnSettingsCancel` / `btnSettingsSave` |
| `confirmOverlay` | 删除等破坏性操作 | `btnConfirmOk` / `btnConfirmCancel` |
| `renameOverlay` | 卡片改名 | `btnRenameSave` / `btnRenameCancel` |
| `helpOverlay` | `btnHelp` | `btnHelpClose` |
| `aboutOverlay` | `btnAbout` | `btnAboutClose` |

---

## 3. 桌宠（pet.js 802 行）

**8 个 localStorage 键**（计划文档原写「5 个开关」，漏了 `on`/`pos`/`mini` 三个；
只搬 5 个会丢显示开关、拖拽位置和迷你模式）：

`ww-pet-on` `ww-pet-pos` `ww-pet-mini` `ww-pet-engine` `ww-pet-motif`
`ww-pet-crescent` `ww-pet-burst` `ww-pet-ring` · 另有 `ww-theme`（theme.js）与
`ww-theme-change`（**事件名，非存储键**）。

**8 态优先级**（计划文档原写 9，实际 8，且无隐式第 9 态）：
`error > urgent > stale > working > happy > hungry > asleep > idle`

内核常量与表：`RING = { r:62, a0:300, a1:130, maxDots:16 }`（pet.js:228）、
`stepSpring(s, omega, zeta, dt)`（:53）、`MOTIFS`（:104，8 个 motif 数组）、
`BLUSH`（:21，8 态各 `[a, b]`）。

两条硬约束（AGENTS.md L2，踩过）：
- 不得复用面板全局 `api()` —— 它遇 401 会 `showLogin()` 弹登录层、抢 `adminLoginPass`
  焦点、`state !== null` 时 `location.reload()`。保留独立 `petGet()`（pet.js:656）。
- `Pet.init()` 不得挂在主流程 `init()` 末尾 —— 未登录时 `showLogin(); return;` 会跳过
  后续语句，导致启用鉴权后桌宠永不挂载。React 下挂 `main.jsx` 的独立 root。

---

## 4. 前端业务逻辑（不是渲染，必须逐条搬的算法）

这是「接口稳定」帮不上忙的部分，也是工期的真实所在。行号均指 `web/app.js`，桌宠指 `web/pet.js`。

| # | 逻辑 | 位置 |
|---|---|---|
| 1 | 通配监听地址归一化：`0.0.0.0`/`""`/`::` → `lan_ip` → 兜底 `127.0.0.1`，再拼 API 地址 | 273–281，重复于 885–887 |
| 2 | `isLoopbackHost` **镜像后端** `config.Listen.IsLoopback`，驱动「非环回必须设密码」提示 | 868–880 |
| 3 | `shortUid` 作昵称兜底（3 处）+ 「是否默认名」判据 | 90，用于 386 / 1062 / pet:1490 |
| 4 | `oczenName` 由 `state.oczen_api_key` 是否存在派生 | 383 |
| 5 | 有效期列的存在性 = `items.some(expire_at)`（缺字段则整列隐藏，不得用零值时间冒充永不过期） | 195 |
| 6 | 明细可用/不可用小计展示门控：`unusable > 0` 才拆 | 222–226 |
| 7 | `rateCell` 三态：`!priced`→未知、`free`→x0、否则 `rate.toFixed(2)`（**缺字段 ≠ 免费**） | 505–514 |
| 8 | 上下文能力双闸门 `has_context && context_window`；`capText` 区分 yes 与 undeclared | 470 / 477–486 |
| 9 | `renderFees.lastCh` 跨重渲染记忆 + 渠道已消失时的兜底 | 525–530 |
| 10 | 批量签到汇总混用 `r.results` 与 `state.accounts`（`NO_EXPLICIT_CHECKIN` 计入 skip） | 632–636 |
| 11 | `validateProxies`：URL 解析 + 协议白名单，客户端拦错 | 931–946 |
| 12 | `parseMapText`：`渠道/模型` 形状校验、渠道成员校验、重复键拒绝 | 1133–1153 |
| 13 | `traework → traecode` 共账号别名 | 1104–1109 |
| 14 | `recorded_since + "T00:00:00"` → 天数；`avg = (pt+ct)/days`；模型 top-N | 1337 / 1358 / 1356 |
| 15 | **积分折线图全量自算**：`kind==='spend'` 过滤 → day×uid 聚合 → `-e.amount` 翻号 → top10 | 1480–1500 |
| 16 | `fmtTokensFull` / `fmtCredits` / `fmtDay` 三个格式化 | 1311 / 1515 |
| 17 | 桌宠 `sync` 对上一快照差分以合成 `happy` | pet 706–722 |
| 18 | 桌宠 `resolve` 8 态优先级链；`cooling \|\| err_count>=3` | pet 511–542 / 517 |
| 19 | 签到完成判定按 **UTC+8 墙钟日界**切 `last_checkin_at.slice(0,10)` | pet 239–243 |

**前端侧常量/枚举**（编码了 API 语义，改错等于改协议）：
`CH_LABEL` :288 · `CH_CLASS` :289 · `NO_EXPLICIT_CHECKIN` :295 · `NO_CHECKIN_TAG` :298 ·
`NO_CREDITS` :301 · `NO_CHECKIN_LOGIN_HINT` :659 · `PROXY_CHANNELS` :842 · `PROXY_HINT` :843 ·
`CHANNEL_PRESETS` :1088 · `CH_NAMES` :1318 · `CH_VAR` :1423 · `UNKNOWN_TIP` :450 ·
`DETAIL_PAGE_SIZE` :136 · `RECENT_PAGE_SIZE` :1303 · `MODEL_TOP_N` :1304 ·
ledger kinds(earn/spend/expire) :1378 · glm 状态串 :759 · 掩码哨兵 `"…"` :960/:1004 ·
`"__custom__"` :861 · `"oczen-anon"` uid :1059 · 通配 host 集 :273 · 代理协议白名单 :939。

---

## 5. 缺陷处置结论（本表是权威记录，别再回去读 vanilla 猜结论）

### 5.1 vanilla 带来的、已在 React 侧修掉的

| 缺陷 | vanilla 出处 | 处置 |
|---|---|---|
| `state.accounts.length` 无兜底（同文件 634/1104 却用 `\|\| []`，口径不一致） | `app.js:333` | React 侧统一为 `state ? (state.accounts \|\| []) : []`；`checkinAll` 同样加了守卫（未登录点它会崩） |
| `CH_VAR` 只映射 8 渠道、**缺 `glm`**，智谱清言折线走 `--accent` 兜底 | `app.js:1423` | 修在 `src/channelColors.js`（10 渠道齐）。vanilla 不动 —— 它是融合 diff 基准。**面板已提到 `/`，所以对用户而言这个 bug 实际已消失** |
| 渠道清单硬编码，新增渠道会悄悄掉进 `--accent` | 同上 | 闸门 `TestChannelColorVarsAllMapped` 改为从 `feeChannelOrder` 推导，加渠道即报警 |

### 5.2 移植过程中**新引入又修掉**的三个（都是"测试全绿但仍然错"）

1. `CreditValue` 声明 `{ account }`、调用点 `a={a}` → 有积分的卡一渲染就整页白屏。
   躲过前几轮验证只因沙箱只有匿名卡（走 `credits_na` 提前 return）。→ 补 `tools/check-props.mjs`。
2. 未登录时面板操作区整块没渲染（可见控件 20 → 8）。→ 同后端双二进制对照才量得出。
3. tailwind 核心组件 `.container` 与本项目同名布局类撞车，面板被静默压窄 27px。
   vendored CSS 逐字相同也中招，因为冲突来自**加载的第二份 CSS**。→ `corePlugins.container=false`
   + `TestBuiltCSSHasNoContainerCollision` 扫产物。

**判据教训**：同源的是 CSS，不是渲染条件；token 字节相等证明不了「该出现的元素出现了」。

### 5.3 仍然存在、需要所有者拍板的

| # | 事项 | 现状 |
|---|---|---|
| 1 | `valueFormatter` 在 echarts **4.3.0 下是死选项**（该 API 5.3+ 才有，实测产物内计数 0），tooltip 数值不走 `万/亿` 格式化（Y 轴 `formatter` 生效） | 刻意**照现状保留**以便两面板逐像素可比，没顺手改好。要修就得改用 v4 `formatter` 并复刻默认 tooltip 结构 |
| 2 | `usage.disabled` 观感分叉：vanilla 只把角标改成「（统计不可用）」、版面保持；React 目前整块替换成「用量统计已关闭」 | 需定一个 |
| 3 | `Settings` 的 `chkPet` 在 render 期读 `window.Pet.isEnabled()`，非响应式：从桌宠浮层改开关后弹层勾选不跟着变 | vanilla 靠一行**位置错乱**在 glm 轮询回调里的 `$("chkPet").checked = ...`（`app.js:774`）顺带同步；移植时没照搬那行错位，故缺此副作用 |
| 4 | `TestDOMIdParity` 只静态扫 `id="..."` 字面量，能证明"写出来了"、不能证明"渲染在 DOM 上"（5.2 第 2 条它就漏了；动态拼的 id 也会漏） | 渲染层判据本次是手工做的可见控件计数，未固化成测试 |

完整遗留清单（含只能靠生产真凭据验证的 4 项、待重启/待 push）见 **AGENTS.md §10 L6.3**。

---

## 6. 三主题对账

`:root`（style.css 26–35）/ `prefers-color-scheme: dark`（57–66）/
`html[data-theme="paper"]`（541 起）三处各一份，每份都含
`--wb --trae --qoder --wbai --traecode --qodercn --qodercom --qwenwork --glm --oczen`。
paper 的纸质噪点背景、学术衬线标题、去玻璃拟态**全部保留**。新增渠道色必须三处同步。
