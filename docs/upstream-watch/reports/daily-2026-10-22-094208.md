# 上游更新报告（2026-10-22 09:42:08 CST）

- 上游仓库：https://github.com/rockswang/wild-work.git（master）
- 基线：`e3bc93fe62f5a5ed507960699267b00be146fef7`
- 上游当前：`4e895a444ed9facf1378d0c774d5be48a39a3bc1`
- 本地 HEAD：`c6f889a`（工作区未提交改动 0 项）

## 上游新增提交

```
4e895a4 Merge pull request #187 from rockswang/fix/checkin-time-picker
06c8b31 fix(web): 签到时间改为就地时间选择器，可手动选（原「＋」直接塞当前时刻）
41bcef2 chore(release): v2.9.5 — 自定义渠道可用化 + WorkBuddy 指纹对齐 + 三条「用着用着就废」的故障
382ae9d feat(custom): 接入点先规范化再有界嗅探确认真实端点，api-key 脱敏改长头四星（R121）
1607517 docs(决议项): 登记 R120（Loomy 短信登录瞬时失败不得置终态、msgid 服务端持有）+ R115 续写（#185 补 DSH Web GUI、判据措辞订正为整段逐字前缀、跨包同步护栏）
871accf fix(loomy): 短信登录不再「提交提示先点获取验证码、再点显示失败请重试」（#173）
d2b8e3d fix(officeace): 按日消耗补齐三处健壮性缺口（评审 PR #180 遗留项）
0b9eaba feat(custom): 上游 /models 尽力解析能力，导入不再编造默认值，费率页显示接入点+可按需复制 key（R119）
9413977 test(sanitize): 补齐 PR #185 的两处交付缺口 + 订正判据描述
ea15293 officeace: 锁住 usage 端点契约与时区换算的测试
af9925d officeace: 新增云端按日消耗查询（积分 / Token）
fbf4132 fix(upstream): 脱敏 DSH Web GUI 品牌短语，修复完整 prompt 的 11128
fd0df9f fix(raccoon): 等响应头上限 60s→180s，缓冲式网关的首字节不再被判死（R118）
cddbcf0 feat(workbuddy): 客户端身份链整体对齐官方桌面 5.8.3（R117）
4cd9be2 refactor(workbuddy): 会话头族按渠道各持一份实现，不共用公共包
dbf5c50 fix(workbuddy): 会话头族按官方三层语义分层，国内版补齐 X-Conversation-ID（R116）
1b546e8 chore(release): v2.9.4 — 文档同步图片/请求体两维改动 + 决议号交叉引用订正
3daba63 merge: PR #178 出站脱敏补 DSH 身份句（R115）
b649eef merge: PR #177 请求体上限 128MiB（可配）+ 转发前图片降采样（fix #176，R114）
533aed1 merge: PR #175 工具结果图片走 vision 通道（fix #174，R113）
057339d chore(license): 新增 LICENSE（MIT）并在 README 明确许可范围
f5c6076 refactor(upstream): DSH 身份句改写改用插冠词，降低语义扰动
57fa28b fix(upstream): 脱敏 DSH 身份句，绕过上游 11128 渠道校验
a61da43 chore(release): 版本号随远端回到 2.9.3；本机增补并入 2.9.3 节
d3c015d fix(qoder/qodercom): envelope 错误帧零字节识别；110/112 是账号级额度耗尽不是排队
fe80f47 fix(custom): 等响应头上限 90s→180s 并接入 upstream.timeout_seconds（R110）
8794199 fix(server): 全模型冷却窗口内的 503 也带 Retry-After，文案不再写死「限流」
47e4d3d fix(qodercn): 上游「排队」帧零字节识别并换号；MaxRotate 删除，换号策略按错误语义分层
4546238 feat(pool): 选号改按最早到期优先（R112），删除临期阈值，积分刷新 30min→10min
c0a8c06 fix(gateway): 请求体上限 32MiB→128MiB（可配），转发前把内联图片降采样（R109，fix #176）
5020d7c fix(gateway): 工具结果里的图片改走 vision 通道，不再 stringify 成 base64 文本（R108，issue #174）
```

## 变更规模（上游基线 → 上游当前）

