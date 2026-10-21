# wild-work

> 多渠道账号聚合桌面工具——把 WorkBuddy(CodeBuddy) 国内版/国际版、TraeWork、TraeCode、QoderCN、QoderCOM（国际版）、千问办公、智谱清言、MonkeyCode、小浣熊、Loomy、Cline 的多个账号聚合成一个 OpenAI 兼容 API，并额外提供**无需账号**的 OpenCodeZen 匿名免费通道；单进程常驻、双击启动、浏览器管理。

## 本仓库说明

本仓库是 [rockswang/wild-work](https://github.com/rockswang/wild-work) 的增强分支，代码基线已同步至**上游 v2.7.2**（`478d271`，2026-10-14），在此之上保留并扩展了本地能力：

| 本地能力 | 说明 |
|---------|------|
| **React 面板** | 管理面板已从 vanilla JS 重构为 React + Vite（`cmd/wild-work/webui/`），产物 `web-app/` 由 `//go:embed` 打进二进制；带自研渲染闸门 `npm run check`（8 个场景断言可见控件、完整模型 ID、缓存三态、思考档位标注、思考强度与自定义渠道）。`cmd/wild-work/web/` 保留本地视觉层与桌宠，不参与 embed |
| **桌宠** | 面板内可开关的桌面宠物（`webui/src/pet.js` + `webui/public/pet/` 资源），读取面板下发的流量计数（`GET /api/pulse`）做互动反馈 |
| **运行统计面板** | 第三个 tab（见下），30s 自动刷新，接 `/api/stats` 与 `/api/stats/logs` |
| **面板端点防护** | 管理接口的跨源写请求校验、账号列表仅返回本实例自有账号（`ownAccounts`） |
| **记账修正** | 7 天窗口跨月漏扫修复、月末 `AddDate` 溢出导致误删上月流水的修复、Trae 系 Stream usage 恒空修复、新 key 条目计收入账、签到发放权威入账与差分补丁 |
| **面板接线闸门** | 静态扫描 `provider` 已声明的渠道，双向锁死「已声明 ⇒ 必须在面板渠道顺序表里」；Cline 曾因漏进该表而完全不出现于 `/api/fees`（费率表、模型查找、用量折线全部拿不到它，且不报错） |

构建产物需**先构建前端再编译 Go**（embed 依赖），完整步骤见 [DEVELOPMENT.md](DEVELOPMENT.md)。本仓库不发布预编译二进制，请自行构建或使用上游 Releases。

## 功能

- **多协议兼容**：`/v1/chat/completions`（OpenAI Chat）、`/v1/models`、`/v1/responses`（OpenAI Responses）、`/v1/messages` 与 `/v1/messages/count_tokens`（Anthropic Messages）、`/v1/systemone`（Jev 结构化决策），可直接接入 `codex` CLI、`claude` CLI 与需要语义决策的自动化流程
- **模型前缀路由**：模型 ID 带 `<渠道>/` 前缀（唯一例外是 Cline 免费池：对外直接用上游命名空间 `cline-free/*`，旧写法 `cline/cline-free/*` 仍兼容），粘性路由优先复用账号以提升会话缓存利用率，临期积分优先消耗
- **十三渠道聚合**：WorkBuddyCN + WorkBuddyAI + TraeWork + TraeCode + QoderCN + QoderCOM + 千问办公 + 智谱清言（`glm/*`）+ Cline（`cline-free/*`，官方 `sk_` API Key 免费池；面板复制出的就是客户端要填的 ID）+ MonkeyCode（`monkeycode/*`）+ 小浣熊（`raccoon/*`）+ Loomy（`loomy/*`）+ OpenCodeZen（`oczen/*`，匿名免费、无需账号）；旧 Qoder（`qoder/*`）路由保留但已从界面下线；另可在面板自行接入任意 OpenAI 兼容渠道（见下）
- **三种添加形态**：浏览器授权登录 / **网页版自动登录**（小浣熊：拉起独立 profile 的 Edge/Chrome，登录后经 CDP 捕获凭据，Win/mac/Linux 通用，不再依赖注册表或本机客户端）/ **导入本机客户端凭据**（MonkeyCode / 小浣熊 / Loomy，Windows 与 macOS 路径均已探测）；Cline 走第四种——粘贴官方 API Key（只调 `/api-keys` 验证，零 token 消耗）
- **账号池调度**：请求级重试 + 粘性路由、账号级错误**在同一请求内换号**（不再一错即禁整号）、**模型级冷却**（429 只冷却命中的模型而非整个账号）、分级冷却状态机（软限流 / 风控 / 账号故障分别处理）
- **流空闲监控**：连续 300 秒读不到任何字节即判定上游卡死并断流，避免请求无限挂起
- **思考链防癫检测**：逐帧监测思维链复读/空转，命中即中断 SSE 并返回 `upstream_reasoning_loop`，**不罚账号**（死循环是模型级问题，换号必然复现）；设置里可热切换，默认开启
- **思考档位透传**：`/v1/models` 与费率表透出上游目录**声明**的 `reasoning_effort` 档位与默认档；上游未声明时整个对象不出现，前端也不编造
- **缓存利用率**：「用量与流水」与「运行统计」新增缓存列及汇总卡，严格区分「命中 0%」与「上游不提供该维度（显示「—」）」
- **请求体指纹脱敏**：自动清除 Claude Code / Codex CLI 注入的模板句与 `<developer>` 角色，降低上游内容拦截误判
- **上游协议头仿真**：出站自动注入官方客户端指纹头（`X-CodeBuddy-Request`、`X-Machine-ID` 等），降低风控误判风险
- **自动签到与保活**：每日定时签到领额度（Qoder 双区含 10:00–12:00 窗口重试，避免上游活动延迟导致漏领；小浣熊走工作台接口触发**惰性落账**的每日积分，见下），token 保活，WorkBuddy 国际版自动领日活奖励
- **双口径记账**：token 流水（渠道×模型）与积分流水（入项/消耗/过期）分开记账，面板折线图 + 模型用量榜 + 积分流水对账，临期阈值可配
- **运行统计面板**（第三 tab）：今日汇总、平台概览、使用中/接棒、最近临期与预计作废、模型消耗（首字延迟/吞吐）、异常账号、最近请求流水、运行日志；里程碑进度以 toast 提示（已读去重）
- **积分可视化**：账号卡片上的积分汇总条可点击筛选渠道，费率 tab 显示各渠道积分余额；费率表每行模型分两行展示（上行短名 + 上下文/能力/促销标记，下行**完整模型 ID** 一键复制——客户端该填的就是它）；hover 积分区弹明细，临期条目与后端同口径标红并排在最前，展开明细那一刻卡片/汇总条/弹层三个数字同源
- **模型查找**：费率弹层内的「查找模型」，按关键字（模型名 / 渠道 / 完整 ID）即时过滤全渠道模型，点结果即复制完整模型 ID
- **Web 管理面板**：账号管理（添加/签到/刷新/停用/删除/改名）、积分明细、模型列表与费率、统一设置弹层（含**备用上游通道**、**思考强度**与**自定义渠道**）；监听非本机地址时强制管理密码登录（HttpOnly cookie 会话）
- **自定义渠道接入**（`custom_channels`）：在面板设置中接入任意第三方 OpenAI 兼容 API（如官方 StepFun、本地 CLIProxy、DeepSeek 等），通过 `渠道标识/模型名` 统一路由并集中查看用量流水与实时运行统计（TTFB、吞吐、请求日志）；模型面**配什么返回什么**，不向上游拉取也不推测
- **系统托盘**：常驻右下角（单条目像素图标，打开面板时蓝色、查看日志时灰色、退出时红色），双击打开面板，右键菜单可打开面板/查看日志/退出，退出前先摘图标避免任务栏留残影
- **跨平台**：Windows（完整支持）、macOS（代码已就绪）、Linux（`--no-tray` 无头模式）

## 架构

单进程守护程序：一个 `http.Server` 同时提供推理端点、面板管理端点与内嵌前端静态资源，没有数据库、没有外部依赖服务。

```
cmd/wild-work/          main.go：装配渠道客户端、账号池、系统托盘、HTTP 服务
  webui/                React 面板源码（Vite + 自研渲染闸门）
  web-app/              前端构建产物，//go:embed 的目标（不入库，由 npm run build 生成）
  web/                  上一代 vanilla 面板 + 本地视觉层与桌宠（不 embed，仅供对照）
internal/
  app/                  管理端点与面板 API（39 个 /api/* 路由）、面板鉴权、跨源防护
  server/               OpenAI Chat 端点、账号池调度、粘性路由、错误分类与冷却
  gateway/              Responses / Anthropic Messages / systemone 端点
  provider/             渠道 Kind 枚举、公共接口与流式解析
  workbuddy|workbuddyai|traework|traecode|qoder|qodercn|qodercom|qwenwork|glm|oczen|monkeycode|raccoon|loomy|cline/
                        各渠道客户端与协议实现
  loopguard/            思考链死循环（发癫）检测：流式逐帧判据与防误杀护栏
  devdump/            开发期上游原文落盘（仅 -tags devdump 构建生效，发布版为空桩）
  ledger/               token 与积分双流水记账、月度分段查询
  stats/                运行统计引擎（快照、里程碑、请求流水、临期与接棒视图）
  idle/                 流空闲监控
  logs/ config/ cdp/    日志、配置解析、Chrome DevTools Protocol 登录编排
```

- **运行时**：Go 1.25，仅两个直接依赖（`github.com/energye/systray`、`golang.org/x/sys`）。
- **状态落盘**：`data/state-<渠道>.json`（账号状态）、`data/ledger/`（双流水）、`data/stats.json`（运行统计）、`data/app.log`（运行日志）、`auths/`（账号凭据明文 JSON）。
- **测试**：152 个 `_test.go`（`go test ./...` 全绿，34 个测试包）；面板侧有路由/字段契约测试（Go 扫 `web-app` 产物）、渠道主题色与渠道接线契约测试，前端侧有 props 检查与渲染层闸门。运行 `go test ./...` 与 `npm --prefix cmd/wild-work/webui run check`。

## 项目渊源

本项目最初算法来源于 [Sliverkiss/](https://github.com/Sliverkiss/) 大佬的 xxx2api 系列项目，本项目针对多渠道进行了聚合，针对 Windows 环境进行了适配，降低了使用门槛，并提供跨平台 Web 管理界面。

### 声明

**本项目只是各上游渠道的集成与聚合，本身不涉及任何逆向分析和破解工作。**

即：本仓库不产出、不包含、不分发任何协议逆向研究成果。各渠道的接口参数、签名算法、风控指纹等底层知识，全部来自社区其他开源项目的公开成果；本项目所做的是**在既有公开成果之上做多渠道路由、账号池调度、协议适配与界面封装**，并提供跨平台、低门槛的使用形态。所有逆向相关的功劳与风险归于下述各上游项目作者。

### 致谢

感谢以下开源项目及其作者。它们分别完成了各渠道的接口逆向与协议封装，是各渠道能够落地的前提：

| 项目 | 贡献 |
|------|------|
| [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) | WorkBuddy(CodeBuddy) 国内版接口逆向，本项目最初的算法来源 |
| [Sliverkiss/qoderwork2api](https://github.com/Sliverkiss/qoderwork2api) | QoderWork 接口逆向，Qoder 渠道参考 |
| [wicm84266964/Buddy2api](https://github.com/wicm84266964/Buddy2api) | 千问办公渠道逆向参考 |
| [wpy030414/xrl-router-plugin-qwenwork](https://github.com/wpy030414/xrl-router-plugin-qwenwork) | 千问办公渠道逆向参考 |
| [iceloon/dsh-workbuddyai-connect](https://github.com/iceloon/dsh-workbuddyai-connect) | WorkBuddy 国际版接口逆向 |
| [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) | WorkBuddy 渠道架构参考（MIT） |
| [Zhengyuuuui/qoder2api](https://github.com/Zhengyuuuui/qoder2api) | Qoder 渠道端点与逻辑比对参考 |
| [icebears111/qoderwork2api](https://github.com/icebears111/qoderwork2api) | Qoder 渠道端点与逻辑比对参考 |
| [zhangdailin/Orchids-2api](https://github.com/zhangdailin/Orchids-2api) | Qoder 渠道端点与逻辑比对参考 |
| [jasonxu114514/opencode2api](https://github.com/jasonxu114514/opencode2api) | OpenCodeZen（oczen）匿名渠道 endpoint 特殊要求分析 |
| [FishBottle7/opencode2dsh](https://github.com/FishBottle7/opencode2dsh) | OpenCode 相关补充参考 |
| [ttales430/glm2api](https://github.com/ttales430/glm2api) | 智谱清言（chatglm.cn）网页版私有接口协议逆向，glm 渠道协议依据 |
| [codkeep/MonkeyCodeReverseEngineer](https://github.com/codkeep/MonkeyCodeReverseEngineer) | MonkeyCode 渠道协议对照参考（Apache-2.0） |
| [xxhhlk/raccoon2api](https://github.com/xxhhlk/raccoon2api) | 小浣熊渠道协议逆向（MIT） |
| [xxhhlk/loomy2api](https://github.com/xxhhlk/loomy2api) | 讯飞 Loomy 渠道协议逆向（MIT） |
| [ttales430/wild-work PR #46](https://github.com/rockswang/wild-work/pull/46) | 智谱清言渠道实现（含 CDP 登录编排） |

> 若上述项目作者认为本项目的引用方式不当，请提 issue 联系，我们会立即调整或移除相关内容。

同时感谢给本项目 PR 的各位贡献者！

## 使用方式

### Windows

1. 构建或获取 `wild-work.exe`（本仓库需自行构建，见 [DEVELOPMENT.md](DEVELOPMENT.md)；上游预编译包见 [rockswang/wild-work Releases](https://github.com/rockswang/wild-work/releases)）
2. 放到任意目录，双击启动
3. 右下角出现托盘图标，**双击** → 浏览器打开 Web 管理面板
4. 在面板中点击对应渠道的「+」按钮添加账号（OpenCodeZen 无需添加账号，启动即已就绪）
5. 根据下方配置说明接入你的 AI 客户端

### 托盘菜单

- **打开主界面**：在浏览器中打开管理面板
- **查看日志**：用记事本打开 `data/app.log`
- **退出**：退出程序

### 无头模式（Linux 服务器）

```bash
./wild-work --no-tray
```

启动后打印 API 地址、Key 等信息，阻塞运行，Ctrl+C 退出。

## 配置 AI 客户端

### 1. 获取模型列表

`/v1/models` 返回当前所有可用模型：

```bash
curl -s -H "Authorization: Bearer CyWorkAPI" http://127.0.0.1:7863/v1/models
```

模型 ID 需带渠道前缀：`workbuddy/<model>`、`workbuddyai/<model>`、`traework/<model>`、`traecode/<model>`、`qodercn/<model>`、`qodercom/<model>`、`qwenwork/<model>`、`glm/<model>`、`cline/<model>`、`monkeycode/<model>`、`raccoon/<model>`、`loomy/<model>`、`oczen/<model>`（旧 `qoder/<model>` 仍可用，已从界面下线）。

### 2. 其他客户端

支持 OpenAI 兼容 API 的客户端均可接入：

```
Base URL: http://127.0.0.1:7863/v1
API Key:  CyWorkAPI
```

### 3. 不支持自动拉取模型列表的客户端（Pi）

Pi 需要手动编辑 `~/.pi/agent/models.json`（Windows：`C:\Users\<用户名>\.pi\agent\models.json`）：

```json
{
  "providers": {
    "wild-work": {
      "name": "wild-work",
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:7863/v1",
      "apiKey": "CyWorkAPI",
      "models": [
        {
          "id": "workbuddy/auto",
          "name": "自动路由 (WorkBuddy)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 168000,
          "maxTokens": 32000,
          "compat": { "maxTokensField": "max_tokens" }
        },
        {
          "id": "traework/glm-5.2",
          "name": "GLM-5.2 (TraeWork)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 48000,
          "compat": {
            "thinkingFormat": "deepseek",
            "supportsReasoningEffort": true,
            "maxTokensField": "max_tokens"
          }
        }
      ]
    }
  }
}
```

> 只列了两个示例，完整列表请通过 `/v1/models` 获取后自行添加。

### 4. 三种接口协议

除 OpenAI Chat Completions 外，同一端口还兼容 **OpenAI Responses** 与 **Anthropic Messages**，可用官方 CLI 直接接入：

| 端点 | 协议 | 适用客户端 |
|------|------|-----------|
| `POST /v1/chat/completions` | OpenAI Chat | 大多数第三方客户端、`openai` SDK |
| `POST /v1/responses` | OpenAI Responses | `codex` CLI、`openai` SDK 的 Responses API |
| `POST /v1/messages` | Anthropic Messages | `claude` CLI、`anthropic` SDK |
| `POST /v1/messages/count_tokens` | Anthropic count_tokens | Claude Code 上下文预算用 |

鉴权：OpenAI 侧用 `Authorization: Bearer <API Key>`；Anthropic 侧 `x-api-key: <API Key>` 或 `Authorization: Bearer` 均可。

**模型名可省略渠道前缀**，在 `config.json` 的 `compat` 段配置映射：

```json
"compat": {
  "default_channel": "workbuddy",
  "max_tokens_cap": 32000,
  "model_map": {
    "claude-*": "workbuddy/glm-5.2",
    "gpt-5*": "workbuddy/deepseek-v4-pro"
  }
}
```

- 带 `channel/` 前缀的模型名始终优先
- 无前缀时依次尝试：`model_map` 精确匹配 → 通配匹配（key 以 `*` 结尾）→ `default_channel`
- `max_tokens_cap` 用于封顶客户端的 `max_tokens`（Anthropic 客户端常发 64000，超出部分上游会直接 400）；设 `0` 表示不限制

**Codex CLI**（`~/.codex/config.toml`）：

```toml
model = "traework/glm-5.2"
model_provider = "wildwork"

[model_providers.wildwork]
name = "wildwork"
base_url = "http://127.0.0.1:7863/v1"
wire_api = "responses"
env_key = "WILDWORK_KEY"
```

**Claude Code**（环境变量）：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:7863"
export ANTHROPIC_AUTH_TOKEN="CyWorkAPI"
export ANTHROPIC_MODEL="traework/glm-5.2"
```

> ⚠️ **已知限制**：Responses 接口是无状态实现，不支持 `previous_response_id`（会返回 400 并提示），客户端需在 `input` 中携带完整历史（Codex CLI 默认如此）。
> 另外部分 WorkBuddy 系上游对某些 agent 系统提示词会触发内容策略拦截（返回 `code=11128 Illegal API invocation from an unapproved channel`），实测 `traework/*`、`qoder/*`、部分 `workbuddy/*` 模型不受影响；如遇拦截请更换渠道模型。

### 5. Jev 结构化决策端点（`/v1/systemone`）

OpenCode Zen 上还有一个免费的结构化决策模型 **Jev（`jev-1.13-free`）**，它不是聊天模型——不能调 `/v1/chat/completions`（会 500），只能通过专用端点调用。本网关在 `POST /v1/systemone` 直接透传：

```bash
curl -X POST "http://127.0.0.1:7863/v1/systemone" \
  -H "Authorization: Bearer CyWorkAPI" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "用户反馈：我被重复扣费了，订单号 A-104，要求今天退款。",
    "questions": {
      "refund":  {"type": "noul",   "criteria": {"true": "要求退款", "false": "未提及退款"}},
      "team":    {"type": "choice", "criteria": {"billing": "支付/发票/退款", "technical": "Bug/故障", "other": "以上都不是"}},
      "urgency": {"type": "score",  "criteria": ["低（不紧急）", "中（今天内）", "高（立即处理）"]}
    }
  }'
```

| 类型 | 问什么 | 返回 | 类比代码 |
|------|--------|------|----------|
| **noul** | 这是不是 X？ | 0~1 的概率 | `if (isX(state))` |
| **choice** | 这是哪个？ | 每个选项的概率 + 最佳选择 | `switch (classify(state))` |
| **score** | 这几分？ | 0~(N-1) 等级分 + 概率分布 | `scoring(state)` |

关键限制：**必须带 `criteria`**（noul/choice 用 dict，score 用与级别对齐的 list）；`state` 文本约 32k token 预算，英文最强；choice 最多 255 个选项，score 2~10 级；免费（`cost:"0"`），实测 0.5~1.3s 完成决策。

> **别拿它当 GPT 用**——把它当成"语义判断 API"：给它状态和选择题，它回概率和置信度，你的代码根据 typed 值做后续决策。

### 6. OpenCodeZen 匿名免费模型（`oczen/*`）

无需任何账号或登录，直接可用（免费清单由上游动态下发）：

```bash
curl http://127.0.0.1:7863/v1/chat/completions \
  -H "Authorization: Bearer CyWorkAPI" -H "Content-Type: application/json" \
  -d '{"model":"oczen/mimo-v2.6-flash-free","messages":[{"role":"user","content":"你好"}]}'
```

- 部分免费模型有**地域限制**（如 `muse-spark-*-contributor-free` 在国内直连返回 403 RegionError），列表仍会列出；在设置里启用**备用上游通道**后会自动改道重发一次
- 免费额度/限流由上游 OpenCode Zen 控制，本工具不做额外限制

## 面板操作指南

- **添加账号**：点击渠道按钮 → 确认对话框 → 浏览器窗口登录 → 自动完成
  - 「＋ MonkeyCode」「＋ Loomy」是**导入**按钮：读取本机已登录客户端的凭据，不需要浏览器登录
  - 「＋ 小浣熊」主按钮走**网页版自动登录**：本工具拉起一个独立 profile 的 Edge/Chrome 打开小浣熊网页版，您在其中正常登录后由本工具经 CDP 捕获凭据；次按钮「从客户端导入」复用本机客户端凭据。⚠️ **登录态互踢**：上游刷新会轮换 refresh_token，同一份凭据同时用在本工具与浏览器/官方客户端上会互相挤下线，想两边同时用请在本工具里单独登录一次
  - 「＋ Cline」是**粘贴 API Key**：在 app.cline.bot 自行注册并创建 `sk_` Key 后粘贴进来（本工具只调 `/api-keys` 验证，不消耗额度）。⚠️ 官方免费额度**按 Cline 账号计**，同一账号下多把 Key 共享一份额度，扩额度请注册多个独立账号
  - **平台**：小浣熊的登录与三渠道的客户端导入均已跨平台（Windows / macOS 路径各自探测，MonkeyCode / 小浣熊 / Loomy 官方客户端都有 macOS 版）；找不到凭据时返回带路径的明确报错
- **账号管理**：卡片显示积分、签到状态（WorkBuddy 国际版显示「自动领日活奖励」）；图标按钮操作（签到 ✓ / 刷新 ↻ / 停用 ⏸ / 删除 ✕）
  - **修改显示名**：点击卡片上的账号名即可修改
  - 账号按固定渠道序展示，OpenCodeZen 固定一个匿名条目（不可增删停用、无签到、积分显示「不适用」）
  - 卡片顶部**积分汇总条**可点击筛选渠道，悬停积分数字显示套餐明细（含有效期与可用/不可用小计）
- **运行统计 tab**：今日汇总 / 平台概览 / 使用中接棒 / 最近临期 / 模型消耗 / 异常账号 / 最近请求 / 运行日志，30s 自动刷新（运行日志 15s）
- **刷新积分**：面板顶部按钮，批量刷新全部账号余额
- **模型列表和费率**：点击「刷新」从上游拉取最新模型定价；上游未返回定价的模型显示 `unknown`，免费模型高亮为 `Free`；模型标识点击即复制；tab 右上角显示该渠道积分余额
- **桌宠**：顶栏可开关桌面宠物，它会随请求流量变化互动
- **设置（统一配置入口）**：点击顶栏右侧 ⚙ 齿轮按钮，包含：
  - *接口与鉴权*：API 监听地址（`127.0.0.1` / `0.0.0.0` / 自定义 + 端口）、API-Key（给 AI 客户端）、**管理密码**（给面板登录；与 API-Key 是两套凭据）
  - *自动签到与开机自启*：签到时间多组增删、开机自启开关
  - *模型路由*：默认渠道、封顶 tokens、CC/Codex 客户端模型名映射表（支持通配）
  - *备用上游通道*：全局只配**一个**备用代理（`http://` / `https://` / `socks5://`），留空 = 关闭。它**不影响任何常规请求**（所有渠道一律直连）；仅当上游返回「地区限制」时，本工具在同一次请求内自动改走该通道重发一次（目前取用方：Cline 与 OpenCodeZen）。同一处还可为 OpenCodeZen 填入自定义 API key（`sk-…`，留空用匿名凭证 `public`）
  - *模型降级链*：主模型在其渠道全部账号上限流冷却时，按您配置的有序备胎链自动顶上（备胎可跨渠道），响应头 `X-Model-Fallback` 标注实际备胎；原模型解冻后自动切回，不粘滞

> 顶栏的 API 地址 / API-Key 文本框点击复制；所有配置修改统一走 ⚙ 设置弹层。

### 面板登录（监听非 127.0.0.1 时）

- 监听 `127.0.0.1` 时面板默认不鉴权（只有本机能访问）
- 监听 `0.0.0.0` 或具体网卡 IP 时**必须设置管理密码**（`config.json` 的 `admin_password`，或面板设置里的「管理密码」），未设置时程序拒绝启动
- 登录后下发 HttpOnly cookie（有效期 7 天，使用中自动续期）；密码连续错误 5 次锁定该来源 IP 5 分钟；改密码后所有已登录会话立即失效
- OpenAI 兼容接口的鉴权不受影响，仍用 `api_key`（两套凭据相互独立）；也可用环境变量 `WILDWORK_ADMIN_PASSWORD` 配置（优先级更高）

## 常见问题

### 1. Windows 提示“未知发布者”或报毒？

本工具没有数字签名，可能被 Windows 安全中心或杀毒软件拦截。若报毒，请把 exe 或所在目录加入排除项；或者克隆仓库自行基于源码构建（见 [DEVELOPMENT.md](DEVELOPMENT.md)）。

### 2. TraeWork 积分里的「不可用」是什么？

TraeWork 的额度分两个池，由上游 `available_endpoint` 字段区分：`ep=0`（通用池）本工具能消耗；`ep=1`（官方客户端专用池）只有 Trae 官方客户端能用。所以卡片会出现 `1828可用积分/4400不可用` 的显示，可消耗余额只算 `ep=0`。

### 3. 如何绑定多个 WorkBuddy 国际版账号？

添加账号时默认复用当前已登录的 github/Google 会话。方案：浏览器右上角菜单选「新建无痕窗口」，在干净环境内打开 `http://127.0.0.1:7863` 新增账号；或打开开发者控制台单独清除 github.com 与 workbuddy.ai 的 Cookies。

### 4. WorkBuddy 国际版登录后积分显示为 0？

注册国际版新账号时需要选择地区，奖励积分才发放。

### 5. 请求卡住不动？

工具内置 300 秒流空闲监控：上游连续 300 秒无任何数据即主动断流。若上游本身较慢（如 TraeWork 部分模型），换一个渠道模型即可。

### 5. 小浣熊的「签到」是怎么回事？

小浣熊**没有**独立的签到/领取端点，它的每日 300 积分是**惰性落账**的：

- 名义记账时间是当天 00:00（积分流水里显示 `grant_at`）；
- **实际入账**要等账号当天第一次访问「工作台」接口才发生（流水里的 `created_at`）——
  也就是网页端文案说的「当天**登录**后有效期延长至 7 天」。

本工具的签到就是替你做这次访问（调网页端打开首页时自己也会调的 `setting_info`），所以：

- **定时签到**：按面板「签到时间」自动执行，当天积分即时到账；
- **手动签到**：账号卡片上的 ✓ 按钮同样有效（当天已领过时返回「今日已领取」，不会重复发放）；
- 如果你平时会打开小浣熊网页/客户端，积分本来也会到账；本工具的签到保证**即使一天都不打开**也不漏领。

> 注：纯对话、查余额、刷新 token 都**不会**触发这个落账，只有工作台接口算「当天登录」。

## ⚠️ 风险警告与免责声明

**在使用本工具前，请务必阅读并理解以下内容。下载、运行或继续使用本工具即表示你已阅读、理解并同意承担全部风险与责任。**

### 风险警告

1. **逆向工程风险**：本工具基于对上游平台（WorkBuddy/CodeBuddy、TraeWork、Qoder、千问办公、OpenCode 等）**未公开接口的逆向工程**实现，非官方支持、无任何授权。上游随时可能调整接口、加密方式或风控策略，导致本工具**部分或全部功能立即失效**，作者不承诺修复时效。
2. **封号风险**：使用本工具的请求特征与官方客户端存在差异，**可能违反上游平台的服务条款**，存在账号被**限制功能、降低额度、暂时或永久封禁**的风险。请自行评估后果，**强烈建议使用小号或可承受损失的账号接入，切勿将主力账号用于本工具**。
3. **网络暴露风险**：面板监听 `0.0.0.0`（或任意非 `127.0.0.1` 地址）时**必须配置管理密码**（`config.json` 的 `admin_password`，或面板设置中「管理密码」），否则程序拒绝启动；未配置密码时只能监听本机。即便如此，仍请确认网络环境可信。
4. **数据安全风险**：账号凭证（access/refresh token）以明文 JSON 保存在本地 `auths/` 目录，请妥善保管该目录，避免泄露。

### 免责声明

1. 本工具仅供**个人学习、技术研究与测试**用途，严禁用于商业用途、大规模滥用或任何违反法律法规及上游平台服务条款的场景。
2. 本软件按"**现状**"（AS IS）提供，**不提供任何明示或默示的保证**。作者不对使用本软件造成的任何直接或间接损失承担责任，包括但不限于：账号被封禁、积分/额度损失、数据丢失、商业纠纷、法律纠纷等。
3. 使用者应**自行承担**因使用本工具产生的一切风险与后果；若不同意上述条款，请立即停止使用并删除本软件。
4. 本工具与上游各平台及其运营方**无任何关联与合作**；相关商标与品牌权利归其各自所有者所有。
5. 如本工具的使用对上游平台造成影响或平台方提出异议，作者将配合处理；本项目的存在不代表对任何规避行为的价值判断。

## License

MIT — 仅供个人学习使用，请遵守各上游平台服务条款。