```
 AGENTS.md                                          |   46 +-
 DEVELOPMENT.md                                     |   10 +
 LICENSE                                            |   21 +
 README.md                                          |   21 +-
 RELEASES.md                                        | 6612 +++++++++++---------
 cmd/wild-work/custom_channels_test.go              |   42 +-
 cmd/wild-work/main.go                              |   90 +-
 cmd/wild-work/web/app.js                           |  401 +-
 cmd/wild-work/web/index.html                       |   23 +-
 cmd/wild-work/web/style.css                        |   28 +
 config.example.json                                |    6 +-
 ...224\271\351\200\240\345\244\207\345\277\230.md" |   17 +-
 "docs/\345\206\263\350\256\256\351\241\271.md"     |   19 +-
 ...216\245\345\217\243\345\217\202\350\200\203.md" |    3 +-
 ...272\247\351\223\276\345\256\232\344\271\211.md" |   16 +-
 ...256\260\350\264\246\345\244\207\345\277\230.md" |   16 +-
 internal/app/app.go                                |  240 +-
 internal/app/creditrefresh_test.go                 |    2 +-
 internal/app/custom_channel_test.go                |  346 +-
 internal/app/stats_feed_test.go                    |    2 +-
 internal/config/config.go                          |   59 +-
 internal/custom/caps.go                            |   81 +
 internal/custom/client.go                          |  114 +-
 internal/custom/config.go                          |   43 +-
 internal/custom/custom_test.go                     |   99 +
 internal/custom/discover_test.go                   |  194 +
 internal/custom/endpoint.go                        |  120 +
 internal/custom/endpoint_test.go                   |   68 +
 internal/custom/probe.go                           |  477 ++
 internal/custom/probe_test.go                      |  301 +
 internal/custom/timeout_test.go                    |   89 +
 internal/gateway/anthropic.go                      |   13 +-
 internal/gateway/gateway.go                        |    8 +-
 internal/gateway/image_slim_test.go                |  135 +
 internal/gateway/imageslim.go                      |  191 +
 internal/gateway/pipe.go                           |    8 +-
 internal/gateway/responses.go                      |    6 +-
 internal/gateway/tool_image_test.go                |  221 +
 internal/gateway/util.go                           |   75 +-
 internal/login/login.go                            |    3 +-
 internal/login_loomy/guide.go                      |   39 +-
 internal/login_loomy/http.go                       |   20 +-
 internal/login_loomy/issue173_test.go              |  213 +
 internal/login_loomy/login.go                      |   40 +-
 internal/login_loomy/login_flow_test.go            |   35 +-
 internal/officeace/client.go                       |    2 +-
 internal/officeace/http.go                         |    2 +-
 internal/officeace/throttle.go                     |    4 +-
 internal/officeace/throttle_test.go                |    2 +-
 internal/officeace/usage.go                        |  184 +
 internal/officeace/usage_test.go                   |  226 +
 internal/pool/pool.go                              |  157 +-
 internal/pool/pool_test.go                         |  189 +-
 internal/pool/recordcheckin_sessiondead_test.go    |    5 +-
 internal/provider/provider.go                      |  128 +-
 internal/provider/provider_test.go                 |   48 +
 internal/qoder/client.go                           |   16 +-
 internal/qoder/envelope_notice_test.go             |  119 +
 internal/qoder/sse.go                              |  134 +-
 internal/qoder/stream_nested_error_test.go         |   71 +-
 internal/qodercn/client.go                         |   15 +-
 internal/qodercn/queue_frame_test.go               |  181 +
 internal/qodercn/sse.go                            |  152 +-
 internal/qodercn/stream_nested_error_test.go       |   71 +-
 internal/qodercom/client.go                        |   16 +-
 internal/qodercom/envelope_notice_test.go          |  143 +
 internal/qodercom/sse.go                           |  136 +-
 internal/qodercom/stream_nested_error_test.go      |   71 +-
 internal/raccoon/client.go                         |   48 +-
 internal/raccoon/timeout_test.go                   |   80 +
 internal/sanitize/sanitize.go                      |   17 +-
 internal/sanitize/sanitize_test.go                 |  142 +
 internal/scheduler/scheduler.go                    |   39 +-
 internal/server/cline_no_account_softening_test.go |    6 +-
 internal/server/fallback_dimension_test.go         |   15 +-
 internal/server/glm_rotation_test.go               |    5 +-
 internal/server/handler.go                         |  237 +-
 internal/server/handler_bodylimit_test.go          |   12 +-
 internal/server/handler_effort_test.go             |    3 +-
 internal/server/handler_images_test.go             |    2 +-
 internal/server/handler_model_cooldown_test.go     |   39 +-
 internal/server/handler_queue_test.go              |  256 +
 internal/server/handler_single_account_test.go     |    3 +-
 internal/server/hard_cooldown_window_test.go       |    5 +-
 internal/server/model_fallback_14018_test.go       |    3 +-
 internal/server/model_fallback_test.go             |   12 +-
 internal/server/rotate_on_account_error_test.go    |   10 +-
 internal/server/stream_error_penalty_test.go       |    4 +-
 internal/stats/stats.go                            |   28 +-
 internal/stats/views_test.go                       |   43 +
 internal/upstream/client.go                        |   10 +-
 internal/upstream/client_test.go                   |    8 +-
 internal/upstream/conversation_headers_test.go     |  155 +
 internal/upstream/convheaders.go                   |  173 +
 internal/upstream/convheaders_test.go              |  157 +
 internal/upstream/headers.go                       |   89 +-
 internal/upstream/identity_headers_test.go         |   64 +
 internal/upstream/sanitize.go                      |   17 +
 internal/upstream/sanitize_parity_test.go          |   75 +
 internal/upstream/sanitize_test.go                 |  112 +-
 internal/workbuddyai/client.go                     |   78 +-
 internal/workbuddyai/client_test.go                |    5 +
 internal/workbuddyai/constants.go                  |    5 +-
 internal/workbuddyai/conversation_headers_test.go  |  140 +-
 internal/workbuddyai/convheaders.go                |  173 +
 internal/workbuddyai/convheaders_test.go           |  157 +
 internal/workbuddyai/identity_headers_test.go      |   33 +
 internal/workbuddyai/models.go                     |    7 +
 scripts/ui-static-check.mjs                        |   65 +-
 109 files changed, 11370 insertions(+), 3847 deletions(-)
```

## 全部变更文件及本地状态

| # | 文件 | 变更 | 本地状态 |
|---|------|------|----------|
| 1 | `AGENTS.md` | M | 本地已偏离 |
| 2 | `DEVELOPMENT.md` | M | 本地已偏离 |
| 3 | `LICENSE` | A | 本地一致 |
| 4 | `README.md` | M | 本地已偏离 |
| 5 | `RELEASES.md` | M | 本地已偏离 |
| 6 | `cmd/wild-work/custom_channels_test.go` | M | 本地已偏离 |
| 7 | `cmd/wild-work/main.go` | M | 本地已偏离 |
| 8 | `cmd/wild-work/web/app.js` | M | 本地已偏离 |
| 9 | `cmd/wild-work/web/index.html` | M | 本地已偏离 |
| 10 | `cmd/wild-work/web/style.css` | M | 本地已偏离 |
| 11 | `config.example.json` | M | 本地已偏离 |
| 12 | `"docs/\344\270\211\346\216\245\345\217\243\345\205\274\345\256\271\346\224\271\351\200\240\345\244\207\345\277\230.md"` |  | 上游已删除；本地无此文件 |
| 13 | `"docs/\345\206\263\350\256\256\351\241\271.md"` |  | 上游已删除；本地无此文件 |
| 14 | `"docs/\346\216\245\345\217\243\345\217\202\350\200\203.md"` |  | 上游已删除；本地无此文件 |
| 15 | `"docs/\346\250\241\345\236\213\351\231\215\347\272\247\351\223\276\345\256\232\344\271\211.md"` |  | 上游已删除；本地无此文件 |
| 16 | `"docs/\347\224\250\351\207\217\347\247\257\345\210\206\346\265\201\346\260\264\350\256\260\350\264\246\345\244\207\345\277\230.md"` |  | 上游已删除；本地无此文件 |
| 17 | `internal/app/app.go` | M | 本地已偏离 |
| 18 | `internal/app/creditrefresh_test.go` | M | 本地已偏离 |
| 19 | `internal/app/custom_channel_test.go` | M | 本地已偏离 |
| 20 | `internal/app/stats_feed_test.go` | M | 本地已偏离 |
| 21 | `internal/config/config.go` | M | 本地已偏离 |
| 22 | `internal/custom/caps.go` | A | 本地无此文件 |
| 23 | `internal/custom/client.go` | M | 本地已偏离 |
| 24 | `internal/custom/config.go` | M | 本地已偏离 |
| 25 | `internal/custom/custom_test.go` | M | 本地已偏离 |
| 26 | `internal/custom/discover_test.go` | A | 本地无此文件 |
| 27 | `internal/custom/endpoint.go` | A | 本地无此文件 |
| 28 | `internal/custom/endpoint_test.go` | A | 本地无此文件 |
| 29 | `internal/custom/probe.go` | A | 本地无此文件 |
| 30 | `internal/custom/probe_test.go` | A | 本地无此文件 |
| 31 | `internal/custom/timeout_test.go` | A | 本地无此文件 |
| 32 | `internal/gateway/anthropic.go` | M | 本地一致 |
| 33 | `internal/gateway/gateway.go` | M | 本地已偏离 |
| 34 | `internal/gateway/image_slim_test.go` | A | 本地一致 |
| 35 | `internal/gateway/imageslim.go` | A | 本地一致 |
| 36 | `internal/gateway/pipe.go` | M | 本地一致 |
| 37 | `internal/gateway/responses.go` | M | 本地一致 |
| 38 | `internal/gateway/tool_image_test.go` | A | 本地一致 |
| 39 | `internal/gateway/util.go` | M | 本地已偏离 |
| 40 | `internal/login/login.go` | M | 本地已偏离 |
| 41 | `internal/login_loomy/guide.go` | M | 本地无此文件 |
| 42 | `internal/login_loomy/http.go` | M | 本地无此文件 |
| 43 | `internal/login_loomy/issue173_test.go` | A | 本地无此文件 |
| 44 | `internal/login_loomy/login.go` | M | 本地无此文件 |
| 45 | `internal/login_loomy/login_flow_test.go` | M | 本地无此文件 |
| 46 | `internal/officeace/client.go` | M | 本地无此文件 |
| 47 | `internal/officeace/http.go` | M | 本地无此文件 |
| 48 | `internal/officeace/throttle.go` | M | 本地无此文件 |
| 49 | `internal/officeace/throttle_test.go` | M | 本地无此文件 |
| 50 | `internal/officeace/usage.go` | A | 本地无此文件 |
| 51 | `internal/officeace/usage_test.go` | A | 本地无此文件 |
| 52 | `internal/pool/pool.go` | M | 本地已偏离 |
| 53 | `internal/pool/pool_test.go` | M | 本地已偏离 |
| 54 | `internal/pool/recordcheckin_sessiondead_test.go` | M | 本地一致 |
| 55 | `internal/provider/provider.go` | M | 本地已偏离 |
| 56 | `internal/provider/provider_test.go` | M | 本地已偏离 |
| 57 | `internal/qoder/client.go` | M | 本地已偏离 |
| 58 | `internal/qoder/envelope_notice_test.go` | A | 本地无此文件 |
| 59 | `internal/qoder/sse.go` | M | 本地一致 |
| 60 | `internal/qoder/stream_nested_error_test.go` | M | 本地一致 |
| 61 | `internal/qodercn/client.go` | M | 本地已偏离 |
| 62 | `internal/qodercn/queue_frame_test.go` | A | 本地无此文件 |
| 63 | `internal/qodercn/sse.go` | M | 本地一致 |
| 64 | `internal/qodercn/stream_nested_error_test.go` | M | 本地一致 |
| 65 | `internal/qodercom/client.go` | M | 本地已偏离 |
| 66 | `internal/qodercom/envelope_notice_test.go` | A | 本地无此文件 |
| 67 | `internal/qodercom/sse.go` | M | 本地一致 |
| 68 | `internal/qodercom/stream_nested_error_test.go` | M | 本地一致 |
| 69 | `internal/raccoon/client.go` | M | 本地已偏离 |
| 70 | `internal/raccoon/timeout_test.go` | A | 本地无此文件 |
| 71 | `internal/sanitize/sanitize.go` | M | 本地已偏离 |
| 72 | `internal/sanitize/sanitize_test.go` | A | 本地无此文件 |
| 73 | `internal/scheduler/scheduler.go` | M | 本地已偏离 |
| 74 | `internal/server/cline_no_account_softening_test.go` | M | 本地已偏离 |
| 75 | `internal/server/fallback_dimension_test.go` | M | 本地无此文件 |
| 76 | `internal/server/glm_rotation_test.go` | M | 本地已偏离 |
| 77 | `internal/server/handler.go` | M | 本地已偏离 |
| 78 | `internal/server/handler_bodylimit_test.go` | M | 本地已偏离 |
| 79 | `internal/server/handler_effort_test.go` | M | 本地一致 |
| 80 | `internal/server/handler_images_test.go` | M | 本地一致 |
| 81 | `internal/server/handler_model_cooldown_test.go` | M | 本地已偏离 |
| 82 | `internal/server/handler_queue_test.go` | A | 本地一致 |
| 83 | `internal/server/handler_single_account_test.go` | M | 本地一致 |
| 84 | `internal/server/hard_cooldown_window_test.go` | M | 本地一致 |
| 85 | `internal/server/model_fallback_14018_test.go` | M | 本地一致 |
| 86 | `internal/server/model_fallback_test.go` | M | 本地已偏离 |
| 87 | `internal/server/rotate_on_account_error_test.go` | M | 本地已偏离 |
| 88 | `internal/server/stream_error_penalty_test.go` | M | 本地一致 |
| 89 | `internal/stats/stats.go` | M | 本地已偏离 |
| 90 | `internal/stats/views_test.go` | M | 本地已偏离 |
| 91 | `internal/upstream/client.go` | M | 本地已偏离 |
| 92 | `internal/upstream/client_test.go` | M | 本地已偏离 |
| 93 | `internal/upstream/conversation_headers_test.go` | A | 本地无此文件 |
| 94 | `internal/upstream/convheaders.go` | A | 本地无此文件 |
| 95 | `internal/upstream/convheaders_test.go` | A | 本地无此文件 |
| 96 | `internal/upstream/headers.go` | M | 本地已偏离 |
| 97 | `internal/upstream/identity_headers_test.go` | A | 本地无此文件 |
| 98 | `internal/upstream/sanitize.go` | M | 本地已偏离 |
| 99 | `internal/upstream/sanitize_parity_test.go` | A | 本地无此文件 |
| 100 | `internal/upstream/sanitize_test.go` | M | 本地已偏离 |
| 101 | `internal/workbuddyai/client.go` | M | 本地已偏离 |
| 102 | `internal/workbuddyai/client_test.go` | M | 本地已偏离 |
| 103 | `internal/workbuddyai/constants.go` | M | 本地已偏离 |
| 104 | `internal/workbuddyai/conversation_headers_test.go` | M | 本地已偏离 |
| 105 | `internal/workbuddyai/convheaders.go` | A | 本地无此文件 |
| 106 | `internal/workbuddyai/convheaders_test.go` | A | 本地无此文件 |
| 107 | `internal/workbuddyai/identity_headers_test.go` | A | 本地无此文件 |
| 108 | `internal/workbuddyai/models.go` | M | 本地已偏离 |
| 109 | `scripts/ui-static-check.mjs` | M | 本地已偏离 |

## 重点关注：本地已偏离或缺失的文件

- `AGENTS.md` — 本地已偏离
- `DEVELOPMENT.md` — 本地已偏离
- `README.md` — 本地已偏离
- `RELEASES.md` — 本地已偏离
- `cmd/wild-work/custom_channels_test.go` — 本地已偏离
- `cmd/wild-work/main.go` — 本地已偏离
- `cmd/wild-work/web/app.js` — 本地已偏离
- `cmd/wild-work/web/index.html` — 本地已偏离
- `cmd/wild-work/web/style.css` — 本地已偏离
- `config.example.json` — 本地已偏离
- `"docs/\344\270\211\346\216\245\345\217\243\345\205\274\345\256\271\346\224\271\351\200\240\345\244\207\345\277\230.md"` — 上游已删除；本地无此文件
- `"docs/\345\206\263\350\256\256\351\241\271.md"` — 上游已删除；本地无此文件
- `"docs/\346\216\245\345\217\243\345\217\202\350\200\203.md"` — 上游已删除；本地无此文件
- `"docs/\346\250\241\345\236\213\351\231\215\347\272\247\351\223\276\345\256\232\344\271\211.md"` — 上游已删除；本地无此文件
- `"docs/\347\224\250\351\207\217\347\247\257\345\210\206\346\265\201\346\260\264\350\256\260\350\264\246\345\244\207\345\277\230.md"` — 上游已删除；本地无此文件
- `internal/app/app.go` — 本地已偏离
- `internal/app/creditrefresh_test.go` — 本地已偏离
- `internal/app/custom_channel_test.go` — 本地已偏离
- `internal/app/stats_feed_test.go` — 本地已偏离
- `internal/config/config.go` — 本地已偏离
- `internal/custom/caps.go` — 本地无此文件
- `internal/custom/client.go` — 本地已偏离
- `internal/custom/config.go` — 本地已偏离
- `internal/custom/custom_test.go` — 本地已偏离
- `internal/custom/discover_test.go` — 本地无此文件
- `internal/custom/endpoint.go` — 本地无此文件
- `internal/custom/endpoint_test.go` — 本地无此文件
- `internal/custom/probe.go` — 本地无此文件
- `internal/custom/probe_test.go` — 本地无此文件
- `internal/custom/timeout_test.go` — 本地无此文件
- `internal/gateway/gateway.go` — 本地已偏离
- `internal/gateway/util.go` — 本地已偏离
- `internal/login/login.go` — 本地已偏离
- `internal/login_loomy/guide.go` — 本地无此文件
- `internal/login_loomy/http.go` — 本地无此文件
- `internal/login_loomy/issue173_test.go` — 本地无此文件
- `internal/login_loomy/login.go` — 本地无此文件
- `internal/login_loomy/login_flow_test.go` — 本地无此文件
- `internal/officeace/client.go` — 本地无此文件
- `internal/officeace/http.go` — 本地无此文件
- `internal/officeace/throttle.go` — 本地无此文件
- `internal/officeace/throttle_test.go` — 本地无此文件
- `internal/officeace/usage.go` — 本地无此文件
- `internal/officeace/usage_test.go` — 本地无此文件
- `internal/pool/pool.go` — 本地已偏离
- `internal/pool/pool_test.go` — 本地已偏离
- `internal/provider/provider.go` — 本地已偏离
- `internal/provider/provider_test.go` — 本地已偏离
- `internal/qoder/client.go` — 本地已偏离
- `internal/qoder/envelope_notice_test.go` — 本地无此文件
- `internal/qodercn/client.go` — 本地已偏离
- `internal/qodercn/queue_frame_test.go` — 本地无此文件
- `internal/qodercom/client.go` — 本地已偏离
- `internal/qodercom/envelope_notice_test.go` — 本地无此文件
- `internal/raccoon/client.go` — 本地已偏离
- `internal/raccoon/timeout_test.go` — 本地无此文件
- `internal/sanitize/sanitize.go` — 本地已偏离
- `internal/sanitize/sanitize_test.go` — 本地无此文件
- `internal/scheduler/scheduler.go` — 本地已偏离
- `internal/server/cline_no_account_softening_test.go` — 本地已偏离
- `internal/server/fallback_dimension_test.go` — 本地无此文件
- `internal/server/glm_rotation_test.go` — 本地已偏离
- `internal/server/handler.go` — 本地已偏离
- `internal/server/handler_bodylimit_test.go` — 本地已偏离
- `internal/server/handler_model_cooldown_test.go` — 本地已偏离
- `internal/server/model_fallback_test.go` — 本地已偏离
- `internal/server/rotate_on_account_error_test.go` — 本地已偏离
- `internal/stats/stats.go` — 本地已偏离
- `internal/stats/views_test.go` — 本地已偏离
- `internal/upstream/client.go` — 本地已偏离
- `internal/upstream/client_test.go` — 本地已偏离
- `internal/upstream/conversation_headers_test.go` — 本地无此文件
- `internal/upstream/convheaders.go` — 本地无此文件
- `internal/upstream/convheaders_test.go` — 本地无此文件
- `internal/upstream/headers.go` — 本地已偏离
- `internal/upstream/identity_headers_test.go` — 本地无此文件
- `internal/upstream/sanitize.go` — 本地已偏离
- `internal/upstream/sanitize_parity_test.go` — 本地无此文件
- `internal/upstream/sanitize_test.go` — 本地已偏离
- `internal/workbuddyai/client.go` — 本地已偏离
- `internal/workbuddyai/client_test.go` — 本地已偏离
- `internal/workbuddyai/constants.go` — 本地已偏离
- `internal/workbuddyai/conversation_headers_test.go` — 本地已偏离
- `internal/workbuddyai/convheaders.go` — 本地无此文件
- `internal/workbuddyai/convheaders_test.go` — 本地无此文件
- `internal/workbuddyai/identity_headers_test.go` — 本地无此文件
- `internal/workbuddyai/models.go` — 本地已偏离
- `scripts/ui-static-check.mjs` — 本地已偏离

## 查看具体改动（只读命令）

```bash
git -C /home/incam/Software/wild-work-master diff e3bc93fe62f5a5ed507960699267b00be146fef7 4e895a444ed9facf1378d0c774d5be48a39a3bc1
git -C /home/incam/Software/wild-work-master log --oneline --no-decorate e3bc93fe62f5a5ed507960699267b00be146fef7..4e895a444ed9facf1378d0c774d5be48a39a3bc1
```
